/**
 * Google Calendar Integration
 * Reads credentials from calendar_connections table.
 * Handles token refresh automatically.
 */

const axios = require('axios');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { callAI } = require('../utils/ai');
const { buildContext } = require('../context/builder');

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL    = 'https://oauth2.googleapis.com/token';

// ── Credential Loader + Token Refresher ───────────────────────────────────────

async function getConnection(businessId) {
  const supabase = db();
  const { data, error } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('business_id', businessId)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error('No calendar connected. Go to Settings → Calendar to connect Google Calendar.');
  }

  // Refresh access token if expired or within 5 minutes of expiry
  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at) : null;
  const needsRefresh = !expiresAt || expiresAt < new Date(Date.now() + 5 * 60 * 1000);

  if (needsRefresh && data.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(data.refresh_token);
      const updatedConn = {
        ...data,
        access_token:     refreshed.access_token,
        token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      };
      await supabase
        .from('calendar_connections')
        .update({
          access_token:     updatedConn.access_token,
          token_expires_at: updatedConn.token_expires_at,
        })
        .eq('id', data.id)
        .catch(() => {});
      return updatedConn;
    } catch (err) {
      logger.warn('Calendar token refresh failed:', err.message);
    }
  }

  return data;
}

async function refreshAccessToken(refreshToken) {
  const res = await axios.post(TOKEN_URL, new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.data;
}

// ── Available Slots ────────────────────────────────────────────────────────────

async function getAvailableSlots({ businessId, dateRange, duration = 60 }) {
  const conn = await getConnection(businessId);

  const start = dateRange?.start || new Date().toISOString();
  const end   = dateRange?.end   || new Date(Date.now() + 7 * 86400000).toISOString();

  // Get busy times via freebusy API
  const fbRes = await axios.post(
    `${CALENDAR_API}/freeBusy`,
    {
      timeMin: start,
      timeMax: end,
      items: [{ id: conn.calendar_id || 'primary' }],
    },
    {
      headers: { Authorization: `Bearer ${conn.access_token}` },
      timeout: 15000,
    }
  );

  const busyPeriods = fbRes.data.calendars?.primary?.busy || [];
  const workingHours = conn.working_hours || getDefaultWorkingHours();
  const slots = [];

  // Walk through each day and find free slots
  let cursor = new Date(start);
  const endDate = new Date(end);

  while (cursor < endDate) {
    const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const dayHours = workingHours[dayName];

    if (dayHours) {
      const [startH, startM] = dayHours.start.split(':').map(Number);
      const [endH, endM]     = dayHours.end.split(':').map(Number);

      let slotStart = new Date(cursor);
      slotStart.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(endH, endM, 0, 0);

      while (slotStart < dayEnd) {
        const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);
        if (slotEnd > dayEnd) break;

        const isBusy = busyPeriods.some(busy =>
          new Date(busy.start) < slotEnd && new Date(busy.end) > slotStart
        );

        if (!isBusy) {
          slots.push({
            start: slotStart.toISOString(),
            end:   slotEnd.toISOString(),
            label: slotStart.toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }),
          });
        }

        slotStart = new Date(slotStart.getTime() + 30 * 60 * 1000); // 30min increments
      }
    }

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return { slots: slots.slice(0, 20), duration }; // return first 20 available slots
}

// ── Create Event ───────────────────────────────────────────────────────────────

async function createEvent({ businessId, title, start, end, attendeeEmail, attendeeName, description, leadId, opportunityId }) {
  const conn = await getConnection(businessId);

  const event = {
    summary: title,
    description,
    start: { dateTime: start, timeZone: 'UTC' },
    end:   { dateTime: end,   timeZone: 'UTC' },
    attendees: attendeeEmail ? [{ email: attendeeEmail, displayName: attendeeName }] : [],
    conferenceData: {
      createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 30 }, { method: 'popup', minutes: 10 }] },
  };

  const res = await axios.post(
    `${CALENDAR_API}/calendars/${conn.calendar_id || 'primary'}/events?conferenceDataVersion=1&sendUpdates=all`,
    event,
    {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const created = res.data;
  const meetingLink = created.hangoutLink || created.conferenceData?.entryPoints?.[0]?.uri || null;

  // Save meeting record
  const supabase = db();
  const { data: meeting } = await supabase
    .from('meetings')
    .insert({
      business_id:       businessId,
      lead_id:           leadId || null,
      opportunity_id:    opportunityId || null,
      title,
      start_time:        start,
      end_time:          end,
      platform_event_id: created.id,
      meeting_link:      meetingLink,
      status:            'scheduled',
    })
    .select()
    .single()
    .catch(() => ({ data: null }));

  // Emit event
  await supabase.from('events').insert({
    business_id: businessId,
    type: 'meeting.booked',
    entity_type: 'meeting',
    entity_id: meeting?.id || null,
    payload: { title, start, end, attendeeEmail, lead_id: leadId },
  }).catch(() => {});

  logger.info(`Calendar event created: ${created.id}`);
  return { event_id: created.id, meeting_link: meetingLink, meeting_id: meeting?.id };
}

// ── Pre-call Briefing ─────────────────────────────────────────────────────────

async function getMeetingBriefing({ businessId, eventId, meetingId }) {
  const supabase = db();

  // Find the meeting record
  let leadId = null;
  let meetingTitle = 'Meeting';
  if (meetingId) {
    const { data } = await supabase
      .from('meetings')
      .select('lead_id,title')
      .eq('id', meetingId)
      .single();
    leadId = data?.lead_id;
    meetingTitle = data?.title || meetingTitle;
  }

  const context = await buildContext({
    businessId,
    userInput: `Pre-call briefing for meeting: ${meetingTitle}`,
    entityType: leadId ? 'lead' : null,
    entityId: leadId,
  });

  const agentOutput = await callAI({
    systemPrompt: `You are a meeting preparation assistant. Generate a concise pre-call briefing for the operator going into this meeting. Include: lead background, recent interactions, open opportunities, talking points, and suggested outcomes. Format as plain text suitable for Telegram.`,
    userMessage: `Meeting: ${meetingTitle}\n\nContext:\n${JSON.stringify(context, null, 2)}`,
    maxTokens: 1024,
  });

  return `📋 *Pre-call Briefing: ${meetingTitle}*\n\n${agentOutput.summary || agentOutput}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDefaultWorkingHours() {
  const day = { start: '09:00', end: '17:00' };
  return {
    monday: day, tuesday: day, wednesday: day, thursday: day, friday: day,
    saturday: null, sunday: null,
  };
}

module.exports = { getAvailableSlots, createEvent, getMeetingBriefing, getConnection };

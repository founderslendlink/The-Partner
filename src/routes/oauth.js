/**
 * OAuth Routes — Google Calendar
 * Mounted at /oauth in src/index.js
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// ── GET /oauth/google/calendar ────────────────────────────────────────────────
// Kicks off the OAuth consent screen. Pass ?businessId= in query string.

router.get('/google/calendar', (req, res) => {
  const { businessId } = req.query;

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(500).send('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI.');
  }

  const state = Buffer.from(JSON.stringify({ businessId })).toString('base64');

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// ── GET /oauth/google/callback ────────────────────────────────────────────────
// Google redirects here after consent. Exchanges code for tokens, saves to DB.

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn('Google OAuth denied:', error);
    return res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/settings?error=oauth_denied`);
  }

  let businessId;
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
    businessId = parsed.businessId;
  } catch {
    return res.status(400).send('Invalid OAuth state parameter');
  }

  try {
    // Exchange auth code for tokens
    const tokenRes = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Get user's calendar email
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const calendarEmail = userRes.data.email;

    // Upsert calendar connection
    const supabase = db();
    await supabase
      .from('calendar_connections')
      .upsert({
        business_id:      businessId,
        provider:         'google',
        access_token,
        refresh_token:    refresh_token || '',
        token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        calendar_id:      'primary',
        connected_at:     new Date().toISOString(),
      }, { onConflict: 'business_id,provider' });

    logger.info(`Google Calendar connected for business ${businessId} (${calendarEmail})`);
    res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/settings?success=calendar_connected&email=${encodeURIComponent(calendarEmail)}`);
  } catch (err) {
    logger.error('Google OAuth callback error:', err.message);
    res.redirect(`${process.env.DASHBOARD_URL || 'http://localhost:3001'}/settings?error=oauth_failed`);
  }
});

module.exports = router;

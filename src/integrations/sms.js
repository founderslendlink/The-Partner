/**
 * SMS Integration — Twilio REST API
 * Reads credentials from sms_connections table, falls back to env vars.
 */

const axios = require('axios');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

// ── Credential Loader ─────────────────────────────────────────────────────────

async function getConnection(businessId) {
  const supabase = db();
  const { data } = await supabase
    .from('sms_connections')
    .select('*')
    .eq('business_id', businessId)
    .limit(1)
    .single();

  if (data) return data;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const phone = process.env.TWILIO_PHONE_NUMBER;

  if (sid && token && phone) {
    return { account_sid: sid, auth_token: token, phone_number: phone };
  }

  throw new Error('No SMS provider configured. Add Twilio credentials in Settings → SMS.');
}

// ── Main Sender ───────────────────────────────────────────────────────────────

async function sendSMS({ to, message, businessId, leadId }) {
  const conn = await getConnection(businessId);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${conn.account_sid}/Messages.json`;

  const params = new URLSearchParams();
  params.append('To',   to);
  params.append('From', conn.phone_number);
  params.append('Body', message);

  const res = await axios.post(url, params.toString(), {
    auth: {
      username: conn.account_sid,
      password: conn.auth_token,
    },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const sid = res.data.sid;

  const supabase = db();
  await supabase.from('interactions').insert({
    business_id: businessId,
    lead_id:     leadId || null,
    channel:     'sms',
    direction:   'outbound',
    content:     message,
    metadata:    { to, sid },
  }).catch(() => {});

  if (leadId) {
    await supabase
      .from('leads')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', leadId)
      .catch(() => {});
  }

  logger.info(`SMS sent to ${to} [${sid}]`);
  return { sent: true, sid };
}

module.exports = { sendSMS };

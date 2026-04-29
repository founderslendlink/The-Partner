/**
 * Email Marketing Integration
 * Routes to SendGrid or SMTP based on the business's email_connections config.
 * All sent emails are logged to the interactions table.
 */

const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

// ── Credential Loader ─────────────────────────────────────────────────────────

async function getConnection(businessId) {
  const supabase = db();
  const { data, error } = await supabase
    .from('email_connections')
    .select('*')
    .eq('business_id', businessId)
    .limit(1)
    .single();

  if (error || !data) {
    // Fall back to env-level SendGrid config if no business-specific connection
    const apiKey = process.env.SENDGRID_API_KEY;
    if (apiKey) {
      return {
        provider:   'sendgrid',
        api_key:    apiKey,
        from_email: process.env.DEFAULT_FROM_EMAIL || 'noreply@thepartner.ai',
        from_name:  process.env.DEFAULT_FROM_NAME  || 'The Partner',
      };
    }
    throw new Error('No email provider configured. Add credentials in Settings → Email.');
  }
  return data;
}

// ── Interaction Logger ────────────────────────────────────────────────────────

async function logInteraction(businessId, { to, subject, body, leadId }) {
  try {
    await db().from('interactions').insert({
      business_id: businessId,
      lead_id:     leadId || null,
      channel:     'email',
      direction:   'outbound',
      content:     `Subject: ${subject}\n\n${body}`,
      metadata:    { to, subject },
    });
  } catch (e) {}
}

// ── SendGrid ──────────────────────────────────────────────────────────────────

async function sendViaSendGrid({ to, subject, body, fromEmail, fromName, apiKey }) {
  const axios = require('axios');

  const res = await axios.post(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: 'text/html', value: body }],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  // SendGrid returns 202 with x-message-id header
  return res.headers['x-message-id'] || 'sent';
}

// ── SMTP via Nodemailer ───────────────────────────────────────────────────────

async function sendViaSMTP({ to, subject, body, fromEmail, fromName, host, port, user, pass }) {
  // nodemailer is an optional dependency — load lazily
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    throw new Error('nodemailer is not installed. Run: npm install nodemailer');
  }

  const transporter = nodemailer.createTransporter({
    host,
    port: port || 587,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });

  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    html: body,
  });

  return info.messageId;
}

// ── Main Sender ───────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, body, businessId, leadId }) {
  const conn = await getConnection(businessId);

  let messageId;

  if (conn.provider === 'sendgrid' || conn.api_key?.startsWith('SG.')) {
    messageId = await sendViaSendGrid({
      to, subject, body,
      fromEmail: conn.from_email,
      fromName:  conn.from_name,
      apiKey:    conn.api_key,
    });
  } else if (conn.provider === 'smtp') {
    messageId = await sendViaSMTP({
      to, subject, body,
      fromEmail: conn.from_email,
      fromName:  conn.from_name,
      host: conn.smtp_host,
      port: conn.smtp_port,
      user: conn.smtp_user,
      pass: conn.smtp_pass,
    });
  } else {
    throw new Error(`Unsupported email provider: ${conn.provider}`);
  }

  await logInteraction(businessId, { to, subject, body, leadId });
  logger.info(`Email sent to ${to} [${messageId}]`);
  return { sent: true, message_id: messageId, to };
}

// ── Email Stats ───────────────────────────────────────────────────────────────

async function getEmailStats(campaignId) {
  const { data } = await db()
    .from('email_campaigns')
    .select('sent_count,open_count,click_count,open_rate,click_rate')
    .eq('id', campaignId)
    .single();
  return data || {};
}

// ── Track Open (webhook stub) ─────────────────────────────────────────────────

async function trackOpen(messageId, businessId) {
  // Called by email provider webhook. Increment open count on matching campaign.
  logger.debug(`Email open tracked: ${messageId}`);
}

module.exports = { sendEmail, sendViaSendGrid, sendViaSMTP, trackOpen, getEmailStats };

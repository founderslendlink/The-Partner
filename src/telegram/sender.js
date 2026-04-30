const axios = require('axios');
const { logger } = require('../utils/logger');
const { db } = require('../utils/supabase');

const BASE_URL = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Send a plain text message to a chat.
 */
async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    await axios.post(`${BASE_URL()}/sendMessage`, {
      chat_id: chatId,
      text,
      // No parse_mode — plain text, always safe for AI-generated content
      ...extra,
    }, { timeout: 10000 });
  } catch (err) {
    logger.error('Telegram sendMessage failed:', err.response?.data || err.message);
  }
}

/**
 * Send an alert to the configured operator chat.
 */
async function sendTelegramAlert(businessId, text) {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID;
  if (!chatId) {
    logger.warn('TELEGRAM_OPERATOR_CHAT_ID not set — cannot send alert');
    return;
  }
  await sendTelegramMessage(chatId, text);
}

/**
 * Send an approval request with Approve/Reject/Snooze buttons.
 */
async function sendApprovalRequest(chatId, queuedAction, originalAction) {
  const preview = buildActionPreview(queuedAction.action_type, queuedAction.payload || originalAction.payload);

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve:${queuedAction.id}` },
      { text: '❌ Reject',  callback_data: `reject:${queuedAction.id}` },
      { text: '💤 Snooze 2h', callback_data: `snooze:${queuedAction.id}` },
    ]],
  };

  const text = [
    `📬 *Action Requires Approval*`,
    `Type: \`${queuedAction.action_type}\``,
    `Priority: ${queuedAction.priority || 5}/10`,
    ``,
    preview,
  ].join('\n');

  await sendTelegramMessage(chatId, text, { reply_markup: keyboard });

  // Store the approval request
  const supabase = db();
  try {
    await supabase.from('approval_requests').insert({
      business_id:      queuedAction.business_id,
      action_queue_id:  queuedAction.id,
      status:           'pending',
    });
  } catch (e) {}
}

/**
 * Build a human-readable preview of what an action will do.
 */
function buildActionPreview(actionType, payload) {
  if (!payload) return '(no details)';

  switch (actionType) {
    case 'send_message':
    case 'draft_message':
      return `📝 *Message:*\n"${(payload.message || '').slice(0, 300)}"`;

    case 'advance_opp_stage':
      return `📈 Move deal to *${payload.new_stage}* stage`;

    case 'trigger_campaign':
      return `📣 Start campaign: ${payload.campaign_name || payload.product || 'unnamed'}\n${payload.message_count || '?'} messages to ${payload.lead_count || '?'} leads`;

    case 'switch_mode':
      return `🔄 Switch system to *${payload.new_mode}*`;

    case 'book_meeting':
      return `📅 Book meeting with ${payload.lead_name || 'lead'} on ${payload.date || '?'}`;

    case 'close_opportunity':
      return `🏁 Close deal "${payload.opportunity_name}" as *${payload.outcome}*`;

    default:
      const summary = JSON.stringify(payload).slice(0, 200);
      return `Payload: \`${summary}\``;
  }
}

module.exports = { sendTelegramMessage, sendTelegramAlert, sendApprovalRequest };

const axios = require('axios');
const { logger } = require('../utils/logger');
const { db } = require('../utils/supabase');

// Channel name → env var mapping
const CHANNEL_MAP = {
  alerts:    'DISCORD_CHANNEL_ALERTS',
  briefing:  'DISCORD_CHANNEL_BRIEFING',
  pipeline:  'DISCORD_CHANNEL_PIPELINE',
  reports:   'DISCORD_CHANNEL_REPORTS',
  memory:    'DISCORD_CHANNEL_MEMORY',
  system:    'DISCORD_CHANNEL_SYSTEM',
  decisions: 'DISCORD_CHANNEL_DECISIONS',
  approvals: 'DISCORD_CHANNEL_APPROVALS',
};

/**
 * Write a notification row so the dashboard receives it in realtime.
 * Non-fatal — a failure here never blocks Discord posting.
 */
async function writeNotification(businessId, type, title, message, severity = 'medium') {
  if (!businessId) return;
  try {
    await db().from('notifications').insert({
      business_id: businessId,
      type,
      title,
      message,
      severity,
    });
  } catch (err) {
    logger.debug('writeNotification failed (non-fatal):', err.message);
  }
}

/**
 * Post a message to a Discord channel via webhook or bot API.
 * Uses bot token + channel ID approach.
 * Also writes a notification row for the dashboard.
 */
async function postToDiscord(businessId, channelKey, content) {
  const envKey = CHANNEL_MAP[channelKey];
  if (!envKey) {
    logger.warn(`Unknown Discord channel key: ${channelKey}`);
    return;
  }

  const channelId = process.env[envKey];
  if (!channelId) {
    logger.debug(`Discord channel ${channelKey} not configured — skipping post`);
    return;
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return;

  // Write to notifications table so dashboard receives it via realtime
  const severityMap = { alerts: 'high', system: 'medium', decisions: 'low', approvals: 'high' };
  await writeNotification(
    businessId,
    `discord.${channelKey}`,
    `Discord: ${channelKey}`,
    content.slice(0, 500),
    severityMap[channelKey] || 'medium'
  );

  try {
    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { content: content.slice(0, 2000) }, // Discord message limit
      {
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  } catch (err) {
    logger.warn(`Discord post to ${channelKey} failed:`, err.response?.data?.message || err.message);
  }
}

module.exports = { postToDiscord, writeNotification };

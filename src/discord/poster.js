const axios = require('axios');
const { logger } = require('../utils/logger');

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
 * Post a message to a Discord channel via webhook or bot API.
 * Uses bot token + channel ID approach.
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

module.exports = { postToDiscord };

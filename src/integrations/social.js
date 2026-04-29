/**
 * Social Media Integration
 * Supports Instagram, LinkedIn, Twitter/X, Facebook via their respective APIs.
 * Credentials are stored per-business in the social_connections table.
 */

const axios = require('axios');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');

// ── Credential Loader ─────────────────────────────────────────────────────────

async function getConnection(businessId, platform) {
  const { data, error } = await db()
    .from('social_connections')
    .select('*')
    .eq('business_id', businessId)
    .eq('platform', platform)
    .single();

  if (error || !data) {
    throw new Error(
      `${platform.charAt(0).toUpperCase() + platform.slice(1)} not connected. ` +
      `Go to Settings to connect your account.`
    );
  }

  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    throw new Error(`${platform} token has expired. Reconnect in Settings.`);
  }

  return data;
}

// ── Update post record after publishing ──────────────────────────────────────

async function markPublished(postId, platformPostId) {
  try {
    await db()
      .from('content_posts')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        platform_post_id: platformPostId || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId);
  } catch (e) {}
}

async function markFailed(postId, reason) {
  try {
    await db()
      .from('content_posts')
      .update({
        status: 'failed',
        performance: { error: reason },
        updated_at: new Date().toISOString(),
      })
      .eq('id', postId);
  } catch (e) {}
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function postToInstagram(businessId, { caption, imageUrl, postId }) {
  const conn = await getConnection(businessId, 'instagram');

  // Instagram Graph API: create container then publish
  const base = 'https://graph.facebook.com/v18.0';

  // Step 1: Create media container
  const containerRes = await axios.post(`${base}/${conn.account_id}/media`, null, {
    params: {
      caption,
      image_url: imageUrl,
      access_token: conn.access_token,
    },
  });
  const creationId = containerRes.data.id;

  // Step 2: Publish container
  const publishRes = await axios.post(`${base}/${conn.account_id}/media_publish`, null, {
    params: { creation_id: creationId, access_token: conn.access_token },
  });

  const igPostId = publishRes.data.id;
  if (postId) await markPublished(postId, igPostId);
  logger.info(`Instagram post published: ${igPostId}`);
  return { platform_post_id: igPostId, platform: 'instagram' };
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

async function postToLinkedIn(businessId, { text, imageUrl, postId }) {
  const conn = await getConnection(businessId, 'linkedin');

  const body = {
    author: `urn:li:person:${conn.account_id}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: imageUrl ? 'IMAGE' : 'NONE',
        ...(imageUrl
          ? {
              media: [{
                status: 'READY',
                description: { text: text.slice(0, 200) },
                originalUrl: imageUrl,
              }],
            }
          : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await axios.post('https://api.linkedin.com/v2/ugcPosts', body, {
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  const liPostId = res.headers['x-restli-id'] || res.data.id;
  if (postId) await markPublished(postId, liPostId);
  logger.info(`LinkedIn post published: ${liPostId}`);
  return { platform_post_id: liPostId, platform: 'linkedin' };
}

// ── Twitter / X ───────────────────────────────────────────────────────────────

async function postToTwitter(businessId, { text, imageUrl, postId }) {
  const conn = await getConnection(businessId, 'twitter');

  // Twitter API v2 uses OAuth 1.0a or OAuth 2.0 Bearer
  // Using OAuth 1.0a user context here (most common for posting)
  const { createHmac } = require('crypto');

  const url = 'https://api.twitter.com/2/tweets';
  const body = { text };

  // Build OAuth 1.0a header
  const oauth = buildTwitterOAuth('POST', url, {}, conn);

  const res = await axios.post(url, body, {
    headers: {
      Authorization: oauth,
      'Content-Type': 'application/json',
    },
  });

  const tweetId = res.data.data.id;
  if (postId) await markPublished(postId, tweetId);
  logger.info(`Twitter post published: ${tweetId}`);
  return { platform_post_id: tweetId, platform: 'twitter' };
}

function buildTwitterOAuth(method, url, params, conn) {
  const { createHmac } = require('crypto');

  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = conn.access_token;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: Math.random().toString(36).slice(2),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };

  const allParams = { ...params, ...oauthParams };
  const sorted = Object.keys(allParams).sort().map((k) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`
  ).join('&');

  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const sig = createHmac('sha1', key).update(base).digest('base64');

  oauthParams.oauth_signature = sig;
  const header = 'OAuth ' + Object.entries(oauthParams)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');

  return header;
}

// ── Facebook ──────────────────────────────────────────────────────────────────

async function postToFacebook(businessId, { message, imageUrl, postId }) {
  const conn = await getConnection(businessId, 'facebook');

  const endpoint = imageUrl
    ? `https://graph.facebook.com/v18.0/${conn.account_id}/photos`
    : `https://graph.facebook.com/v18.0/${conn.account_id}/feed`;

  const params = imageUrl
    ? { caption: message, url: imageUrl, access_token: conn.access_token }
    : { message, access_token: conn.access_token };

  const res = await axios.post(endpoint, null, { params });
  const fbPostId = res.data.post_id || res.data.id;
  if (postId) await markPublished(postId, fbPostId);
  logger.info(`Facebook post published: ${fbPostId}`);
  return { platform_post_id: fbPostId, platform: 'facebook' };
}

// ── Performance Fetcher ───────────────────────────────────────────────────────

async function getPostPerformance(platform, platformPostId, businessId) {
  const conn = await getConnection(businessId, platform);
  const base = 'https://graph.facebook.com/v18.0';

  try {
    if (platform === 'instagram') {
      const res = await axios.get(`${base}/${platformPostId}/insights`, {
        params: {
          metric: 'impressions,reach,likes_count,comments_count',
          access_token: conn.access_token,
        },
      });
      return res.data.data.reduce((acc, m) => {
        acc[m.name] = m.values?.[0]?.value ?? m.value;
        return acc;
      }, {});
    }

    if (platform === 'facebook') {
      const res = await axios.get(`${base}/${platformPostId}/insights`, {
        params: {
          metric: 'post_impressions,post_engaged_users,post_reactions_by_type_total',
          access_token: conn.access_token,
        },
      });
      return res.data.data.reduce((acc, m) => {
        acc[m.name] = m.values?.[0]?.value ?? 0;
        return acc;
      }, {});
    }

    if (platform === 'twitter') {
      const oauth = buildTwitterOAuth(
        'GET',
        `https://api.twitter.com/2/tweets/${platformPostId}`,
        { 'tweet.fields': 'public_metrics' },
        conn
      );
      const res = await axios.get(`https://api.twitter.com/2/tweets/${platformPostId}`, {
        headers: { Authorization: oauth },
        params: { 'tweet.fields': 'public_metrics' },
      });
      return res.data.data.public_metrics || {};
    }

    return {};
  } catch (err) {
    logger.warn(`getPostPerformance(${platform}) failed:`, err.message);
    return {};
  }
}

module.exports = {
  postToInstagram,
  postToLinkedIn,
  postToTwitter,
  postToFacebook,
  getPostPerformance,
};

const cron = require('node-cron');
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { buildContext } = require('../context/builder');
const { runCEOAgent } = require('../agents/ceo');
const { postToDiscord } = require('./poster');
const { runRevenueAgent } = require('../agents/revenue');

function startDailyBriefing() {
  // Daily briefing at configured time
  const briefingTime = process.env.BRIEFING_TIME || '08:00';
  const [hour, minute] = briefingTime.split(':');
  const briefingCron = `${minute} ${hour} * * *`;

  cron.schedule(briefingCron, async () => {
    await runForAllBusinesses(postDailyBriefing);
  });

  // Weekly revenue report — Monday morning
  cron.schedule('0 8 * * 1', async () => {
    await runForAllBusinesses(postWeeklyReport);
  });

  logger.info(`Daily briefing scheduled at ${briefingTime}`);
}

async function runForAllBusinesses(fn) {
  const supabase = db();
  const { data: businesses } = await supabase
    .from('businesses')
    .select('id,name')
    .eq('active', true);

  for (const biz of (businesses || [])) {
    try {
      await fn(biz.id, biz.name);
    } catch (err) {
      logger.error(`Briefing failed for ${biz.name}:`, err.message);
    }
  }
}

async function postDailyBriefing(businessId, bizName) {
  const context = await buildContext({ businessId, userInput: 'morning briefing priorities alerts' });

  const output = await runCEOAgent({
    task: 'Generate the morning briefing. Include: (1) overnight alerts summary, (2) top 3 priorities today, (3) pipeline health snapshot, (4) pending approvals count, (5) one strategic insight.',
    context,
  });

  const supabase = db();
  const { count: approvals } = await supabase
    .from('action_queue')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'approval_required');

  let briefing = `🌅 **Good morning — Daily Briefing**\n\n`;
  briefing += output.summary;
  if (approvals > 0) {
    briefing += `\n\n⏳ **${approvals} approval(s) pending** — check Telegram to review.`;
  }

  await postToDiscord(businessId, 'briefing', briefing);
  logger.info(`Daily briefing posted for ${bizName}`);
}

async function postWeeklyReport(businessId, bizName) {
  const context = await buildContext({ businessId, userInput: 'weekly revenue report analysis' });
  const output = await runRevenueAgent({
    task: 'Generate the weekly revenue report. Include: pipeline value by stage, deals won/lost this week, conversion rates, top performing products, and forecast for next 30 days.',
    context,
  });

  await postToDiscord(businessId, 'reports',
    `📊 **Weekly Revenue Report**\n\n${output.summary}`
  );

  // Store report
  const supabase = db();
  try {
    await supabase.from('reports').insert({
      business_id: businessId,
      type: 'weekly_revenue',
      period: new Date().toISOString().split('T')[0],
      content: output,
    });
  } catch (e) {}

  logger.info(`Weekly report posted for ${bizName}`);
}

module.exports = { startDailyBriefing };

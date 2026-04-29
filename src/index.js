require('dotenv').config();
const express = require('express');
const { logger } = require('./utils/logger');
const { initSupabase } = require('./utils/supabase');
const { startHeartbeat } = require('./heartbeat/scheduler');
const { startQueueWorker } = require('./queue/worker');
const { startDailyBriefing } = require('./discord/briefing');
const telegramRoutes = require('./routes/telegram');
const healthRoutes = require('./routes/health');
const apiRoutes = require('./routes/api');
const oauthRoutes = require('./routes/oauth');

const app = express();
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhook/telegram', telegramRoutes);
app.use('/health', healthRoutes);
app.use('/api', apiRoutes);
app.use('/oauth', oauthRoutes);

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function boot() {
  logger.info('The Partner is starting up...');

  // AI provider availability check
  if (process.env.ANTHROPIC_API_KEY) {
    logger.info('AI provider: Anthropic Claude (primary)');
  } else {
    logger.warn('Anthropic API key not set');
  }
  if (process.env.GEMINI_API_KEY) {
    logger.info('AI provider: Google Gemini (available as fallback)');
  } else {
    logger.warn('Gemini API key not set');
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY) {
    logger.error('CRITICAL: No AI provider configured. AI features will not work.');
  }

  // Verify Supabase connection
  const db = initSupabase();
  const { error } = await db.from('businesses').select('id').limit(1);
  if (error && error.code !== 'PGRST116') {
    logger.error(`Supabase connection failed [${error.code}]: ${error.message || JSON.stringify(error)}`);
    logger.error('Run: node scripts/migrate.js  to set up the database first.');
    process.exit(1);
  }
  logger.info('Database connection verified.');

  // Start background systems
  startHeartbeat();
  logger.info('Heartbeat system started.');

  startQueueWorker();
  logger.info('Action queue worker started.');

  startDailyBriefing();
  logger.info('Daily briefing scheduler started.');

  // Start automation event processor (every 30 seconds)
  startEventProcessor();
  logger.info('Automation event processor started.');

  // Start HTTP server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`The Partner is live on port ${port}`);
    logger.info(`Telegram webhook: POST /webhook/telegram`);
    logger.info(`Health check:     GET  /health`);
  });
}

function startEventProcessor() {
  const { db: getDb } = require('./utils/supabase');
  const { checkTriggers, resumeWaitingRuns } = require('./automation/engine');

  setInterval(async () => {
    try {
      const supabase = getDb();

      // Resume waiting automation runs whose delay has elapsed
      await resumeWaitingRuns();

      // Process new unprocessed events
      const { data: events } = await supabase
        .from('events')
        .select('id,business_id,type,entity_type,entity_id')
        .eq('processed', false)
        .order('created_at', { ascending: true })
        .limit(20);

      if (!events || events.length === 0) return;

      for (const event of events) {
        try {
          await checkTriggers({
            businessId:  event.business_id,
            eventType:   event.type,
            entityType:  event.entity_type,
            entityId:    event.entity_id,
          });
          await supabase.from('events').update({ processed: true }).eq('id', event.id);
        } catch (err) {
          logger.warn(`Event processor error for event ${event.id}:`, err.message);
          await supabase.from('events').update({ processed: true }).eq('id', event.id);
        }
      }
    } catch (err) {
      logger.error('Event processor cycle error:', err.message);
    }
  }, 30000);
}

boot().catch(err => {
  logger.error('Fatal boot error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down gracefully...');
  process.exit(0);
});

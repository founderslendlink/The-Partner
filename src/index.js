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

const app = express();
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhook/telegram', telegramRoutes);
app.use('/health', healthRoutes);
app.use('/api', apiRoutes);

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function boot() {
  logger.info('The Partner is starting up...');

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

  // Start HTTP server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    logger.info(`The Partner is live on port ${port}`);
    logger.info(`Telegram webhook: POST /webhook/telegram`);
    logger.info(`Health check:     GET  /health`);
  });
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

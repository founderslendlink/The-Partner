# The Partner — AI Business Operating System

A full AI business operator that thinks, decides, executes, remembers, monitors, and improves over time.

---

## Quick Start (15 minutes)

### 1. Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) account (free tier works for MVP)
- An [Anthropic](https://console.anthropic.com) API key
- An [OpenAI](https://platform.openai.com) API key (for embeddings + Whisper)
- A Telegram bot (create via [@BotFather](https://t.me/botfather))
- A Discord bot (optional, for dashboard)
- A server with a public HTTPS URL (Railway, Fly.io, Render, or a VPS)

---

### 2. Install

```bash
git clone <your-repo>
cd the-partner
npm install
cp .env.example .env
```

Fill in every value in `.env`.

---

### 3. Set Up Supabase

Open your Supabase project → SQL Editor → paste and run:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_default_permissions.sql`

Or use the Supabase CLI:
```bash
npx supabase db push
```

> **Required extension**: Enable `pgvector` in Supabase:
> Dashboard → Database → Extensions → search "vector" → enable

---

### 4. First-Time Setup

```bash
node scripts/setup.js
```

This creates your first business, inserts default permission rules, and registers your Telegram webhook.

---

### 5. Load Sample Data (Optional)

```bash
node scripts/seed.js
```

Creates sample leads, opportunities, tasks, and memory entries so you can test immediately.

---

### 6. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

---

### 7. Test via Telegram

Send `/help` to your bot to verify the connection.

Then try:
- `/status` — See your pipeline
- `/briefing` — Get an AI morning briefing
- `/pipeline` — View all deals
- Just type anything — The Partner will respond

---

## Deployment

### Railway (recommended for speed)

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set environment variables in the Railway dashboard.

### Fly.io

```bash
flyctl launch
flyctl secrets set ANTHROPIC_API_KEY=... SUPABASE_URL=... # etc.
flyctl deploy
```

### VPS (nginx + PM2)

```bash
npm install -g pm2
pm2 start src/index.js --name the-partner
pm2 save
pm2 startup
```

Configure nginx to proxy port 3000 with SSL (Let's Encrypt).

---

## Architecture

```
Telegram/Discord
      ↓
  Webhook (Express)
      ↓
  Session Management
      ↓
  Context Builder ← Tier 1 (Supabase CRM)
      ↓             Tier 2 (memory_entries)
  CEO Agent         Tier 3 (pgvector semantic search)
      ↓
  Permission Layer (permission_rules table)
      ↓
  Action Queue (action_queue table)
      ↓
  Workers (node-cron + polling)
      ↓
  Handlers (send_message, create_task, etc.)

Heartbeat (parallel):
  5min → urgent checks (uncontacted leads)
  1hr  → pipeline checks (stalled deals, overdue tasks)
  1day → strategy checks (metrics, trends)
```

---

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/status` | Pipeline snapshot |
| `/briefing` | AI morning briefing |
| `/pipeline` | Full deal view |
| `/tasks` | Open tasks |
| `/approvals` | Pending approvals |
| `/lead [name]` | Lead details |
| `/remember [text]` | Save a memory note |
| `/report [type]` | Generate report |
| `/mode [mode]` | Switch system mode |
| `/switch [business]` | Switch business context |
| `/push [product]` | Product campaign |
| `/help` | Command list |

---

## System Modes

| Mode | Focus |
|------|-------|
| `balanced_mode` | Default — all agents active |
| `booking_mode` | Maximum speed on lead response + meetings |
| `product_push_mode` | Content and campaign focus |
| `strategy_mode` | Analysis and planning |
| `admin_mode` | Maintenance — no outbound actions |
| `onboarding_mode` | First 14 days — observe and learn |

---

## Adding Integrations

The `src/queue/handlers.js` file is where you add real outbound capabilities:

```js
// Example: real SMS via Twilio
async function handle_send_message(payload, businessId) {
  if (payload.channel === 'sms') {
    await twilioClient.messages.create({
      body: payload.message,
      to:   payload.phone,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
  }
  // ... log to interactions table
}
```

Add your integration in the handler, the queue worker calls it automatically.

---

## Directory Structure

```
the-partner/
├── src/
│   ├── index.js                 # Entry point
│   ├── agents/
│   │   ├── ceo.js               # Master orchestrator
│   │   ├── sales.js             # Sales & Pipeline
│   │   ├── revenue.js           # Revenue & Strategy
│   │   ├── marketing.js         # Product & Marketing
│   │   └── operations.js        # Operations & Memory
│   ├── context/
│   │   └── builder.js           # 3-tier context assembler
│   ├── permissions/
│   │   └── layer.js             # Permission rules engine
│   ├── memory/
│   │   └── manager.js           # Memory read/write/prune
│   ├── queue/
│   │   ├── enqueue.js           # Queue writer
│   │   ├── worker.js            # Queue poller + executor
│   │   └── handlers.js          # Per-action-type handlers
│   ├── heartbeat/
│   │   └── scheduler.js         # 5min/hourly/daily checks
│   ├── telegram/
│   │   ├── commands.js          # /status /briefing etc.
│   │   └── sender.js            # Send + approval buttons
│   ├── discord/
│   │   ├── poster.js            # Post to channels
│   │   └── briefing.js          # Daily/weekly scheduler
│   ├── routes/
│   │   ├── telegram.js          # Webhook handler
│   │   └── health.js            # Health check
│   └── utils/
│       ├── ai.js                # Anthropic + OpenAI clients
│       ├── supabase.js          # DB client singleton
│       ├── logger.js            # Winston logger
│       └── audit.js             # Audit log writer
├── supabase/migrations/
│   ├── 001_initial_schema.sql   # All 42 tables
│   └── 002_default_permissions.sql
├── scripts/
│   ├── migrate.js               # Run migrations
│   ├── setup.js                 # First-time setup
│   └── seed.js                  # Sample data
├── .env.example                 # Config template
└── package.json
```

---

## Estimated Monthly Costs (MVP)

| Service | Cost |
|---------|------|
| Supabase (free tier) | $0 |
| Anthropic Claude (Sonnet, ~500 calls/day) | ~$15-30 |
| OpenAI embeddings | ~$2-5 |
| OpenAI Whisper (if using voice) | ~$1-5 |
| Railway / Fly.io hosting | $5-10 |
| **Total** | **~$23-50/month** |

---

## Phase 2 Additions (not in this build)

- Real SMS/email integration (Twilio, SendGrid)
- Calendar integration (Google Calendar API)
- Native email monitoring (Gmail API)
- Fine-tuning on your approval patterns
- Computer control layer (Playwright)
- Web dashboard (Next.js + Supabase Realtime)

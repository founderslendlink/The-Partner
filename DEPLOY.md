# Deploying The Partner

## Backend — Railway

1. Go to railway.app and sign up with GitHub
2. Click New Project → Deploy from GitHub repo
3. Select the The-Partner repository
4. Railway will detect Node.js automatically
5. Go to Variables tab and add every variable from your .env file — copy each one exactly
6. The app will deploy automatically
7. Go to Settings → Networking → Generate Domain
8. Copy the Railway URL (e.g. the-partner.up.railway.app)
9. Update your Telegram webhook to the new URL:
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://the-partner.up.railway.app/webhook/telegram
10. Update APP_BASE_URL in Railway variables to your Railway URL

## Dashboard — Vercel

1. Go to vercel.com and sign up with GitHub
2. Click New Project → Import from GitHub
3. Select the The-Partner repository
4. IMPORTANT: Set Root Directory to dashboard
5. Framework Preset will auto-detect as Next.js
6. Add Environment Variables:
   NEXT_PUBLIC_SUPABASE_URL = your supabase url
   NEXT_PUBLIC_SUPABASE_ANON_KEY = your supabase anon key
   NEXT_PUBLIC_API_URL = your Railway URL
7. Click Deploy
8. Vercel gives you a URL like the-partner.vercel.app
9. That is your dashboard URL

## After Both Are Deployed

1. Test backend: visit https://your-railway-url/health
   Should return {"status":"ok"}
2. Test dashboard: visit your Vercel URL
   Should show login page
3. Send /status to your Telegram bot
   Should respond with pipeline snapshot
4. Log into dashboard and verify data loads

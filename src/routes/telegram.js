const express = require('express');
const router = express.Router();
const { db } = require('../utils/supabase');
const { logger } = require('../utils/logger');
const { buildContext } = require('../context/builder');
const { runCEOAgent } = require('../agents/ceo');
const { processProposedActions } = require('../permissions/layer');
const { enqueue, enqueueMany, approveAction, rejectAction } = require('../queue/enqueue');
const { writeMemoryUpdates } = require('../memory/manager');
const { sendTelegramMessage, sendApprovalRequest } = require('../telegram/sender');
const { transcribeAudio } = require('../utils/ai');
const commands = require('../telegram/commands');
const { decomposeTask, markSubtaskComplete } = require('../decomposition/decompose');

// ── Webhook entry point ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  res.status(200).send('OK');

  try {
    const update = req.body;
    await handleUpdate(update);
  } catch (err) {
    logger.error('Telegram webhook error:', err.message, err.stack);
  }
});

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message) return;

  const chatId = String(message.chat.id);

  if (chatId !== process.env.TELEGRAM_OPERATOR_CHAT_ID) {
    logger.warn(`Unauthorized Telegram message from chat ${chatId}`);
    return;
  }

  const { session, business } = await getOrCreateSession(chatId);
  if (!business) {
    await sendTelegramMessage(chatId, '⚠️ No business configured. Run the setup first.');
    return;
  }

  let text = message.text || '';
  let inputType = 'text';

  if (message.voice) {
    inputType = 'voice';
    text = await handleVoiceMessage(message, chatId);
    if (!text) return;
  }

  if (!text.trim()) return;

  console.log('[TELEGRAM] Message received:', text);

  if (text.startsWith('/')) {
    await handleCommand(text, chatId, business.id, session);
    return;
  }

  await handleConversation(text, chatId, business.id, session, inputType);
}

// ── Voice Message Handler ─────────────────────────────────────────────────────
async function handleVoiceMessage(message, chatId) {
  await sendTelegramMessage(chatId, '🎙 Transcribing...');
  try {
    const fileInfo = await getTelegramFile(message.voice.file_id);
    const audioBuffer = await downloadTelegramFile(fileInfo.file_path);
    const transcript = await transcribeAudio(audioBuffer, 'voice.ogg');
    await sendTelegramMessage(chatId, `📝 _Heard:_ "${transcript}"`);
    return transcript;
  } catch (err) {
    logger.error('Voice transcription failed:', err.message);
    await sendTelegramMessage(chatId, '❌ Could not transcribe voice message. Try typing instead.');
    return null;
  }
}

// ── Command Handler ───────────────────────────────────────────────────────────
async function handleCommand(text, chatId, businessId, session) {
  const parts = text.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  const cmdHandlers = {
    '/status':    () => commands.handleStatus(chatId, businessId),
    '/briefing':  () => commands.handleBriefing(chatId, businessId),
    '/pipeline':  () => commands.handlePipeline(chatId, businessId),
    '/tasks':     () => commands.handleTasks(chatId, businessId),
    '/approvals': () => commands.handleApprovals(chatId, businessId),
    '/remember':  () => commands.handleRemember(chatId, businessId, args),
    '/lead':      () => commands.handleLead(chatId, businessId, args),
    '/report':    () => commands.handleReport(chatId, businessId, args),
    '/mode':      () => commands.handleMode(chatId, businessId, args),
    '/switch':    () => commands.handleSwitch(chatId, args),
    '/push':      () => commands.handlePush(chatId, businessId, args),
    '/help':      () => commands.handleHelp(chatId),
    '/opmode':    () => commands.handleOperatorMode(chatId, businessId, args),
    '/explain':   () => commands.handleExplain(chatId, businessId),
    '/tools':     () => commands.handleTools(chatId),
  };

  const handler = cmdHandlers[cmd];
  if (handler) {
    await handler();
  } else {
    await sendTelegramMessage(chatId, `Unknown command: ${cmd}\nSend /help for a list of commands.`);
  }
}

// ── Full Orchestrator Flow ────────────────────────────────────────────────────
async function handleConversation(text, chatId, businessId, session, inputType) {
  try {
    await sendTelegramMessage(chatId, '⏳ _Thinking..._');

    const context = await buildContext({
      businessId,
      userInput: text,
      sessionId: session?.id,
    });
    console.log('[CONTEXT] Built successfully, business_id:', context.business_id);

    const decompositionContext = await decomposeTask({
      businessId,
      task: text,
      sessionId: session?.id,
      context,
    });
    console.log('[DECOMPOSE] Done, isComplex:', decompositionContext.isComplex);

    if (decompositionContext.isComplex && decompositionContext.subtasks.length > 1) {
      await sendTelegramMessage(
        chatId,
        `🔀 _Complex task detected — breaking into ${decompositionContext.subtasks.length} steps..._`
      );
    }

    console.log('[CEO] Calling agent with task:', text);
    const agentOutput = await runCEOAgent({
      task: text,
      context,
      sessionId: session?.id,
      decompositionContext,
    });
    console.log('[CEO] Response received:', JSON.stringify(agentOutput).slice(0, 200));

    await writeMemoryUpdates(businessId, agentOutput.memory_updates);

    if (agentOutput.proposed_actions?.length > 0) {
      const { auto_actions, approval_actions, blocked_actions } =
        await processProposedActions(businessId, agentOutput.proposed_actions, agentOutput.confidence);

      if (auto_actions.length > 0) {
        await enqueueMany(
          businessId,
          auto_actions.map((a) => ({ ...a, status: 'pending', approved_by: 'auto' }))
        );
      }

      for (const action of approval_actions) {
        const queued = await enqueue(businessId, { ...action, status: 'approval_required' });
        await sendApprovalRequest(chatId, queued, action);
      }

      if (blocked_actions.length > 0) {
        logger.info(`${blocked_actions.length} action(s) blocked by permission layer`);
      }
    }

    await updateSession(session?.id, { last_task: text, last_response: agentOutput.summary });

    if (decompositionContext.decompositionId) {
      await markSubtaskComplete(decompositionContext.decompositionId, 'st_1');
    }

    // FIX: use \n instead of raw line break in template literal
    let responseText = agentOutput.summary;
    if (agentOutput.reasoning_summary && agentOutput.confidence < 0.8) {
      responseText += `\n\n_Reasoning: ${agentOutput.reasoning_summary}_`;
    }

    await sendTelegramMessage(chatId, responseText);
    console.log('[TELEGRAM] Response sent');

  } catch (err) {
    console.error('[ERROR] Full error:', err);
    console.error('[ERROR] Stack:', err.stack);
    logger.error('Conversation handler error:', err.message);
    await sendTelegramMessage(chatId, `❌ Something went wrong: ${err.message}`);
  }
}

// ── Callback Query Handler ────────────────────────────────────────────────────
async function handleCallbackQuery(query) {
  const chatId = String(query.message.chat.id);
  if (chatId !== process.env.TELEGRAM_OPERATOR_CHAT_ID) return;

  const data = query.data;
  const [action, actionId] = data.split(':');

  try {
    if (action === 'approve') {
      await approveAction(actionId, 'operator');
      await sendTelegramMessage(chatId, '✅ Action approved and queued for execution.');
    } else if (action === 'reject') {
      await rejectAction(actionId, 'Rejected via Telegram button');
      await sendTelegramMessage(chatId, '❌ Action rejected.');
    } else if (action === 'snooze') {
      const supabase = db();
      await supabase
        .from('action_queue')
        .update({ scheduled_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
        .eq('id', actionId);
      await sendTelegramMessage(chatId, '💤 Snoozed for 2 hours.');
    }
  } catch (err) {
    await sendTelegramMessage(chatId, `Error processing action: ${err.message}`);
  }
}

// ── Session Management ────────────────────────────────────────────────────────
async function getOrCreateSession(chatId) {
  const supabase = db();

  // TODO: when multi-business — resolve business from telegram_chat_id → user → business_users
  const { data: business } = await supabase
    .from('businesses')
    .select('id,name,mode')
    .eq('active', true)
    .limit(1)
    .single();

  if (!business) return { session: null, business: null };

  // FIX: user_id is UUID in schema — store chat ID in context instead, keep user_id null
  let { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('business_id', business.id)
    .eq('channel', 'telegram')
    .contains('context', { telegram_chat_id: chatId })
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!session) {
    const { data: newSession } = await supabase
      .from('sessions')
      .insert({
        business_id: business.id,
        user_id: null,
        channel: 'telegram',
        context: { telegram_chat_id: chatId },
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();
    session = newSession;
  }

  return { session, business };
}

async function updateSession(sessionId, context) {
  if (!sessionId) return;
  const supabase = db();
  try {
    await supabase
      .from('sessions')
      .update({
        context,
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      })
      .eq('id', sessionId);
  } catch (e) {}
}

// ── Telegram File Helpers ─────────────────────────────────────────────────────
async function getTelegramFile(fileId) {
  const axios = require('axios');
  const resp = await axios.get(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  return resp.data.result;
}

async function downloadTelegramFile(filePath) {
  const axios = require('axios');
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const resp = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(resp.data);
}

module.exports = router;

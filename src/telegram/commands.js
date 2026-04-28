const { db } = require('../utils/supabase');
const { sendTelegramMessage, sendApprovalRequest } = require('../telegram/sender');
const { buildContext } = require('../context/builder');
const { runCEOAgent } = require('../agents/ceo');
const { runRevenueAgent } = require('../agents/revenue');
const { writeMemory } = require('../memory/manager');
const { enqueue } = require('../queue/enqueue');

async function handleStatus(chatId, businessId) {
  const supabase = db();

  const [{ data: leads }, { data: opps }, { data: tasks }, { count: approvals }] =
    await Promise.all([
      supabase.from('leads').select('status').eq('business_id', businessId).not('status', 'in', '("won","lost")'),
      supabase.from('opportunities').select('stage,value').eq('business_id', businessId).not('stage', 'in', '("won","lost")'),
      supabase.from('tasks').select('status,priority').eq('business_id', businessId).in('status', ['pending', 'in_progress', 'overdue']),
      supabase.from('action_queue').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('status', 'approval_required'),
    ]);

  const newLeads = leads?.filter((l) => l.status === 'new').length || 0;
  const totalValue = opps?.reduce((s, o) => s + parseFloat(o.value || 0), 0) || 0;
  const overdue = tasks?.filter((t) => t.status === 'overdue').length || 0;

  const msg = [
    '📊 *Status Report*',
    '',
    `👤 *Leads*: ${leads?.length || 0} active (${newLeads} new)`,
    `💼 *Pipeline*: ${opps?.length || 0} deals | $${totalValue.toLocaleString()}`,
    `✅ *Tasks*: ${tasks?.length || 0} open | ${overdue} overdue`,
    `⏳ *Pending Approvals*: ${approvals || 0}`,
  ].join('\n');

  await sendTelegramMessage(chatId, msg);
}

async function handleBriefing(chatId, businessId) {
  await sendTelegramMessage(chatId, '⏳ _Generating briefing..._');

  const context = await buildContext({
    businessId,
    userInput: 'daily briefing and priorities',
  });

  const output = await runCEOAgent({
    task: 'Generate my morning briefing: top 3 priorities, pipeline health, any overnight alerts, and one key insight.',
    context,
  });

  await sendTelegramMessage(chatId, output.summary);
}

async function handlePipeline(chatId, businessId) {
  const supabase = db();

  const { data: opps } = await supabase
    .from('opportunities')
    .select('name,stage,value,close_date,stalled_at,leads(name)')
    .eq('business_id', businessId)
    .not('stage', 'in', '("won","lost")')
    .order('value', { ascending: false });

  if (!opps || opps.length === 0) {
    await sendTelegramMessage(chatId, 'No active opportunities in pipeline.');
    return;
  }

  const now = Date.now();
  const lines = [`💼 *Pipeline (${opps.length} deals)*`, ''];

  for (const opp of opps) {
    const stalledAt = opp.stalled_at ? new Date(opp.stalled_at).getTime() : now;
    const daysSinceMoved = Math.floor((now - stalledAt) / 86400000);
    const stall = daysSinceMoved > 3 ? ` ⚠️ ${daysSinceMoved}d` : '';

    lines.push(
      `• *${opp.name}* — $${parseFloat(opp.value || 0).toLocaleString()}\n  ${opp.stage} | ${opp.leads?.name || '?'}${stall}`
    );
  }

  await sendTelegramMessage(chatId, lines.join('\n'));
}

async function handleTasks(chatId, businessId) {
  const supabase = db();

  const { data: tasks } = await supabase
    .from('tasks')
    .select('title,status,priority,due_at')
    .eq('business_id', businessId)
    .in('status', ['pending', 'in_progress', 'overdue'])
    .order('priority', { ascending: false })
    .limit(15);

  if (!tasks || tasks.length === 0) {
    await sendTelegramMessage(chatId, '✅ No open tasks.');
    return;
  }

  const lines = [`📋 *Open Tasks (${tasks.length})*`, ''];

  for (const t of tasks) {
    const overdueMark = t.status === 'overdue' ? ' 🔴' : '';
    const due = t.due_at ? ` | due ${new Date(t.due_at).toLocaleDateString()}` : '';
    lines.push(`• [P${t.priority}] ${t.title}${overdueMark}${due}`);
  }

  await sendTelegramMessage(chatId, lines.join('\n'));
}

async function handleApprovals(chatId, businessId) {
  const supabase = db();

  const { data: actions } = await supabase
    .from('action_queue')
    .select('id,action_type,payload,created_at,priority')
    .eq('business_id', businessId)
    .eq('status', 'approval_required')
    .order('priority', { ascending: false })
    .limit(10);

  if (!actions || actions.length === 0) {
    await sendTelegramMessage(chatId, '✅ No pending approvals.');
    return;
  }

  await sendTelegramMessage(chatId, `⏳ *${actions.length} pending approval(s)*:`);

  for (const action of actions) {
    await sendApprovalRequest(chatId, action, action);
  }
}

async function handleRemember(chatId, businessId, text) {
  if (!text.trim()) {
    await sendTelegramMessage(chatId, 'Usage: /remember [what you want me to remember]');
    return;
  }

  await writeMemory(businessId, {
    type: 'note',
    content: text,
    importance: 7,
    source: 'operator_manual',
  });

  await sendTelegramMessage(chatId, `✅ Got it. I'll remember: "${text}"`);
}

async function handleLead(chatId, businessId, nameQuery) {
  if (!nameQuery.trim()) {
    await sendTelegramMessage(chatId, 'Usage: /lead [name or email]');
    return;
  }

  const supabase = db();

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('business_id', businessId)
    .or(`name.ilike.%${nameQuery}%,email.ilike.%${nameQuery}%`)
    .limit(3);

  if (!leads || leads.length === 0) {
    await sendTelegramMessage(chatId, `No lead found matching "${nameQuery}"`);
    return;
  }

  const lead = leads[0];

  const { data: interactions } = await supabase
    .from('interactions')
    .select('channel,direction,content,created_at')
    .eq('lead_id', lead.id)
    .order('created_at', { ascending: false })
    .limit(3);

  const lines = [
    `👤 *${lead.name}*`,
    `Status: ${lead.status} | Score: ${lead.lead_score || '?'}/100`,
    `Source: ${lead.source || 'unknown'}`,
    lead.email ? `Email: ${lead.email}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.last_contacted_at ? `Last contact: ${new Date(lead.last_contacted_at).toLocaleDateString()}` : 'Never contacted',
    '',
    interactions?.length > 0 ? '*Recent interactions:*' : 'No interactions yet.',
    ...(interactions || []).map((i) => `• [${i.channel}] ${i.direction}: ${(i.content || '').slice(0, 80)}...`),
  ].filter(Boolean);

  await sendTelegramMessage(chatId, lines.join('\n'));
}

async function handleReport(chatId, businessId, type) {
  await sendTelegramMessage(chatId, `⏳ _Generating ${type || 'revenue'} report..._`);

  const context = await buildContext({
    businessId,
    userInput: `generate ${type} report`,
  });

  const output = await runRevenueAgent({
    task: `Generate a ${type || 'revenue'} report with current data.`,
    context,
  });

  await sendTelegramMessage(chatId, output.summary);
}

async function handleMode(chatId, businessId, modeName) {
  const validModes = ['booking_mode', 'product_push_mode', 'balanced_mode', 'admin_mode', 'strategy_mode'];

  if (!validModes.includes(modeName)) {
    await sendTelegramMessage(chatId, `Valid modes: ${validModes.join(', ')}\nUsage: /mode [mode_name]`);
    return;
  }

  const action = await enqueue(businessId, {
    action_type: 'switch_mode',
    payload: { new_mode: modeName, reason: 'operator_request' },
    priority: 7,
    status: 'approval_required',
  });

  await sendTelegramMessage(chatId, `Mode switch to *${modeName}* requires confirmation.`);
  await sendApprovalRequest(chatId, action, action);
}

async function handleSwitch(chatId, bizName) {
  const supabase = db();

  const { data: biz, error } = await supabase
    .from('businesses')
    .select('id,name,mode')
    .eq('active', true)
    .ilike('name', `%${bizName}%`)
    .limit(1)
    .single();

  if (error || !biz) {
    await sendTelegramMessage(chatId, `No business found matching "${bizName}"`);
    return;
  }

  await supabase
    .from('sessions')
    .update({
      business_id: biz.id,
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    })
    .eq('user_id', chatId);

  await sendTelegramMessage(chatId, `✅ Switched to *${biz.name}* (${biz.mode})`);
  await handleStatus(chatId, biz.id);
}

async function handlePush(chatId, businessId, productName) {
  if (!productName.trim()) {
    await sendTelegramMessage(chatId, 'Usage: /push [product name]');
    return;
  }

  await sendTelegramMessage(chatId, `⏳ _Drafting campaign for ${productName}..._`);

  const context = await buildContext({
    businessId,
    userInput: `product push campaign for ${productName}`,
  });

  const { runMarketingAgent } = require('../agents/marketing');

  const output = await runMarketingAgent({
    task: `Create a full 4-part, 10-day campaign sequence for ${productName}. Draft all 4 messages ready for approval.`,
    context,
  });

  for (const action of output.proposed_actions || []) {
    if (action.action_type === 'trigger_campaign' || action.action_type === 'send_message') {
      const queued = await enqueue(businessId, {
        ...action,
        status: 'approval_required',
      });

      await sendApprovalRequest(chatId, queued, action);
    }
  }

  await sendTelegramMessage(chatId, output.summary);
}

async function handleHelp(chatId) {
  const help = [
    '*The Partner — Command Reference*',
    '',
    '/status — Pipeline snapshot',
    '/briefing — Morning briefing',
    '/pipeline — Full deal view',
    '/tasks — Open tasks',
    '/approvals — Pending approvals',
    '/lead [name] — Lead details',
    '/remember [text] — Save a note',
    '/report [type] — Generate report',
    '/mode [mode] — Switch system mode',
    '/switch [business] — Switch business',
    '/push [product] — Product campaign',
    '',
    'Or just _type anything_ to talk to The Partner.',
    'Voice notes are also supported 🎙',
  ].join('\n');

  await sendTelegramMessage(chatId, help);
}

async function handleOperatorMode(chatId, businessId, modeName) {
  const validModes = ['assisted', 'semi_autonomous', 'autonomous'];

  if (!validModes.includes(modeName)) {
    await sendTelegramMessage(
      chatId,
      [
        '*Operator Modes:*',
        '',
        '• `assisted` — Everything requires your approval (safest)',
        '• `semi_autonomous` — Follow configured permission rules',
        '• `autonomous` — Auto-execute all safe actions',
        '',
        'Usage: /opmode [mode_name]',
      ].join('\n')
    );
    return;
  }

  const supabase = db();

  const { data: biz } = await supabase
    .from('businesses')
    .select('operator_mode')
    .eq('id', businessId)
    .single();

  await supabase.from('operator_mode_history').insert({
    business_id: businessId,
    from_mode: biz?.operator_mode || 'assisted',
    to_mode: modeName,
    reason: 'operator_request',
    changed_by: 'operator',
  });

  await supabase
    .from('businesses')
    .update({ operator_mode: modeName })
    .eq('id', businessId);

  await sendTelegramMessage(
    chatId,
    [
      `✅ Operator mode set to *${modeName}*`,
      '',
      getModeDescription(modeName),
    ].join('\n')
  );
}

function getModeDescription(mode) {
  const desc = {
    assisted: '🔒 All actions require your approval. Maximum control.',
    semi_autonomous: '⚖️ Follows your configured permission rules. Balanced.',
    autonomous: '🚀 Auto-executes safe actions. Maximum speed.',
  };

  return desc[mode] || '';
}

async function handleExplain(chatId, businessId) {
  const supabase = db();

  const { data: decisions } = await supabase
    .from('decision_logs')
    .select('agent,task,reasoning_summary,explanation,confidence,tool_selected,created_at')
    .eq('business_id', businessId)
    .not('reasoning_summary', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (!decisions || decisions.length === 0) {
    await sendTelegramMessage(chatId, 'No recent decisions with explanations found.');
    return;
  }

  const lines = [
    '🧠 *Last 3 Decisions with Reasoning*',
    '',
  ];

  for (const d of decisions) {
    const confidence = typeof d.confidence === 'number' ? `${(d.confidence * 100).toFixed(0)}%` : '?';

    lines.push(`*Task:* ${(d.task || '').slice(0, 80)}`);
    lines.push(`*Agent:* ${d.agent || 'unknown'} | Confidence: ${confidence}`);

    if (d.tool_selected) {
      lines.push(`*Tool:* ${d.tool_selected}`);
    }

    lines.push(`*Reasoning:* ${d.reasoning_summary || d.explanation || 'none'}`);
    lines.push('');
  }

  await sendTelegramMessage(chatId, lines.join('\n'));
}

async function handleTools(chatId) {
  const { getAvailableTools } = require('../tools/registry');

  const tools = await getAvailableTools();
  const byType = { api: [], browser: [], system: [] };

  for (const t of tools || []) {
    if (byType[t.execution_type]) {
      byType[t.execution_type].push(t.tool_name);
    }
  }

  const lines = [
    '🔧 *Available Tools*',
    '',
    `*API (${byType.api.length}):* ${byType.api.join(', ') || 'none'}`,
    `*Browser (${byType.browser.length}):* ${byType.browser.join(', ') || 'none'}`,
    `*System (${byType.system.length}):* ${byType.system.join(', ') || 'none'}`,
  ];

  await sendTelegramMessage(chatId, lines.join('\n'));
}

module.exports = {
  handleStatus,
  handleBriefing,
  handlePipeline,
  handleTasks,
  handleApprovals,
  handleRemember,
  handleLead,
  handleReport,
  handleMode,
  handleSwitch,
  handlePush,
  handleHelp,
  handleOperatorMode,
  handleExplain,
  handleTools,
};
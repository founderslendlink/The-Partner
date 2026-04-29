'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Play, Pause, Trash2, ArrowLeft, Save, Zap, Clock, Mail,
  MessageSquare, CheckSquare, GitBranch, Brain, Webhook, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useBusiness } from '@/lib/business-context';
import {
  getAutomations, createAutomation, updateAutomation, deleteAutomation,
  toggleAutomation, testAutomation,
} from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface AutomationStep {
  id: string;
  type: string;
  config: Record<string, unknown>;
  next?: string;
  next_true?: string;
  next_false?: string;
}

interface Automation {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  trigger_type: string;
  trigger_conditions: Record<string, unknown>;
  steps: AutomationStep[];
  run_count: number;
  last_run_at?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TRIGGER_TYPES = [
  { value: 'lead_created',              label: 'Lead Created' },
  { value: 'lead_status_changed',       label: 'Lead Status Changed' },
  { value: 'opportunity_stage_changed', label: 'Deal Stage Changed' },
  { value: 'opportunity_stalled',       label: 'Deal Stalled' },
  { value: 'task_overdue',              label: 'Task Overdue' },
  { value: 'meeting_booked',            label: 'Meeting Booked' },
  { value: 'meeting_completed',         label: 'Meeting Completed' },
  { value: 'deal_won',                  label: 'Deal Won' },
  { value: 'deal_lost',                 label: 'Deal Lost' },
  { value: 'inbound_message',           label: 'Inbound Message' },
  { value: 'manual',                    label: 'Manual (run on demand)' },
];

const STEP_TYPES = [
  { value: 'wait',         label: 'Wait',         icon: Clock,          color: 'bg-blue-900/40 border-blue-700' },
  { value: 'send_email',   label: 'Send Email',   icon: Mail,           color: 'bg-green-900/40 border-green-700' },
  { value: 'send_sms',     label: 'Send SMS',     icon: MessageSquare,  color: 'bg-green-900/40 border-green-700' },
  { value: 'create_task',  label: 'Create Task',  icon: CheckSquare,    color: 'bg-yellow-900/40 border-yellow-700' },
  { value: 'update_lead',  label: 'Update Lead',  icon: RefreshCw,      color: 'bg-red-900/40 border-red-700' },
  { value: 'add_tag',      label: 'Add Tag',      icon: Zap,            color: 'bg-red-900/40 border-red-700' },
  { value: 'ai_action',    label: 'AI Action',    icon: Brain,          color: 'bg-purple-900/40 border-purple-700' },
  { value: 'condition',    label: 'Condition',    icon: GitBranch,      color: 'bg-orange-900/40 border-orange-700' },
  { value: 'webhook',      label: 'Webhook',      icon: Webhook,        color: 'bg-gray-800 border-gray-600' },
];

// ── Pre-built Templates ────────────────────────────────────────────────────────

const TEMPLATES: Partial<Automation>[] = [
  {
    name: 'New Lead Welcome Sequence',
    description: 'Greet new leads with an AI-drafted welcome SMS, then follow up after 24 hours.',
    trigger_type: 'lead_created',
    trigger_conditions: {},
    steps: [
      { id: 's1', type: 'wait',       config: { duration: 15, unit: 'minutes' }, next: 's2' },
      { id: 's2', type: 'ai_action',  config: { instruction: 'Draft a warm, personalized welcome SMS for this new lead. Keep it under 160 characters. Reference their source if available.', action_type: 'send_sms', requires_approval: true }, next: 's3' },
      { id: 's3', type: 'wait',       config: { duration: 24, unit: 'hours' }, next: 's4' },
      { id: 's4', type: 'condition',  config: { field: 'status', operator: 'eq', value: 'contacted' }, next_true: 's5', next_false: 's6' },
      { id: 's5', type: 'create_task', config: { title: 'Follow up call with {{name}}', priority: 7, due_in_hours: 4 } },
      { id: 's6', type: 'send_email', config: { subject: 'Following up on your interest', body: 'Hi {{name}},\n\nI wanted to follow up and see if you have any questions. I\'d love to connect.\n\nBest regards' } },
    ],
  },
  {
    name: 'Stalled Deal Recovery',
    description: 'AI drafts a personalized recovery message when a deal has stalled, sends for approval.',
    trigger_type: 'opportunity_stalled',
    trigger_conditions: {},
    steps: [
      { id: 's1', type: 'ai_action', config: { instruction: 'Draft a personalized re-engagement message for this stalled deal. Reference the deal name and last stage. Keep it concise and compelling.', action_type: 'send_sms', requires_approval: true } },
    ],
  },
  {
    name: 'Post-Win Referral Request',
    description: 'Wait 7 days after closing a deal, then ask for a referral via email.',
    trigger_type: 'deal_won',
    trigger_conditions: {},
    steps: [
      { id: 's1', type: 'wait',      config: { duration: 7, unit: 'days' }, next: 's2' },
      { id: 's2', type: 'ai_action', config: { instruction: 'Draft a personalized referral request email. Congratulate them on their decision, thank them for their business, and ask if they know anyone who could benefit from our services.', action_type: 'send_email', requires_approval: true }, next: 's3' },
      { id: 's3', type: 'create_task', config: { title: 'Follow up on referral request — {{name}}', priority: 4, due_in_hours: 168 } },
    ],
  },
  {
    name: 'Meeting Follow Up',
    description: 'Send a personalized thank-you and next steps email 2 hours after a meeting.',
    trigger_type: 'meeting_completed',
    trigger_conditions: {},
    steps: [
      { id: 's1', type: 'wait',      config: { duration: 2, unit: 'hours' }, next: 's2' },
      { id: 's2', type: 'ai_action', config: { instruction: 'Draft a thank-you email covering what was discussed in the meeting and clear next steps. Be specific and professional.', action_type: 'send_email', requires_approval: true }, next: 's3' },
      { id: 's3', type: 'create_task', config: { title: 'Follow up with {{name}} — 3 days', priority: 6, due_in_hours: 72 } },
    ],
  },
  {
    name: 'Lead Nurture Sequence',
    description: 'Drip email sequence when a lead becomes qualified.',
    trigger_type: 'lead_status_changed',
    trigger_conditions: { status: 'qualified' },
    steps: [
      { id: 's1', type: 'send_email', config: { subject: 'How we help businesses like yours', body: 'Hi {{name}},\n\nThank you for your interest. I wanted to share how we\'ve helped similar businesses...' }, next: 's2' },
      { id: 's2', type: 'wait',       config: { duration: 3, unit: 'days' }, next: 's3' },
      { id: 's3', type: 'send_email', config: { subject: 'A quick case study for you', body: 'Hi {{name}},\n\nI thought you\'d find this case study relevant to what you\'re trying to achieve...' }, next: 's4' },
      { id: 's4', type: 'wait',       config: { duration: 3, unit: 'days' }, next: 's5' },
      { id: 's5', type: 'ai_action',  config: { instruction: 'Draft a personalized offer email based on this lead\'s history and interests.', action_type: 'send_email', requires_approval: true } },
    ],
  },
  {
    name: 'Re-engagement Campaign',
    description: 'Manually trigger to re-engage leads who haven\'t been contacted in 30+ days.',
    trigger_type: 'manual',
    trigger_conditions: {},
    steps: [
      { id: 's1', type: 'condition', config: { field: 'last_contacted_at', operator: 'lt', value: new Date(Date.now() - 30 * 86400000).toISOString() }, next_true: 's2', next_false: undefined },
      { id: 's2', type: 'ai_action', config: { instruction: 'Draft a re-engagement SMS referencing the last conversation topic. Keep it warm and personal. Under 160 characters.', action_type: 'send_sms', requires_approval: true } },
    ],
  },
];

// ── Step Card Component ────────────────────────────────────────────────────────

function StepCard({
  step, index, selected, onSelect, onDelete, onMoveUp, onMoveDown, isLast,
}: {
  step: AutomationStep; index: number; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void; isLast: boolean;
}) {
  const meta = STEP_TYPES.find(t => t.value === step.type);
  const Icon = meta?.icon || Zap;
  const color = meta?.color || 'bg-gray-800 border-gray-600';

  return (
    <div className="relative">
      <div
        onClick={onSelect}
        className={`border rounded-xl p-3 cursor-pointer transition-all ${color} ${selected ? 'ring-2 ring-indigo-500' : 'hover:opacity-90'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-gray-300" />
            <span className="text-sm font-medium text-white">{meta?.label || step.type}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={index === 0}
              className="p-0.5 text-gray-500 hover:text-gray-300 disabled:opacity-20">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast}
              className="p-0.5 text-gray-500 hover:text-gray-300 disabled:opacity-20">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              className="p-0.5 text-gray-500 hover:text-red-400 ml-1">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1 truncate">{getStepSummary(step)}</p>
        {step.type === 'condition' && (
          <div className="flex gap-2 mt-2">
            <span className="text-xs px-2 py-0.5 bg-green-900/30 text-green-400 rounded">TRUE → {step.next_true || 'end'}</span>
            <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-400 rounded">FALSE → {step.next_false || 'end'}</span>
          </div>
        )}
      </div>
      {!isLast && <div className="flex justify-center my-1"><div className="w-px h-4 bg-gray-700" /></div>}
    </div>
  );
}

function getStepSummary(step: AutomationStep): string {
  const c = step.config;
  switch (step.type) {
    case 'wait':       return `Wait ${c.duration} ${c.unit}`;
    case 'send_email': return `Subject: ${c.subject || '(untitled)'}`;
    case 'send_sms':   return String(c.message || '').slice(0, 60) || '(no message)';
    case 'create_task': return String(c.title || '(no title)');
    case 'update_lead': return `Set ${c.field} = ${c.value}`;
    case 'add_tag':    return `Tag: ${c.tag}`;
    case 'ai_action':  return String(c.instruction || '').slice(0, 60);
    case 'condition':  return `${c.field} ${c.operator} ${c.value}`;
    case 'webhook':    return String(c.url || '(no url)');
    default:           return '';
  }
}

// ── Step Config Editor ─────────────────────────────────────────────────────────

function StepConfigEditor({ step, onChange }: { step: AutomationStep; onChange: (s: AutomationStep) => void }) {
  const set = (key: string, val: unknown) => onChange({ ...step, config: { ...step.config, [key]: val } });
  const setRoot = (key: string, val: unknown) => onChange({ ...step, [key]: val } as AutomationStep);
  const c = step.config;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Step ID: {step.id}</p>

      {step.type === 'wait' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Duration</label>
            <input type="number" value={String(c.duration ?? 1)} onChange={e => set('duration', Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Unit</label>
            <select value={String(c.unit || 'hours')} onChange={e => set('unit', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
      )}

      {step.type === 'send_email' && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject</label>
            <input type="text" value={String(c.subject || '')} onChange={e => set('subject', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Body <span className="text-gray-600">(use {'{{name}}'} for personalization)</span></label>
            <textarea rows={4} value={String(c.body || '')} onChange={e => set('body', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
          </div>
        </>
      )}

      {step.type === 'send_sms' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Message <span className="text-gray-600">(use {'{{name}}'})</span></label>
          <textarea rows={3} value={String(c.message || '')} onChange={e => set('message', e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
        </div>
      )}

      {step.type === 'create_task' && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Task Title</label>
            <input type="text" value={String(c.title || '')} onChange={e => set('title', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Priority (1–10)</label>
              <input type="number" min={1} max={10} value={String(c.priority ?? 5)} onChange={e => set('priority', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Due In (hours)</label>
              <input type="number" value={String(c.due_in_hours ?? 24)} onChange={e => set('due_in_hours', Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
        </>
      )}

      {step.type === 'update_lead' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Field</label>
            <select value={String(c.field || 'status')} onChange={e => set('field', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="status">status</option>
              <option value="lead_score">lead_score</option>
              <option value="assigned_agent">assigned_agent</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Value</label>
            <input type="text" value={String(c.value || '')} onChange={e => set('value', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
      )}

      {step.type === 'add_tag' && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Tag</label>
          <input type="text" value={String(c.tag || '')} onChange={e => set('tag', e.target.value)}
            placeholder="hot-lead"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      )}

      {step.type === 'ai_action' && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Instruction</label>
            <textarea rows={4} value={String(c.instruction || '')} onChange={e => set('instruction', e.target.value)}
              placeholder="Draft a personalized follow-up based on this lead's history..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Action Type</label>
            <select value={String(c.action_type || 'send_sms')} onChange={e => set('action_type', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="send_sms">Send SMS</option>
              <option value="send_email">Send Email</option>
              <option value="create_task">Create Task</option>
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(c.requires_approval)} onChange={e => set('requires_approval', e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-indigo-500" />
            <span className="text-xs text-gray-300">Require approval before sending</span>
          </label>
        </>
      )}

      {step.type === 'condition' && (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Field</label>
              <input type="text" value={String(c.field || '')} onChange={e => set('field', e.target.value)}
                placeholder="lead.lead_score"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Operator</label>
              <select value={String(c.operator || 'eq')} onChange={e => set('operator', e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="gt">{'>'}</option>
                <option value="lt">{'<'}</option>
                <option value="eq">{'='}</option>
                <option value="neq">{'≠'}</option>
                <option value="contains">contains</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Value</label>
              <input type="text" value={String(c.value || '')} onChange={e => set('value', e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-green-500 mb-1">TRUE → step id</label>
              <input type="text" value={step.next_true || ''} onChange={e => setRoot('next_true', e.target.value || undefined)}
                placeholder="s2"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-red-400 mb-1">FALSE → step id</label>
              <input type="text" value={step.next_false || ''} onChange={e => setRoot('next_false', e.target.value || undefined)}
                placeholder="s3"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
          </div>
        </>
      )}

      {step.type === 'webhook' && (
        <>
          <div>
            <label className="block text-xs text-gray-400 mb-1">URL</label>
            <input type="url" value={String(c.url || '')} onChange={e => set('url', e.target.value)}
              placeholder="https://hooks.zapier.com/..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Method</label>
            <select value={String(c.method || 'POST')} onChange={e => set('method', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
        </>
      )}

      {!['condition'].includes(step.type) && (
        <div>
          <label className="block text-xs text-gray-400 mb-1">Next step id <span className="text-gray-600">(leave blank to end)</span></label>
          <input type="text" value={step.next || ''} onChange={e => setRoot('next', e.target.value || undefined)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const business = useBusiness();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading]         = useState(true);
  const [view, setView]               = useState<'list' | 'builder'>('list');
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [testing, setTesting]         = useState(false);
  const [testResult, setTestResult]   = useState<string>('');

  // Builder state
  const [autoName, setAutoName]           = useState('');
  const [autoDesc, setAutoDesc]           = useState('');
  const [triggerType, setTriggerType]     = useState('lead_created');
  const [steps, setSteps]                 = useState<AutomationStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    try {
      const data = await getAutomations(business.id) as Automation[];
      setAutomations(data);
    } catch { /* table may not exist yet */ }
    setLoading(false);
  }, [business]);

  useEffect(() => { load(); }, [load]);

  const openBuilder = (automation?: Automation) => {
    if (automation) {
      setEditingId(automation.id);
      setAutoName(automation.name);
      setAutoDesc(automation.description || '');
      setTriggerType(automation.trigger_type);
      setSteps(automation.steps || []);
    } else {
      setEditingId(null);
      setAutoName('');
      setAutoDesc('');
      setTriggerType('lead_created');
      setSteps([]);
    }
    setSelectedStepId(null);
    setTestResult('');
    setView('builder');
  };

  const loadTemplate = (tpl: Partial<Automation>) => {
    setAutoName(tpl.name || '');
    setAutoDesc(tpl.description || '');
    setTriggerType(tpl.trigger_type || 'lead_created');
    setSteps((tpl.steps || []) as AutomationStep[]);
    setSelectedStepId(null);
    setView('builder');
  };

  const addStep = (type: string) => {
    const id = `s${steps.length + 1}`;
    const defaults: Record<string, Record<string, unknown>> = {
      wait:        { duration: 1, unit: 'hours' },
      send_email:  { subject: '', body: '' },
      send_sms:    { message: '' },
      create_task: { title: '', priority: 5, due_in_hours: 24 },
      update_lead: { field: 'status', value: 'contacted' },
      add_tag:     { tag: '' },
      ai_action:   { instruction: '', action_type: 'send_sms', requires_approval: true },
      condition:   { field: 'lead_score', operator: 'gt', value: 50 },
      webhook:     { url: '', method: 'POST' },
    };
    const newStep: AutomationStep = { id, type, config: defaults[type] || {}, next: undefined };

    // Wire previous step's next to this one
    setSteps(prev => {
      const updated = [...prev];
      if (updated.length > 0) {
        const last = { ...updated[updated.length - 1] };
        if (last.type !== 'condition') last.next = id;
        updated[updated.length - 1] = last;
      }
      return [...updated, newStep];
    });
    setSelectedStepId(id);
  };

  const updateStep = (updated: AutomationStep) => {
    setSteps(prev => prev.map(s => s.id === updated.id ? updated : s));
  };

  const deleteStep = (id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
    if (selectedStepId === id) setSelectedStepId(null);
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps(prev => {
      const arr = [...prev];
      const swap = index + dir;
      if (swap < 0 || swap >= arr.length) return arr;
      [arr[index], arr[swap]] = [arr[swap], arr[index]];
      return arr;
    });
  };

  const save = async () => {
    if (!business || !autoName) return;
    setSaving(true);
    try {
      const payload = {
        business_id: business.id, name: autoName, description: autoDesc,
        trigger_type: triggerType, trigger_conditions: {}, steps,
      };
      if (editingId) {
        await updateAutomation(editingId, payload);
      } else {
        await createAutomation(payload);
      }
      await load();
      setView('list');
    } catch (err: unknown) {
      alert(`Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleAutomation(id);
      await load();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation?')) return;
    await deleteAutomation(id);
    await load();
  };

  const runTest = async () => {
    if (!business || !editingId) return;
    setTesting(true);
    setTestResult('');
    try {
      const result = await testAutomation(editingId, business.id) as { status: string; steps: Array<{ stepId: string; type: string; result: unknown }> };
      setTestResult(`✅ Test completed — ${result.steps?.length || 0} steps executed (test mode, no real sends).`);
    } catch (err: unknown) {
      setTestResult(`❌ Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  const selectedStep = steps.find(s => s.id === selectedStepId) || null;

  if (view === 'builder') {
    return (
      <div className="flex h-full overflow-hidden">
        {/* Left panel — Trigger */}
        <div className="w-56 shrink-0 border-r border-gray-800 p-4 space-y-4 overflow-y-auto">
          <button onClick={() => setView('list')} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Name</p>
            <input type="text" value={autoName} onChange={e => setAutoName(e.target.value)}
              placeholder="My automation"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Trigger</p>
            <select value={triggerType} onChange={e => setTriggerType(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
              {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Add Step</p>
            <div className="space-y-1">
              {STEP_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.value} onClick={() => addStep(t.value)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors text-left">
                    <Icon className="w-3.5 h-3.5 shrink-0" />{t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center — Canvas */}
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-xs mx-auto">
            {/* Trigger badge */}
            <div className="bg-indigo-900/40 border border-indigo-700 rounded-xl p-3 mb-2 text-center">
              <p className="text-xs font-semibold text-indigo-300 uppercase tracking-wider">Trigger</p>
              <p className="text-sm text-white mt-0.5">{TRIGGER_TYPES.find(t => t.value === triggerType)?.label || triggerType}</p>
            </div>
            {steps.length > 0 && <div className="flex justify-center my-1"><div className="w-px h-4 bg-gray-700" /></div>}

            {/* Steps */}
            {steps.map((step, i) => (
              <StepCard
                key={step.id} step={step} index={i}
                selected={selectedStepId === step.id}
                onSelect={() => setSelectedStepId(prev => prev === step.id ? null : step.id)}
                onDelete={() => deleteStep(step.id)}
                onMoveUp={() => moveStep(i, -1)}
                onMoveDown={() => moveStep(i, 1)}
                isLast={i === steps.length - 1}
              />
            ))}

            {steps.length === 0 && (
              <div className="text-center py-8 text-gray-700 text-sm border border-dashed border-gray-800 rounded-xl">
                Add steps from the left panel
              </div>
            )}
          </div>
        </div>

        {/* Right panel — Config + actions */}
        <div className="w-72 shrink-0 border-l border-gray-800 p-4 overflow-y-auto space-y-4">
          {selectedStep ? (
            <>
              <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Configure Step</p>
              <StepConfigEditor step={selectedStep} onChange={updateStep} />
            </>
          ) : (
            <div className="text-xs text-gray-600 text-center pt-8">Click a step to configure it</div>
          )}

          <div className="pt-4 space-y-2 border-t border-gray-800">
            <button onClick={save} disabled={saving || !autoName}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {editingId ? 'Save Changes' : 'Create Automation'}
            </button>
            {editingId && (
              <button onClick={runTest} disabled={testing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors">
                {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Test Run
              </button>
            )}
            {testResult && <p className="text-xs text-gray-400 leading-relaxed">{testResult}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── List View ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Automations</h1>
          <p className="text-sm text-gray-500 mt-0.5">Visual workflows that combine triggers, actions, and AI</p>
        </div>
        <button onClick={() => openBuilder()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> New Automation
        </button>
      </div>

      {/* Existing automations */}
      {loading ? (
        <div className="flex items-center gap-3 text-gray-500 py-10">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : automations.length > 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Trigger</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Steps</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Runs</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {automations.map(a => (
                <tr key={a.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-white">{a.name}</p>
                    {a.description && <p className="text-xs text-gray-500 truncate max-w-xs">{a.description}</p>}
                    {/* Step type badges */}
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(a.steps || []).slice(0, 4).map((s, i) => {
                        const meta = STEP_TYPES.find(t => t.value === s.type);
                        const Icon = meta?.icon || Zap;
                        return <span key={i} className="flex items-center gap-0.5 text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5"><Icon className="w-2.5 h-2.5" />{meta?.label}</span>;
                      })}
                      {(a.steps || []).length > 4 && <span className="text-xs text-gray-600">+{a.steps.length - 4}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{TRIGGER_TYPES.find(t => t.value === a.trigger_type)?.label || a.trigger_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{(a.steps || []).length}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{a.run_count}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(a.id)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg transition-colors ${a.active ? 'bg-green-900/30 text-green-400 hover:bg-red-900/30 hover:text-red-400' : 'bg-gray-800 text-gray-500 hover:bg-green-900/30 hover:text-green-400'}`}>
                      {a.active ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      {a.active ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openBuilder(a)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Edit</button>
                      <button onClick={() => handleDelete(a.id)} className="text-xs text-gray-600 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Templates */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          {automations.length === 0 ? 'Start with a template' : 'Templates'}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {TEMPLATES.map((tpl, i) => (
            <button key={i} onClick={() => loadTemplate(tpl)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-left hover:border-indigo-600/50 hover:bg-gray-800/60 transition-all">
              <p className="text-sm font-medium text-white mb-1">{tpl.name}</p>
              <p className="text-xs text-gray-500 leading-relaxed mb-3">{tpl.description}</p>
              <div className="flex gap-1 flex-wrap">
                {(tpl.steps || []).slice(0, 5).map((s, j) => {
                  const meta = STEP_TYPES.find(t => t.value === s.type);
                  const Icon = meta?.icon || Zap;
                  return <span key={j} className="flex items-center gap-0.5 text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5"><Icon className="w-2.5 h-2.5" />{meta?.label}</span>;
                })}
              </div>
              <p className="text-xs text-indigo-400 mt-3">Use template →</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

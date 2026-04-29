'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';

interface MetricRow {
  metric_key: string;
  value: number;
  period_start: string;
  period: string;
}

interface AgentHealth {
  agent_name: string;
  status: 'healthy' | 'degraded' | 'offline';
  last_run_at: string | null;
  error_count: number;
}

interface AffiliateRow {
  id: string;
  name: string;
  total_referrals: number;
  total_earned: number;
}

interface CommissionRow {
  id: string;
  amount: number;
  status: string;
  affiliates: { name: string } | null;
}

interface ReferralStats {
  totalThisMonth: number;
  conversionRate: number;
  pendingCommissions: CommissionRow[];
  topAffiliates: AffiliateRow[];
}

const DEFAULT_AGENTS: AgentHealth[] = [
  { agent_name: 'ceo', status: 'healthy', last_run_at: null, error_count: 0 },
  { agent_name: 'sales_pipeline', status: 'healthy', last_run_at: null, error_count: 0 },
  { agent_name: 'revenue', status: 'healthy', last_run_at: null, error_count: 0 },
  { agent_name: 'operations_memory', status: 'healthy', last_run_at: null, error_count: 0 },
  { agent_name: 'marketing', status: 'healthy', last_run_at: null, error_count: 0 },
];

const AGENT_STATUS_STYLE: Record<string, string> = {
  healthy:  'bg-green-500',
  degraded: 'bg-yellow-500',
  offline:  'bg-red-500',
};

const STAGE_COLORS: Record<string, string> = {
  prospect:    '#6366f1',
  proposal:    '#8b5cf6',
  negotiation: '#f59e0b',
  won:         '#10b981',
  lost:        '#ef4444',
};

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'];

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

export default function IntelligencePage() {
  const business = useBusiness();
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [opps, setOpps] = useState<{ stage: string; value: number; name: string }[]>([]);
  const [sources, setSources] = useState<{ source: string; count: number }[]>([]);
  const [decisions, setDecisions] = useState<{ id: string; agent: string; task: string; confidence: number; reasoning_summary?: string; created_at: string }[]>([]);
  const [agentHealth, setAgentHealth] = useState<AgentHealth[]>(DEFAULT_AGENTS);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [referral, setReferral] = useState<ReferralStats>({
    totalThisMonth: 0,
    conversionRate: 0,
    pendingCommissions: [],
    topAffiliates: [],
  });

  const load = useCallback(async () => {
    if (!business) return;
    const supabase = createClient();

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [metricsRes, oppsRes, leadsRes, decisionsRes, referralRes, affiliatesRes, commissionsRes, healthRes] = await Promise.all([
      supabase
        .from('metrics')
        .select('metric_key,value,period_start,period')
        .eq('business_id', business.id)
        .eq('period', period)
        .order('period_start', { ascending: true })
        .limit(100),
      supabase
        .from('opportunities')
        .select('stage,value,name')
        .eq('business_id', business.id),
      supabase
        .from('leads')
        .select('source')
        .eq('business_id', business.id),
      supabase
        .from('decision_logs')
        .select('id,agent,task,confidence,reasoning_summary,created_at')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('referral_tracking')
        .select('id,status,created_at')
        .eq('business_id', business.id)
        .gte('created_at', monthStart.toISOString()),
      supabase
        .from('affiliates')
        .select('id,name,total_referrals,total_earned')
        .eq('business_id', business.id)
        .eq('status', 'active')
        .order('total_referrals', { ascending: false })
        .limit(5),
      supabase
        .from('commissions')
        .select('id,amount,status,affiliates(name)')
        .eq('business_id', business.id)
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(10),
      // @ts-ignore — agent_health table may not exist yet; handle gracefully
      supabase
        .from('agent_health')
        .select('agent_name,status,last_run_at,error_count')
        .eq('business_id', business.id),
    ]);

    setMetrics((metricsRes.data as MetricRow[]) || []);
    setOpps((oppsRes.data as typeof opps) || []);

    const sourceMap: Record<string, number> = {};
    for (const l of (leadsRes.data || []) as { source?: string }[]) {
      const s = l.source || 'unknown';
      sourceMap[s] = (sourceMap[s] || 0) + 1;
    }
    setSources(Object.entries(sourceMap).map(([source, count]) => ({ source, count })));
    setDecisions((decisionsRes.data as typeof decisions) || []);

    if (healthRes.data && (healthRes.data as AgentHealth[]).length > 0) {
      setAgentHealth(healthRes.data as AgentHealth[]);
    } else {
      setAgentHealth(DEFAULT_AGENTS);
    }

    const refs = (referralRes.data || []) as { status: string }[];
    const converted = refs.filter((r) => r.status === 'converted' || r.status === 'paid').length;
    setReferral({
      totalThisMonth: refs.length,
      conversionRate: refs.length > 0 ? Math.round((converted / refs.length) * 100) : 0,
      // @ts-ignore
      pendingCommissions: (commissionsRes.data || []) as unknown as CommissionRow[],
      topAffiliates: (affiliatesRes.data || []) as AffiliateRow[],
    });
  }, [business, period]);

  useEffect(() => { load(); }, [load]);

  const revenueData = metrics
    .filter((m) => m.metric_key === 'revenue')
    .map((m) => ({
      date: new Date(m.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: m.value,
    }));

  const closeRateData = metrics
    .filter((m) => m.metric_key === 'close_rate')
    .map((m) => ({
      date: new Date(m.period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.round(m.value * 100),
    }));

  const stageData = ['prospect', 'proposal', 'negotiation', 'won'].map((stage) => ({
    stage,
    value: opps.filter((o) => o.stage === stage).reduce((s, o) => s + (o.value || 0), 0),
    count: opps.filter((o) => o.stage === stage).length,
  }));

  const confColor = (c: number) => {
    if (c >= 0.8) return 'text-green-400';
    if (c >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Intelligence</h1>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {(['weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                period === p ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue over time */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Revenue Over Time</h3>
          {revenueData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-gray-600">
              Revenue data will appear after your first closed deal
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(v: number) => [fmtCurrency(v), 'Revenue']}
                />
                <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pipeline by stage */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Pipeline Value by Stage</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stageData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="stage" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                formatter={(v: number, name: string) => [name === 'value' ? fmtCurrency(v) : v, name === 'value' ? 'Value' : 'Deals']}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {stageData.map((entry) => (
                  <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] || '#6366f1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-3 gap-4">
        {/* Lead source donut */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Lead Sources</h3>
          {sources.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-700">No leads yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={sources}
                  dataKey="count"
                  nameKey="source"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                >
                  {sources.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                />
                <Legend iconType="circle" iconSize={8} formatter={(v) => <span style={{ color: '#9ca3af', fontSize: 11 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Close rate trend */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Close Rate Trend</h3>
          {closeRateData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-700">No close rate data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={closeRateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                  formatter={(v: number) => [`${v}%`, 'Close Rate']}
                />
                <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent AI decisions */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Recent Decisions</h3>
          {decisions.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-700">No decisions yet</div>
          ) : (
            <div className="space-y-2">
              {decisions.slice(0, 5).map((d) => (
                <div key={d.id} className="flex items-start gap-3 py-1.5 border-b border-gray-800 last:border-0">
                  <span className="text-xs font-medium text-indigo-400 w-24 shrink-0 capitalize truncate">
                    {d.agent?.replace(/_/g, ' ')}
                  </span>
                  <p className="text-xs text-gray-300 flex-1 truncate">{d.task || '—'}</p>
                  <span className={`text-xs font-medium tabular-nums shrink-0 ${confColor(d.confidence)}`}>
                    {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent Health Grid */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Agent Health</h2>
        <div className="grid grid-cols-5 gap-3">
          {agentHealth.map((agent) => (
            <div key={agent.agent_name} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${AGENT_STATUS_STYLE[agent.status] || 'bg-gray-500'}`} />
                <span className="text-xs font-medium text-gray-300 capitalize truncate">
                  {agent.agent_name.replace(/_/g, ' ')}
                </span>
              </div>
              <p className={`text-xs font-semibold capitalize ${
                agent.status === 'healthy' ? 'text-green-400' :
                agent.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {agent.status}
              </p>
              <p className="text-[10px] text-gray-700 mt-1">
                {agent.last_run_at
                  ? `Last: ${new Date(agent.last_run_at).toLocaleTimeString()}`
                  : 'Last run: never'}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Full decisions table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">AI Decision Log</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                {['Agent', 'Task', 'Confidence', 'Reasoning', 'Time'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {decisions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-700">No decisions logged yet</td>
                </tr>
              ) : (
                decisions.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-xs font-medium text-indigo-400 capitalize whitespace-nowrap">
                      {d.agent?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300 max-w-xs truncate">
                      {d.task || '—'}
                    </td>
                    <td className={`px-4 py-3 text-xs font-medium tabular-nums ${confColor(d.confidence)}`}>
                      {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">
                      {d.reasoning_summary || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                      {new Date(d.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Referral section */}
      <div>
        <h2 className="text-base font-semibold text-gray-200 mb-3">Referral & Affiliates</h2>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 mb-1">Referrals This Month</p>
            <p className="text-3xl font-bold text-white">{referral.totalThisMonth}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 mb-1">Conversion Rate</p>
            <p className="text-3xl font-bold text-white">{referral.conversionRate}%</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 mb-1">Pending Commissions</p>
            <p className="text-3xl font-bold text-white">{referral.pendingCommissions.length}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 mb-1">Active Affiliates</p>
            <p className="text-3xl font-bold text-white">{referral.topAffiliates.length}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Top Affiliates by Conversions</h3>
            {referral.topAffiliates.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-700">No affiliates yet</div>
            ) : (
              <div className="space-y-2">
                {referral.topAffiliates.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                    <p className="text-sm text-gray-300 flex-1 truncate">{a.name}</p>
                    <span className="text-xs text-gray-400 tabular-nums">{a.total_referrals} refs</span>
                    <span className="text-xs font-medium text-green-400 tabular-nums">{fmtCurrency(a.total_earned)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Pending Commissions to Pay</h3>
            {referral.pendingCommissions.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-gray-700">No pending commissions</div>
            ) : (
              <div className="space-y-2">
                {referral.pendingCommissions.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
                    <p className="text-sm text-gray-300 flex-1 truncate">
                      {c.affiliates?.name || 'Unknown affiliate'}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      c.status === 'approved' ? 'bg-green-900/40 text-green-400' : 'bg-yellow-900/40 text-yellow-400'
                    }`}>
                      {c.status}
                    </span>
                    <span className="text-sm font-medium text-white tabular-nums">{fmtCurrency(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

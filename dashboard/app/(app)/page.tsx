'use client';
import { useEffect, useState, useCallback } from 'react';
import { Users, TrendingUp, CheckSquare, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { getBusinessStats } from '@/lib/api';
import { useBusiness } from '@/lib/business-context';
import MetricCard from '@/components/MetricCard';
import ApprovalCard, { type QueuedAction } from '@/components/ApprovalCard';
import CommandInput from '@/components/CommandInput';
import AlertFeed from '@/components/AlertFeed';

interface Stats {
  leads_count: number;
  pipeline_value: number;
  open_tasks: number;
  pending_approvals: number;
  recent_decisions: Decision[];
}

interface Decision {
  id: string;
  agent: string;
  task?: string;
  confidence?: number;
  reasoning_summary?: string;
  created_at: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function confColor(c?: number) {
  if (!c) return 'text-gray-500';
  if (c >= 0.8) return 'text-green-400';
  if (c >= 0.6) return 'text-yellow-400';
  return 'text-red-400';
}

export default function CommandCenterPage() {
  const business = useBusiness();
  const [stats, setStats] = useState<Stats | null>(null);
  const [approvals, setApprovals] = useState<QueuedAction[]>([]);

  const loadApprovals = useCallback(async () => {
    if (!business) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('action_queue')
      .select('id,action_type,explanation,payload,created_at,priority')
      .eq('business_id', business.id)
      .eq('status', 'approval_required')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    setApprovals((data as QueuedAction[]) || []);
  }, [business]);

  const loadStats = useCallback(async () => {
    if (!business) return;
    try {
      const data = await getBusinessStats(business.id);
      setStats(data);
    } catch {
      // backend may not be reachable; ignore
    }
  }, [business]);

  useEffect(() => {
    loadStats();
    loadApprovals();
  }, [loadStats, loadApprovals]);

  // Realtime for new approval_required items
  useEffect(() => {
    if (!business) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`approvals-${business.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'action_queue',
        filter: `business_id=eq.${business.id}`,
      }, () => {
        loadApprovals();
        loadStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [business, loadApprovals, loadStats]);

  if (!business) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        Loading business…
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex h-full">
      {/* Main */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6 min-w-0">
        {/* Header */}
        <div>
          <p className="text-xs text-gray-500">{today}</p>
          <h1 className="text-2xl font-bold text-white mt-1">Command Center</h1>
          <p className="text-sm text-gray-400 mt-0.5">{business.name}</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard
            title="Active Leads"
            value={stats?.leads_count ?? '—'}
            icon={<Users className="w-4 h-4" />}
            accent="indigo"
          />
          <MetricCard
            title="Pipeline Value"
            value={stats ? fmt(stats.pipeline_value) : '—'}
            icon={<TrendingUp className="w-4 h-4" />}
            accent="green"
          />
          <MetricCard
            title="Open Tasks"
            value={stats?.open_tasks ?? '—'}
            icon={<CheckSquare className="w-4 h-4" />}
            accent="yellow"
          />
          <MetricCard
            title="Pending Approvals"
            value={stats?.pending_approvals ?? '—'}
            icon={<Clock className="w-4 h-4" />}
            accent={stats && stats.pending_approvals > 0 ? 'red' : 'indigo'}
          />
        </div>

        {/* Pending Approvals */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Pending Approvals
            {approvals.length > 0 && (
              <span className="ml-2 text-xs font-normal bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                {approvals.length}
              </span>
            )}
          </h2>
          {approvals.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
              <p className="text-sm text-gray-600">No pending approvals</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {approvals.map((action) => (
                <ApprovalCard
                  key={action.id}
                  action={action}
                  onResolved={() => {
                    setApprovals((prev) => prev.filter((a) => a.id !== action.id));
                    loadStats();
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Recent Decisions */}
        {stats?.recent_decisions && stats.recent_decisions.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
              Recent AI Decisions
            </h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800">
              {stats.recent_decisions.map((d) => (
                <div key={d.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-indigo-400">
                          {d.agent?.replace(/_/g, ' ')}
                        </span>
                        <span className={`text-xs font-medium ${confColor(d.confidence)}`}>
                          {d.confidence != null ? `${Math.round(d.confidence * 100)}%` : ''}
                        </span>
                      </div>
                      {d.task && (
                        <p className="text-sm text-gray-300 mt-0.5 truncate">{d.task}</p>
                      )}
                      {d.reasoning_summary && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{d.reasoning_summary}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-700 shrink-0">
                      {new Date(d.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Command input */}
        <CommandInput businessId={business.id} />
      </div>

      {/* Right sidebar — Alert Feed */}
      <div className="w-72 shrink-0 border-l border-gray-800 flex flex-col">
        <div className="flex-1 p-4">
          <AlertFeed businessId={business.id} />
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';
import PipelineBoard, { type Opportunity } from '@/components/PipelineBoard';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Lead {
  id: string;
  name: string;
  email?: string;
}

const STAGE_OPTIONS = ['prospect', 'proposal', 'negotiation', 'won', 'lost'];

export default function PipelinePage() {
  const business = useBusiness();
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    value: '',
    lead_id: '',
    stage: 'prospect',
    close_date: '',
  });

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const supabase = createClient();
    const [oppsRes, leadsRes] = await Promise.all([
      supabase
        .from('opportunities')
        .select('id,name,stage,value,close_date,stalled_at,leads(name)')
        .eq('business_id', business.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('leads')
        .select('id,name,email')
        .eq('business_id', business.id)
        .order('name'),
    ]);
    // @ts-ignore
    setOpps((oppsRes.data as unknown as Opportunity[]) || []);
    setLeads((leadsRes.data as Lead[]) || []);
    setLoading(false);
  }, [business]);

  useEffect(() => { load(); }, [load]);

  const createOpp = async () => {
    if (!business || !formData.name) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/opportunities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: formData.name,
          value: parseFloat(formData.value) || 0,
          lead_id: formData.lead_id || undefined,
          stage: formData.stage,
          close_date: formData.close_date || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowForm(false);
      setFormData({ name: '', value: '', lead_id: '', stage: 'prospect', close_date: '' });
      load();
    } catch (err) {
      console.error('Create opportunity error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const totalValue = opps
    .filter((o) => o.stage !== 'lost')
    .reduce((s, o) => s + (o.value || 0), 0);

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {opps.length} deals · {fmtCurrency(totalValue)} total value
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Deal
          </button>
        </div>
      </div>

      {/* Add Deal Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-white">New Deal</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Deal Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enterprise deal"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Contact (Lead)</label>
                <select
                  value={formData.lead_id}
                  onChange={(e) => setFormData({ ...formData, lead_id: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— No contact —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}{l.email ? ` (${l.email})` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Value ($)</label>
                  <input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="5000"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Stage</label>
                  <select
                    value={formData.stage}
                    onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {STAGE_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Close Date</label>
                <input
                  type="date"
                  value={formData.close_date}
                  onChange={(e) => setFormData({ ...formData, close_date: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={createOpp}
                disabled={!formData.name || submitting}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {submitting ? 'Creating…' : 'Create Deal'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-600">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading pipeline…
        </div>
      ) : (
        <PipelineBoard
          opportunities={opps}
          businessId={business?.id || ''}
          onStageChange={load}
        />
      )}
    </div>
  );
}

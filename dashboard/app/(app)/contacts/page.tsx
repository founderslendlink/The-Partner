'use client';
import { useEffect, useState, useCallback } from 'react';
import { Search, Plus, X, Mail, Phone, Clock, Tag } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';
import ContactCard, { type Lead } from '@/components/ContactCard';

const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

interface Interaction {
  id: string;
  channel: string;
  direction: string;
  content?: string;
  created_at: string;
}

export default function ContactsPage() {
  const business = useBusiness();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filtered, setFiltered] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', source: '' });

  const load = useCallback(async () => {
    if (!business) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('leads')
      .select('id,name,email,phone,status,lead_score,source,last_contacted_at,assigned_agent')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false });
    const rows = (data as Lead[]) || [];
    setLeads(rows);
    setFiltered(rows);
    setLoading(false);
  }, [business]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let result = leads;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.source?.toLowerCase().includes(q)
      );
    }
    if (statusFilter) result = result.filter((l) => l.status === statusFilter);
    setFiltered(result);
  }, [search, statusFilter, leads]);

  const openLead = async (lead: Lead) => {
    setSelected(lead);
    if (!business) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('interactions')
      .select('id,channel,direction,content,created_at')
      .eq('business_id', business.id)
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setInteractions((data as Interaction[]) || []);
  };

  const createLead = async () => {
    if (!business || !form.name) return;
    const supabase = createClient();
    await supabase.from('leads').insert({
      business_id: business.id,
      name: form.name,
      email: form.email || null,
      phone: form.phone || null,
      source: form.source || 'manual',
      status: 'new',
    });
    setShowForm(false);
    setForm({ name: '', email: '', phone: '', source: '' });
    load();
  };

  return (
    <div className="flex h-full">
      {/* Main list */}
      <div className="flex-1 p-6 overflow-y-auto min-w-0">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-white">Contacts</h1>
            <p className="text-sm text-gray-500 mt-0.5">{filtered.length} contacts</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Contact
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Add Contact Form */}
        {showForm && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-5">
            <h3 className="text-sm font-semibold text-white mb-4">New Contact</h3>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(['name', 'email', 'phone', 'source'] as const).map((field) => (
                <div key={field}>
                  <label className="block text-xs text-gray-400 mb-1 capitalize">
                    {field}{field === 'name' ? ' *' : ''}
                  </label>
                  <input
                    type={field === 'email' ? 'email' : 'text'}
                    value={form[field]}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder={field === 'source' ? 'referral, website, …' : ''}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={createLead} disabled={!form.name} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg">
                Create
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-gray-400 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-600">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-3" />
            Loading…
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Contact', 'Status', 'Score', 'Source', 'Last Contact', 'Agent'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-600">
                      No contacts found
                    </td>
                  </tr>
                ) : (
                  filtered.map((lead) => (
                    <ContactCard key={lead.id} lead={lead} onClick={() => openLead(lead)} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead detail panel */}
      {selected && (
        <div className="w-80 shrink-0 border-l border-gray-800 flex flex-col bg-gray-900/50">
          <div className="flex items-center justify-between p-4 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-white truncate">{selected.name}</h3>
            <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Contact info */}
            <div className="space-y-2">
              {selected.email && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Mail className="w-3.5 h-3.5" /> {selected.email}
                </div>
              )}
              {selected.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Phone className="w-3.5 h-3.5" /> {selected.phone}
                </div>
              )}
              {selected.last_contacted_at && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  Last contact: {new Date(selected.last_contacted_at).toLocaleDateString()}
                </div>
              )}
              {selected.source && (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Tag className="w-3.5 h-3.5" /> {selected.source}
                </div>
              )}
            </div>

            {/* Interactions */}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Interaction History
              </h4>
              {interactions.length === 0 ? (
                <p className="text-xs text-gray-700">No interactions recorded</p>
              ) : (
                <div className="space-y-2">
                  {interactions.map((i) => (
                    <div key={i.id} className="bg-gray-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-indigo-400 capitalize">{i.channel}</span>
                        <span className="text-xs text-gray-600">{i.direction}</span>
                        <span className="ml-auto text-xs text-gray-700">
                          {new Date(i.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {i.content && (
                        <p className="text-xs text-gray-400 line-clamp-3">{i.content}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

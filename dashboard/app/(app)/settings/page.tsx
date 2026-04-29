'use client';
import { useEffect, useState, useCallback } from 'react';
import { Save, Check, Instagram, Linkedin, Twitter, Facebook, Mail, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';
import { updatePermission, updateOperatorMode } from '@/lib/api';

interface PermissionRule {
  id: string;
  action_type: string;
  rule: 'auto' | 'approval_required' | 'blocked';
}

const RULE_STYLE: Record<string, string> = {
  auto:             'text-green-400',
  approval_required: 'text-yellow-400',
  blocked:          'text-red-400',
};

const OPERATOR_MODES = [
  {
    id: 'assisted',
    label: 'Assisted',
    desc: 'Everything requires approval. AI advises, you decide.',
  },
  {
    id: 'semi_autonomous',
    label: 'Semi-Autonomous',
    desc: 'Low-risk actions auto-execute. High-impact actions need approval.',
  },
  {
    id: 'autonomous',
    label: 'Autonomous',
    desc: 'AI acts unless explicitly blocked. You monitor via alerts.',
  },
];

const INTEGRATIONS = [
  { id: 'instagram', label: 'Instagram',  icon: <Instagram className="w-5 h-5" /> },
  { id: 'linkedin',  label: 'LinkedIn',   icon: <Linkedin className="w-5 h-5" /> },
  { id: 'twitter',   label: 'Twitter / X', icon: <Twitter className="w-5 h-5" /> },
  { id: 'facebook',  label: 'Facebook',   icon: <Facebook className="w-5 h-5" /> },
  { id: 'email',     label: 'Email',      icon: <Mail className="w-5 h-5" /> },
  { id: 'calendar',  label: 'Calendar',   icon: <Calendar className="w-5 h-5" /> },
];

export default function SettingsPage() {
  const business = useBusiness();
  const [permissions, setPermissions] = useState<PermissionRule[]>([]);
  const [operatorMode, setOperatorMode] = useState('assisted');
  const [connectedPlatforms, setConnectedPlatforms] = useState<string[]>([]);
  const [savedRule, setSavedRule] = useState<string | null>(null);
  const [savedMode, setSavedMode] = useState(false);
  const [bizName, setBizName] = useState('');
  const [bizTimezone, setBizTimezone] = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    setBizName(business.name);
    setBizTimezone(business.timezone);
    setOperatorMode(business.operator_mode || 'assisted');

    const supabase = createClient();
    const [permsRes, socialRes] = await Promise.all([
      supabase
        .from('permission_rules')
        .select('id,action_type,rule')
        .eq('business_id', business.id)
        .order('action_type'),
      supabase
        .from('social_connections')
        .select('platform')
        .eq('business_id', business.id),
    ]);

    setPermissions((permsRes.data as PermissionRule[]) || []);
    setConnectedPlatforms(((socialRes.data || []) as { platform: string }[]).map((r) => r.platform));
  }, [business]);

  useEffect(() => { load(); }, [load]);

  const changeRule = async (actionType: string, rule: string) => {
    if (!business) return;
    setPermissions((prev) =>
      prev.map((p) => (p.action_type === actionType ? { ...p, rule: rule as PermissionRule['rule'] } : p))
    );
    await updatePermission(business.id, actionType, rule);
    setSavedRule(actionType);
    setTimeout(() => setSavedRule(null), 2000);
  };

  const changeOperatorMode = async (mode: string) => {
    if (!business) return;
    setOperatorMode(mode);
    await updateOperatorMode(business.id, mode);
    setSavedMode(true);
    setTimeout(() => setSavedMode(false), 2000);
  };

  const saveBizProfile = async () => {
    if (!business) return;
    const supabase = createClient();
    await supabase
      .from('businesses')
      .update({ name: bizName, timezone: bizTimezone })
      .eq('id', business.id);
  };

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Operator Mode */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Operator Mode</h2>
        <p className="text-xs text-gray-500 mb-4">Controls how autonomously the AI acts</p>
        <div className="grid grid-cols-3 gap-3">
          {OPERATOR_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => changeOperatorMode(m.id)}
              className={`p-4 rounded-xl border text-left transition-all ${
                operatorMode === m.id
                  ? 'border-indigo-500 bg-indigo-600/10'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{m.label}</p>
                {operatorMode === m.id && (
                  <div className="w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{m.desc}</p>
            </button>
          ))}
        </div>
        {savedMode && (
          <p className="text-xs text-green-400 mt-2 flex items-center gap-1">
            <Check className="w-3 h-3" /> Mode updated
          </p>
        )}
      </section>

      {/* Permission Rules */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Permission Rules</h2>
        <p className="text-xs text-gray-500 mb-4">Control which actions require your approval</p>
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Rule</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change To</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {permissions.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-700">
                    No permission rules found
                  </td>
                </tr>
              ) : (
                permissions.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-300 font-mono">
                      {p.action_type}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${RULE_STYLE[p.rule]}`}>
                        {p.rule.replace(/_/g, ' ')}
                      </span>
                      {savedRule === p.action_type && (
                        <Check className="w-3.5 h-3.5 text-green-400 inline ml-2" />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={p.rule}
                        onChange={(e) => changeRule(p.action_type, e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        disabled={p.rule === 'blocked'}
                      >
                        <option value="auto">auto</option>
                        <option value="approval_required">approval_required</option>
                        <option value="blocked">blocked</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Integrations */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Integrations</h2>
        <p className="text-xs text-gray-500 mb-4">Connect your platforms to enable AI posting and outreach</p>
        <div className="grid grid-cols-2 gap-3">
          {INTEGRATIONS.map((intg) => {
            const connected = connectedPlatforms.includes(intg.id);
            return (
              <div key={intg.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{intg.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-white">{intg.label}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {connected ? 'Connected' : 'Not connected'}
                    </p>
                  </div>
                </div>
                <button
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    connected
                      ? 'bg-gray-800 text-gray-400 hover:bg-red-900/30 hover:text-red-400'
                      : 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30'
                  }`}
                >
                  {connected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-700 mt-3">
          Social and email connections are configured via OAuth in each platform's developer portal.
          Store tokens in the <code className="text-gray-600">social_connections</code> and{' '}
          <code className="text-gray-600">email_connections</code> tables.
        </p>
      </section>

      {/* Business Profile */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Business Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Business Name</label>
            <input
              type="text"
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
              className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Timezone</label>
            <input
              type="text"
              value={bizTimezone}
              onChange={(e) => setBizTimezone(e.target.value)}
              placeholder="America/Chicago"
              className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={saveBizProfile}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" /> Save Profile
          </button>
        </div>
      </section>
    </div>
  );
}

'use client';
import { useEffect, useState, useCallback } from 'react';
import { Save, Check, Mail, MessageSquare, Calendar, ExternalLink, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';
import {
  updatePermission, updateOperatorMode,
  connectEmail, testEmail, connectSMS, testSMS, getIntegrationStatus,
} from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface PermissionRule {
  id: string;
  action_type: string;
  rule: 'auto' | 'approval_required' | 'blocked';
}

interface IntegrationStatus {
  email:    { provider: string; from_email: string; connected_at: string } | null;
  sms:      { phone_number: string; connected_at: string } | null;
  calendar: { provider: string; calendar_id: string; connected_at: string } | null;
}

const RULE_STYLE: Record<string, string> = {
  auto:              'text-green-400',
  approval_required: 'text-yellow-400',
  blocked:           'text-red-400',
};

const OPERATOR_MODES = [
  { id: 'assisted',        label: 'Assisted',        desc: 'Everything requires approval. AI advises, you decide.' },
  { id: 'semi_autonomous', label: 'Semi-Autonomous',  desc: 'Low-risk actions auto-execute. High-impact needs approval.' },
  { id: 'autonomous',      label: 'Autonomous',       desc: 'AI acts unless explicitly blocked. You monitor via alerts.' },
];

export default function SettingsPage() {
  const business = useBusiness();
  const [permissions, setPermissions]         = useState<PermissionRule[]>([]);
  const [operatorMode, setOperatorMode]       = useState('assisted');
  const [integrations, setIntegrations]       = useState<IntegrationStatus>({ email: null, sms: null, calendar: null });
  const [savedRule, setSavedRule]             = useState<string | null>(null);
  const [savedMode, setSavedMode]             = useState(false);
  const [bizName, setBizName]                 = useState('');
  const [bizTimezone, setBizTimezone]         = useState('');

  // Email form state
  const [emailProvider, setEmailProvider]     = useState<'sendgrid' | 'smtp'>('sendgrid');
  const [emailApiKey, setEmailApiKey]         = useState('');
  const [emailFromName, setEmailFromName]     = useState('');
  const [emailFromEmail, setEmailFromEmail]   = useState('');
  const [smtpHost, setSmtpHost]               = useState('');
  const [smtpPort, setSmtpPort]               = useState('587');
  const [smtpUser, setSmtpUser]               = useState('');
  const [smtpPass, setSmtpPass]               = useState('');
  const [emailSaving, setEmailSaving]         = useState(false);
  const [emailTesting, setEmailTesting]       = useState(false);
  const [emailMsg, setEmailMsg]               = useState('');

  // SMS form state
  const [smsAccountSid, setSmsAccountSid]     = useState('');
  const [smsAuthToken, setSmsAuthToken]       = useState('');
  const [smsPhone, setSmsPhone]               = useState('');
  const [smsSaving, setSmsSaving]             = useState(false);
  const [smsTesting, setSmsTesting]           = useState(false);
  const [smsMsg, setSmsMsg]                   = useState('');

  const load = useCallback(async () => {
    if (!business) return;
    setBizName(business.name);
    setBizTimezone(business.timezone);
    setOperatorMode(business.operator_mode || 'assisted');

    const supabase = createClient();
    const [permsRes] = await Promise.all([
      supabase.from('permission_rules').select('id,action_type,rule').eq('business_id', business.id).order('action_type'),
    ]);
    setPermissions((permsRes.data as PermissionRule[]) || []);

    try {
      const status = await getIntegrationStatus(business.id) as IntegrationStatus;
      setIntegrations(status);
    } catch {
      // calendar_connections table may not exist yet — non-fatal
    }
  }, [business]);

  useEffect(() => { load(); }, [load]);

  // Read OAuth callback params from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'calendar_connected') {
      setIntegrations(prev => ({
        ...prev,
        calendar: { provider: 'google', calendar_id: 'primary', connected_at: new Date().toISOString() },
      }));
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  const changeRule = async (actionType: string, rule: string) => {
    if (!business) return;
    setPermissions(prev => prev.map(p => p.action_type === actionType ? { ...p, rule: rule as PermissionRule['rule'] } : p));
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
    await supabase.from('businesses').update({ name: bizName, timezone: bizTimezone }).eq('id', business.id);
  };

  const saveEmail = async () => {
    if (!business) return;
    setEmailSaving(true);
    setEmailMsg('');
    try {
      await connectEmail({
        businessId: business.id,
        provider:   emailProvider,
        apiKey:     emailProvider === 'sendgrid' ? emailApiKey : undefined,
        smtpHost:   emailProvider === 'smtp' ? smtpHost : undefined,
        smtpPort:   emailProvider === 'smtp' ? Number(smtpPort) : undefined,
        smtpUser:   emailProvider === 'smtp' ? smtpUser : undefined,
        smtpPass:   emailProvider === 'smtp' ? smtpPass : undefined,
        fromEmail: emailFromEmail,
        fromName:  emailFromName,
      });
      setEmailMsg('Email connected successfully.');
      load();
    } catch (err: unknown) {
      setEmailMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailSaving(false);
    }
  };

  const sendTestEmail = async () => {
    if (!business || !emailFromEmail) return;
    setEmailTesting(true);
    setEmailMsg('');
    try {
      await testEmail(business.id, emailFromEmail);
      setEmailMsg('Test email sent — check your inbox.');
    } catch (err: unknown) {
      setEmailMsg(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setEmailTesting(false);
    }
  };

  const saveSMS = async () => {
    if (!business) return;
    setSmsSaving(true);
    setSmsMsg('');
    try {
      await connectSMS({ businessId: business.id, accountSid: smsAccountSid, authToken: smsAuthToken, phoneNumber: smsPhone });
      setSmsMsg('SMS connected successfully.');
      load();
    } catch (err: unknown) {
      setSmsMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSmsSaving(false);
    }
  };

  const sendTestSMS = async () => {
    if (!business || !smsPhone) return;
    setSmsTesting(true);
    setSmsMsg('');
    try {
      await testSMS(business.id, smsPhone);
      setSmsMsg('Test SMS sent.');
    } catch (err: unknown) {
      setSmsMsg(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSmsTesting(false);
    }
  };

  const connectCalendar = () => {
    if (!business) return;
    window.location.href = `${API_URL}/oauth/google/calendar?businessId=${business.id}`;
  };

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {/* Operator Mode */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Operator Mode</h2>
        <p className="text-xs text-gray-500 mb-4">Controls how autonomously the AI acts</p>
        <div className="grid grid-cols-3 gap-3">
          {OPERATOR_MODES.map(m => (
            <button key={m.id} onClick={() => changeOperatorMode(m.id)}
              className={`p-4 rounded-xl border text-left transition-all ${operatorMode === m.id ? 'border-indigo-500 bg-indigo-600/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{m.label}</p>
                {operatorMode === m.id && <div className="w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center"><Check className="w-2.5 h-2.5 text-white" /></div>}
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{m.desc}</p>
            </button>
          ))}
        </div>
        {savedMode && <p className="text-xs text-green-400 mt-2 flex items-center gap-1"><Check className="w-3 h-3" /> Mode updated</p>}
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
                <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-700">No permission rules found</td></tr>
              ) : permissions.map(p => (
                <tr key={p.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-sm text-gray-300 font-mono">{p.action_type}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${RULE_STYLE[p.rule]}`}>{p.rule.replace(/_/g, ' ')}</span>
                    {savedRule === p.action_type && <Check className="w-3.5 h-3.5 text-green-400 inline ml-2" />}
                  </td>
                  <td className="px-4 py-3">
                    <select value={p.rule} onChange={e => changeRule(p.action_type, e.target.value)}
                      className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      disabled={p.rule === 'blocked'}>
                      <option value="auto">auto</option>
                      <option value="approval_required">approval_required</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Email Integration */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <Mail className="w-4 h-4" /> Email
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Connect SendGrid or SMTP for outbound emails</p>
          </div>
          {integrations.email && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Connected · {integrations.email.from_email}
            </span>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="flex gap-2">
            {(['sendgrid', 'smtp'] as const).map(p => (
              <button key={p} onClick={() => setEmailProvider(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${emailProvider === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>
                {p === 'sendgrid' ? 'SendGrid' : 'SMTP'}
              </button>
            ))}
          </div>

          {emailProvider === 'sendgrid' ? (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">API Key</label>
              <input type="password" value={emailApiKey} onChange={e => setEmailApiKey(e.target.value)}
                placeholder="SG.xxxxxxxxxx"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">SMTP Host</label>
                <input type="text" value={smtpHost} onChange={e => setSmtpHost(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Port</label>
                <input type="number" value={smtpPort} onChange={e => setSmtpPort(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Username</label>
                <input type="text" value={smtpUser} onChange={e => setSmtpUser(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Password</label>
                <input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">From Name</label>
              <input type="text" value={emailFromName} onChange={e => setEmailFromName(e.target.value)}
                placeholder="Your Business"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">From Email</label>
              <input type="email" value={emailFromEmail} onChange={e => setEmailFromEmail(e.target.value)}
                placeholder="hello@yourbusiness.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={saveEmail} disabled={emailSaving || !emailFromEmail || !emailFromName}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {emailSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
            {integrations.email && (
              <button onClick={sendTestEmail} disabled={emailTesting}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors">
                {emailTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                Send Test Email
              </button>
            )}
          </div>
          {emailMsg && <p className={`text-xs mt-1 ${emailMsg.startsWith('Error') || emailMsg.startsWith('Test failed') ? 'text-red-400' : 'text-green-400'}`}>{emailMsg}</p>}
        </div>
      </section>

      {/* SMS Integration */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <MessageSquare className="w-4 h-4" /> SMS
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Connect Twilio for outbound SMS messages</p>
          </div>
          {integrations.sms && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Connected · {integrations.sms.phone_number}
            </span>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Account SID</label>
              <input type="text" value={smsAccountSid} onChange={e => setSmsAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxx"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Auth Token</label>
              <input type="password" value={smsAuthToken} onChange={e => setSmsAuthToken(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Twilio Phone Number</label>
            <input type="text" value={smsPhone} onChange={e => setSmsPhone(e.target.value)}
              placeholder="+12025551234"
              className="w-full max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={saveSMS} disabled={smsSaving || !smsAccountSid || !smsAuthToken || !smsPhone}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {smsSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
            {integrations.sms && (
              <button onClick={sendTestSMS} disabled={smsTesting}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium rounded-lg transition-colors">
                {smsTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                Send Test SMS
              </button>
            )}
          </div>
          {smsMsg && <p className={`text-xs mt-1 ${smsMsg.startsWith('Error') || smsMsg.startsWith('Test failed') ? 'text-red-400' : 'text-green-400'}`}>{smsMsg}</p>}
        </div>
      </section>

      {/* Calendar Integration */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Calendar
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Connect Google Calendar for automated meeting booking</p>
          </div>
          {integrations.calendar && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              Connected · {integrations.calendar.provider}
            </span>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            Connecting Google Calendar allows The Partner to check your availability, book meetings with leads,
            and send pre-call briefings 30 minutes before each meeting.
          </p>
          <button onClick={connectCalendar}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
            <ExternalLink className="w-4 h-4" />
            {integrations.calendar ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
          </button>
          <p className="text-xs text-gray-600 mt-3">
            Requires <code className="text-gray-500">GOOGLE_CLIENT_ID</code> and <code className="text-gray-500">GOOGLE_CLIENT_SECRET</code> to be set on the backend.
          </p>
        </div>
      </section>

      {/* Business Profile */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-1">Business Profile</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Business Name</label>
            <input type="text" value={bizName} onChange={e => setBizName(e.target.value)}
              className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Timezone</label>
            <input type="text" value={bizTimezone} onChange={e => setBizTimezone(e.target.value)}
              placeholder="America/Chicago"
              className="w-full max-w-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button onClick={saveBizProfile}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
            <Save className="w-4 h-4" /> Save Profile
          </button>
        </div>
      </section>
    </div>
  );
}

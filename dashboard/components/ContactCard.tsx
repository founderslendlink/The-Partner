import { Mail } from 'lucide-react';

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  lead_score?: number | null;
  source?: string;
  last_contacted_at?: string;
  assigned_agent?: string;
}

const STATUS_STYLE: Record<string, string> = {
  new:         'bg-blue-500/15 text-blue-400',
  contacted:   'bg-cyan-500/15 text-cyan-400',
  qualified:   'bg-green-500/15 text-green-400',
  proposal:    'bg-indigo-500/15 text-indigo-400',
  negotiation: 'bg-orange-500/15 text-orange-400',
  won:         'bg-emerald-500/15 text-emerald-300',
  lost:        'bg-red-500/15 text-red-400',
};

interface ContactCardProps {
  lead: Lead;
  onClick: () => void;
}

export default function ContactCard({ lead, onClick }: ContactCardProps) {
  return (
    <tr
      onClick={onClick}
      className="hover:bg-gray-800/50 cursor-pointer transition-colors group"
    >
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-white group-hover:text-indigo-300 transition-colors">
          {lead.name}
        </p>
        {lead.email && (
          <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
            <Mail className="w-3 h-3" />
            {lead.email}
          </p>
        )}
      </td>

      <td className="px-4 py-3">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[lead.status] ?? 'bg-gray-700 text-gray-400'}`}>
          {lead.status}
        </span>
      </td>

      <td className="px-4 py-3">
        {lead.lead_score != null ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${lead.lead_score}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 tabular-nums">{lead.lead_score}</span>
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-xs text-gray-400">{lead.source || '—'}</td>

      <td className="px-4 py-3 text-xs text-gray-400">
        {lead.last_contacted_at
          ? new Date(lead.last_contacted_at).toLocaleDateString()
          : <span className="text-gray-700">Never</span>}
      </td>

      <td className="px-4 py-3 text-xs text-gray-500">
        {lead.assigned_agent?.replace(/_/g, ' ') || '—'}
      </td>
    </tr>
  );
}

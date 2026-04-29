'use client';
import { useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { approveAction, rejectAction } from '@/lib/api';

export interface QueuedAction {
  id: string;
  action_type: string;
  explanation?: string;
  payload: Record<string, unknown>;
  created_at: string;
  priority: number;
}

interface ApprovalCardProps {
  action: QueuedAction;
  onResolved: () => void;
}

export default function ApprovalCard({ action, onResolved }: ApprovalCardProps) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const handle = async (type: 'approve' | 'reject') => {
    setBusy(type);
    try {
      if (type === 'approve') {
        await approveAction(action.id);
      } else {
        await rejectAction(action.id, 'Rejected via dashboard');
      }
      onResolved();
    } catch {
      // keep card visible on error
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl p-4 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
            {action.action_type.replace(/_/g, ' ')}
          </span>
          {action.explanation && (
            <p className="text-sm text-gray-300 mt-1 leading-snug">{action.explanation}</p>
          )}
        </div>
        <span className="text-xs text-gray-600 shrink-0">P{action.priority}</span>
      </div>

      {Object.keys(action.payload).length > 0 && (
        <div className="bg-gray-800/60 rounded-lg p-3 mb-3 overflow-auto max-h-28">
          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
            {JSON.stringify(action.payload, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => handle('approve')}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => handle('reject')}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <span className="ml-auto text-xs text-gray-600 self-center">
          {new Date(action.created_at).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

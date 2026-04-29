'use client';
import { useState, useRef, KeyboardEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { postCommand } from '@/lib/api';

interface CommandInputProps {
  businessId: string;
}

interface CommandResult {
  summary: string;
  confidence?: number;
  approval_required?: number;
}

export default function CommandInput({ businessId }: CommandInputProps) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommandResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!message.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await postCommand(message.trim(), businessId);
      setResult(data);
      setMessage('');
      inputRef.current?.focus();
    } catch (err) {
      setResult({ summary: `Error: ${err instanceof Error ? err.message : 'Backend unreachable'}` });
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
        Quick Command
      </p>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask The Partner anything… (Enter to send)"
          disabled={loading}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 transition"
        />
        <button
          onClick={submit}
          disabled={loading || !message.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </div>

      {result && (
        <div className="mt-3 p-4 bg-gray-800/60 rounded-lg border border-gray-700">
          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
            {result.summary}
          </p>
          <div className="flex gap-4 mt-2">
            {result.confidence !== undefined && (
              <span className="text-xs text-gray-500">
                Confidence: {Math.round(result.confidence * 100)}%
              </span>
            )}
            {result.approval_required !== undefined && result.approval_required > 0 && (
              <span className="text-xs text-yellow-500">
                {result.approval_required} action{result.approval_required > 1 ? 's' : ''} pending approval
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

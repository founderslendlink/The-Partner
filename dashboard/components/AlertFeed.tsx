'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase';

interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  read: boolean;
  created_at: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  low:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  medium:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  high:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface AlertFeedProps {
  businessId: string;
}

export default function AlertFeed({ businessId }: AlertFeedProps) {
  const [items, setItems] = useState<Notification[]>([]);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    const supabase = createClient();

    // Initial load
    supabase
      .from('notifications')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => setItems((data as Notification[]) || []));

    // Realtime subscription
    const channel = supabase
      .channel(`notifications-${businessId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `business_id=eq.${businessId}`,
        },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev.slice(0, 29)]);
          setPulse(true);
          setTimeout(() => setPulse(false), 1500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0">
        <div className={`relative ${pulse ? 'animate-pulse' : ''}`}>
          <Bell className="w-4 h-4 text-gray-400" />
          {items.some((i) => !i.read) && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-indigo-500 rounded-full" />
          )}
        </div>
        <h3 className="text-sm font-medium text-white">Live Alerts</h3>
        <span className="ml-auto text-xs text-gray-600">{items.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50">
        {items.length === 0 ? (
          <p className="text-sm text-gray-600 p-4 text-center">No alerts yet</p>
        ) : (
          items.map((n) => (
            <div key={n.id} className="px-4 py-3 hover:bg-gray-800/30 transition-colors">
              <div className="flex items-start gap-2">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase tracking-wide shrink-0 ${
                    SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.medium
                  }`}
                >
                  {n.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-300 truncate">{n.title}</p>
                  {n.message && (
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-gray-700 mt-1.5">{timeAgo(n.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

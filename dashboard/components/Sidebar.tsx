'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, TrendingUp, Users, BookOpen, BarChart2, Settings, LogOut, Zap, GitBranch,
} from 'lucide-react';
import { createClient } from '@/lib/supabase';
import { useBusiness } from '@/lib/business-context';

const NAV = [
  { href: '/',             label: 'Command Center', icon: LayoutDashboard },
  { href: '/pipeline',     label: 'Pipeline',       icon: TrendingUp },
  { href: '/automations',  label: 'Automations',    icon: GitBranch },
  { href: '/contacts',     label: 'Contacts',       icon: Users },
  { href: '/content',      label: 'Content Studio', icon: BookOpen },
  { href: '/intelligence', label: 'Intelligence',   icon: BarChart2 },
  { href: '/settings',     label: 'Settings',       icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const business = useBusiness();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <aside className="w-60 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">The Partner</p>
            <p className="text-xs text-gray-500 mt-0.5">AI Business OS</p>
          </div>
        </div>
        {business && (
          <p className="text-xs text-indigo-400 mt-3 truncate">{business.name}</p>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-100 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

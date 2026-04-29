import { ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  icon?: ReactNode;
  accent?: 'indigo' | 'green' | 'yellow' | 'red';
}

const accentBorder: Record<string, string> = {
  indigo: 'border-indigo-500/30',
  green:  'border-green-500/30',
  yellow: 'border-yellow-500/30',
  red:    'border-red-500/30',
};

const accentIcon: Record<string, string> = {
  indigo: 'text-indigo-400 bg-indigo-500/10',
  green:  'text-green-400 bg-green-500/10',
  yellow: 'text-yellow-400 bg-yellow-500/10',
  red:    'text-red-400 bg-red-500/10',
};

export default function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  accent = 'indigo',
}: MetricCardProps) {
  return (
    <div className={`bg-gray-900 rounded-xl border ${accentBorder[accent]} p-5 flex flex-col gap-3`}>
      <div className="flex items-start justify-between">
        <p className="text-sm text-gray-400 font-medium">{title}</p>
        {icon && (
          <div className={`p-2 rounded-lg ${accentIcon[accent]}`}>
            {icon}
          </div>
        )}
      </div>
      <div>
        <p className="text-3xl font-bold text-white tabular-nums">{value}</p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {trend !== undefined && (
        <p className={`text-xs font-medium ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% from last week
        </p>
      )}
    </div>
  );
}

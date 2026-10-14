import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'bad' | 'accent' | 'warn';
  size?: 'md' | 'lg';
}

export default function MetricsCard({ label, value, unit, sub, tone = 'default', size = 'md' }: Props) {
  return (
    <div className={`metric ${tone} ${size}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}{unit && <span className="metric-unit">{unit}</span>}</div>
      {sub != null && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

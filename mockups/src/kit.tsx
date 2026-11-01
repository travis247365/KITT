import { useId, useState, type ReactNode, type CSSProperties } from 'react';
import { Icon, type IconName } from './icons';

export type Prov = 'measured' | 'modelled' | 'assumed';
export type Level = 'critical' | 'high' | 'medium' | 'low' | 'info';

export function KMark({ small }: { small?: boolean }) {
  return <span className={`kmark${small ? ' kmark--sm' : ''}`} role="img" aria-label="KITT" />;
}

export function Scanner({ onAccent }: { onAccent?: boolean }) {
  return (
    <span className={`scanner${onAccent ? ' scanner--on-accent' : ''}`} role="presentation">
      <i /><i /><i /><i />
    </span>
  );
}

const PROV_LABEL: Record<Prov, string> = { measured: 'Measured', modelled: 'Modelled', assumed: 'Assumed' };
export function ProvChip({ kind }: { kind: Prov }) {
  return <span className={`prov prov--${kind}`}>{kind === 'assumed' ? '~ ' : ''}{PROV_LABEL[kind]}</span>;
}

const LEVEL_LABEL: Record<Level, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
export function SevTag({ level }: { level: Level }) {
  return (
    <span className={`sev sev--${level}`}>
      {level === 'critical' && <Icon name="alert" size={12} />}
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function Delta({ text, good }: { text: string; good: boolean }) {
  return <span className={`delta ${good ? 'delta--good' : 'delta--bad'}`}>{text}</span>;
}

export function Btn({
  kind = 'primary', size, icon, children, onClick, disabled, label, className = '', style,
}: {
  kind?: 'primary' | 'ghost' | 'solid'; size?: 'sm'; icon?: IconName; children?: ReactNode; onClick?: () => void;
  disabled?: boolean; label?: string; className?: string; style?: CSSProperties;
}) {
  return (
    <button type="button" className={`btn btn--${kind}${size ? ` btn--${size}` : ''} ${className}`} onClick={onClick} disabled={disabled} aria-label={label} style={style}>
      {icon && <Icon name={icon} size={size ? 16 : 18} />}
      {children}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export interface KpiItem { label: string; value: string; sub?: string; prov?: Prov; delta?: { text: string; good: boolean } }
export function Kpis({ items, cols = 2 }: { items: KpiItem[]; cols?: number }) {
  return (
    <div className="kpis" style={{ '--cols': cols } as CSSProperties} data-cols={cols}>
      {items.map((k) => (
        <div className="kpi" key={k.label}>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-label">{k.label}</div>
          {(k.prov || k.delta || k.sub) && (
            <div className="kpi-sub">
              {k.prov && <ProvChip kind={k.prov} />}
              {k.delta && <Delta {...k.delta} />}
              {k.sub && <span className="t-micro muted">{k.sub}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export interface BarItem { label: string; value: number; text: string; accent?: boolean }
export function Bars({ items, unit }: { items: BarItem[]; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bars" role="list" aria-label={unit ? `Bars, ${unit}` : 'Bars'}>
      {items.map((b) => (
        <div className="bar" role="listitem" key={b.label} tabIndex={0} aria-label={`${b.label}: ${b.text}`}>
          <span className="muted">{b.label}</span>
          <span className="bar-track"><span className={`bar-fill${b.accent ? ' bar-fill--accent' : ''}`} style={{ width: `${(b.value / max) * 100}%` }} /></span>
          <span className="bar-val">{b.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Single-series line: one stroke, a terminal dot with a surface ring, no gridlines, hover/focus crosshair + tooltip. */
export function LineChart({ points, label, format, height = 96, width = 320, labels }: { points: number[]; label: string; format: (v: number) => string; height?: number; width?: number; labels?: [string, string] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pad = 6;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / Math.max(max - min, 1)) * (height - pad * 2 - 14);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const idx = hover ?? last;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}. Latest ${format(points[last])}, low ${format(min)}, high ${format(max)}.`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const rel = ((e.clientX - r.left) / r.width) * width; setHover(Math.max(0, Math.min(last, Math.round(((rel - pad) / (width - pad * 2)) * last)))); }}>
        <title id={id}>{label}</title>
        <path className="chart-line" d={d} />
        {hover !== null && <line className="chart-ref" x1={x(idx)} x2={x(idx)} y1={pad} y2={height - 14} />}
        <circle className="chart-dot" cx={x(idx)} cy={y(points[idx])} r={5} />
        {labels && (<><text className="chart-axis" x={pad} y={height - 2}>{labels[0]}</text><text className="chart-axis" x={width - pad} y={height - 2} textAnchor="end">{labels[1]}</text></>)}
      </svg>
      {hover !== null && <span className="tip" style={{ left: `${(x(idx) / width) * 100}%`, top: `${(y(points[idx]) / height) * 100}%` }}>{format(points[idx])}</span>}
    </div>
  );
}

export function Spark({ points, width = 120, height = 32, label }: { points: number[]; width?: number; height?: number; label: string }) {
  const max = Math.max(...points); const min = Math.min(...points);
  const x = (i: number) => 4 + (i * (width - 8)) / (points.length - 1);
  const y = (v: number) => 4 + (1 - (v - min) / Math.max(max - min, 1)) * (height - 8);
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <path className="chart-line" d={d} />
      <circle className="chart-dot" cx={x(points.length - 1)} cy={y(points[points.length - 1])} r={4} />
    </svg>
  );
}

export interface Col { key: string; label: string; align?: 'l' | 'r' }
export function Table({ cols, rows, total }: { cols: Col[]; rows: Record<string, string>[]; total?: Record<string, string> }) {
  return (
    <table className="tbl">
      <thead><tr>{cols.map((c) => <th key={c.key} className={c.align === 'r' ? 'r' : ''} scope="col">{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{r[c.key]}</td>)}</tr>)}</tbody>
      {total && <tfoot><tr>{cols.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{total[c.key] ?? ''}</td>)}</tr></tfoot>}
    </table>
  );
}

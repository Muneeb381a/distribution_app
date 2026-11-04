'use client';

import { useEffect, useRef, useState } from 'react';

export interface Series { key: string; label: string; color: string }
export interface Point { label: string; /** Full label for the tooltip. */ title?: string; values: Record<string, number> }

const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 48 };
const GAP = 2; // surface gap between stacked segments
const R = 4; // rounded data-end

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
const compact = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${+(v / 1e3).toFixed(0)}K` : v.toLocaleString('en-PK'));
const money = (v: number) => v.toLocaleString('en-PK');

/** Top-rounded rect path, square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/**
 * Stacked columns with a legend, hover tooltip and an accessible table.
 * Negative values are drawn as 0 (sales cannot be negative; use a table for profit/loss).
 */
export default function StackedColumns({ data, series, caption, highlight }: { data: Point[]; series: Series[]; caption: string; highlight?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = data.map((d) => series.reduce((s, k) => s + Math.max(0, d.values[k.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const plotW = w - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const hv = hover !== null ? data[hover] : null;

  return (
    <figure className="chart" ref={box}>
      <div className="chart-legend" aria-hidden="true">
        {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div className="chart-plot" onMouseLeave={() => setHover(null)}>
        <svg width={w} height={H} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">{compact(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.left + band * i + band / 2;
            let base = 0;
            const segs = series.map((s) => ({ s, v: Math.max(0, d.values[s.key] ?? 0) })).filter((x) => x.v > 0);
            return (
              <g key={i} className={hover !== null && hover !== i ? 'dim' : ''}>
                {segs.map(({ s, v }, j) => {
                  const top = y(base + v);
                  const bottom = y(base) - (j > 0 ? GAP : 0);
                  base += v;
                  const h = Math.max(0, bottom - top);
                  const last = j === segs.length - 1;
                  return last
                    ? <path key={s.key} d={topRounded(cx - barW / 2, top, barW, h, R)} fill={s.color} />
                    : <rect key={s.key} x={cx - barW / 2} y={top} width={barW} height={h} fill={s.color} />;
                })}
                {(i % every === 0 || d.label === highlight) && (
                  <text x={cx} y={H - 8} textAnchor="middle" className={`chart-tick${d.label === highlight ? ' strong' : ''}`}>{d.label}</text>
                )}
                {/* hit target: the whole band, taller than the mark */}
                <rect x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={-1} />
              </g>
            );
          })}
          <line x1={PAD.left} x2={w - PAD.right} y1={y(0)} y2={y(0)} className="chart-axis" />
        </svg>
        {hv && hover !== null && (
          <div className="chart-tip" style={{ left: Math.min(w - 170, Math.max(0, PAD.left + band * hover + band / 2 - 80)), top: Math.max(0, y(totals[hover]) - 86) }}>
            <b>{hv.title ?? hv.label}</b>
            {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}<em>{money(hv.values[s.key] ?? 0)}</em></span>)}
            <span className="tot">Total<em>{money(totals[hover])}</em></span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Period</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}<th>Total</th></tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><td>{d.title ?? d.label}</td>{series.map((s) => <td key={s.key}>{money(d.values[s.key] ?? 0)}</td>)}<td>{money(totals[i])}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export const LINE_SERIES: Series[] = [
  { key: 'BOTTLES', label: 'Bottles', color: '#2a78d6' },
  { key: 'RICE', label: 'Rice', color: '#eb6834' },
];

/** Small Recharts wrappers used across the dashboard, themed to match the app. */
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell,
} from 'recharts';
import { fixedNoNegZero } from './aggregate';

export interface Datum {
  label: string;
  value: number | null;
  flag?: 'good' | 'warn' | 'bad';
  /**
   * Drawn in grey: the value is shown, and the analysis leaves the row out (Round 83: an eye chart's bar
   * whose blink data is not usable under rule rel-r1). Its value is not hidden, only marked.
   */
  dim?: boolean;
}

const FLAG_COLORS = { good: '#22c97a', warn: '#f5a623', bad: '#e64c4c' } as const;
/** A bar left out of the analysis. A fill, so 3:1 on white is the bar it must clear (tests/contrast.test.ts). */
export const DIM_FILL = '#8a8780';

export function BarPanel({
  title, data, color = '#4f8ef7', unit = '', baseline, dimNote,
}: { title: string; data: Datum[]; color?: string; unit?: string; baseline?: number; dimNote?: string }) {
  const clean = data.filter((d) => d.value != null) as { label: string; value: number; flag?: keyof typeof FLAG_COLORS; dim?: boolean }[];
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <h3 style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 16, fontWeight: 500, color: '#3a3a4a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={clean} margin={{ top: 4, right: 8, bottom: 4, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="label" tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} />
          <YAxis tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 14 }} />
          {baseline != null && <ReferenceLine y={baseline} stroke="#e64c4c" strokeDasharray="4 4" />}
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]}>
            {clean.map((d, i) => (
              <Cell key={i} fill={d.dim ? DIM_FILL : d.flag ? FLAG_COLORS[d.flag] : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {clean.length < data.length && (
        <p style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 14, color: '#4a4a60', marginTop: 4 }}>
          No data: {data.filter((d) => d.value == null).map((d) => d.label).join(', ')}
        </p>
      )}
      {dimNote && clean.some((d) => d.dim) && (
        <p data-testid="chart-dim-note" style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 14, color: '#4a4a60', marginTop: 4 }}>
          {dimNote}: {clean.filter((d) => d.dim).map((d) => d.label).join(', ')}
        </p>
      )}
    </div>
  );
}

export function LinePanel({
  title, data, color = '#1a1a2e', unit = '', baseline,
}: { title: string; data: Datum[]; color?: string; unit?: string; baseline?: number }) {
  const clean = data.filter((d) => d.value != null);
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <h3 style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 16, fontWeight: 500, color: '#3a3a4a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={clean} margin={{ top: 4, right: 8, bottom: 4, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="label" tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} />
          <YAxis tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 14 }} />
          {baseline != null && <ReferenceLine y={baseline} stroke="#e64c4c" strokeDasharray="4 4" label={{ value: 'baseline', fontSize: 13, fill: '#4a4a60' }} />}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * An axis from zero and `values`, rounded outwards to a step of 1, 2 or 5 x a power of ten, about four
 * steps across. Zero is always on it (the trend's reference). Exported for its tests.
 */
export function niceScale(values: number[]): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((x) => Number.isFinite(x));
  const lo = Math.min(0, ...v);
  const hi = Math.max(0, ...v);
  const raw = (hi - lo || 1) / 4; // every value zero: an axis one unit wide
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
  // A hair of slack, so 0.30000000000000004 does not add a step for a binary rounding error.
  let from = Math.floor(lo / step + 1e-9);
  let to = Math.ceil(hi / step - 1e-9);
  if (to <= from) { from -= 1; to += 1; }
  const ticks = Array.from({ length: to - from + 1 }, (_, i) => Number(((from + i) * step).toPrecision(12)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}

/** Whole-number ticks from 1 to `of`: every one up to ten, then 1 and multiples of a round step. */
export function countTicks(of: number): number[] {
  const top = Math.max(2, Math.floor(of));
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((x) => top / x <= 10) ?? 1000;
  const ticks = [1];
  for (let t = step; t <= top; t += step) if (t > 1) ticks.push(t);
  return ticks;
}

export interface TrendAxisPoint { n: number; mean: number | null; lcl: number | null; ucl: number | null }

/**
 * The trend's y axis. The interval over two participants is very wide, and scaling the axis to it
 * flattens everything after. Once points rest on three or more participants, the axis is scaled to
 * those (and zero) and the earlier intervals may run off it (`clipped`), which the section's caption
 * says and the tooltip gives in full. Before that, every point is on the axis. With two points the axis
 * used to be left to the chart library, which dropped zero, and the reference line with it (review of
 * Round 98). Exported for its tests.
 */
export function trendAxis(points: TrendAxisPoint[]): { scale: { domain: [number, number]; ticks: number[] }; clipped: boolean } {
  const settled = points.filter((p) => p.n >= 3);
  const basis = (settled.length ? settled : points).flatMap((p) => [p.mean, p.lcl, p.ucl]).filter((x): x is number => x != null);
  return { scale: niceScale(basis), clipped: settled.length > 0 && settled.length < points.length };
}

/**
 * A running estimate as participants complete (Round 98, All Participants tab): after each one, the
 * mean over everyone so far with its 95% interval as two dashed lines, and zero as the reference.
 * Descriptive. The x axis is the number of participants completed, the same on every chart; a
 * participant with no colour measured in both polarities for this outcome adds no point (Round 99).
 */
export function TrendPanel({
  title, unit = '', points, digits = 2, of,
}: {
  title: string; unit?: string; digits?: number;
  /** Participants of the analysis set completed so far: the axis runs to it. */
  of: number;
  points: { k: number; n: number; mean: number | null; lcl: number | null; ucl: number | null }[];
}) {
  const data = points.map((p) => ({ k: p.k, mean: p.mean, lcl: p.lcl, ucl: p.ucl }));
  const { scale, clipped } = trendAxis(points);
  const shown = (x: number) => `${fixedNoNegZero(x, digits)}${unit ? ` ${unit}` : ''}`;
  const byK = new Map(points.map((p) => [p.k, p]));
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }} data-testid="cohort-trend">
      <h3 style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 16, fontWeight: 500, color: '#3a3a4a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 14, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="k" type="number" domain={[1, Math.max(2, of)]} ticks={countTicks(of)} allowDecimals={false}
            tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }}
            label={{ value: 'participants completed', position: 'insideBottom', offset: -8, fontSize: 13, fill: '#4a4a60' }} />
          <YAxis tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} domain={scale.domain} ticks={scale.ticks} allowDataOverflow={clipped} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 14 }}
            labelFormatter={(k) => {
              const p = byK.get(Number(k));
              const n = p && p.n !== p.k ? `; ${p.n} with this outcome` : '';
              return `after ${k} participant${Number(k) === 1 ? '' : 's'} completed${n}`;
            }}
            formatter={(v) => (typeof v === 'number' ? shown(v) : String(v))} />
          <ReferenceLine y={0} stroke="#8a8780" />
          <Line name="upper 95%" type="monotone" dataKey="ucl" stroke="#8a8780" strokeDasharray="4 4" dot={false} connectNulls />
          <Line name="lower 95%" type="monotone" dataKey="lcl" stroke="#8a8780" strokeDasharray="4 4" dot={false} connectNulls />
          <Line name="mean difference" type="monotone" dataKey="mean" stroke="#1a1a2e" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

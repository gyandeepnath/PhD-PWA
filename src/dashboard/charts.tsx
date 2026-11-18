/** Small Recharts wrappers used across the dashboard, themed to match the app. */
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell,
} from 'recharts';

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
 * A running estimate as participants are added (Round 98, All Participants tab): the mean after each
 * participant, its 95% interval as two dashed lines, and zero as the reference. Descriptive.
 */
export function TrendPanel({
  title, unit = '', points, digits = 2,
}: {
  title: string; unit?: string; digits?: number;
  points: { k: number; mean: number | null; lcl: number | null; ucl: number | null }[];
}) {
  const round = (x: number | null) => (x == null ? null : Number(x.toFixed(digits + 1)));
  const data = points.map((p) => ({ k: p.k, mean: round(p.mean), lcl: round(p.lcl), ucl: round(p.ucl) }));
  // The interval after two participants is very wide, and scaling the axis to it flattens everything
  // after. From three participants on, the axis is scaled to the points and intervals shown there
  // (and zero); the first interval may then run off the chart, which the tooltip still gives in full.
  const later = points.filter((p) => p.k >= 3).flatMap((p) => [p.mean, p.lcl, p.ucl]).filter((x): x is number => x != null);
  const scale: { domain: [number, number]; ticks: number[] } | undefined = later.length
    ? (() => {
        const lo = Math.min(0, ...later); const hi = Math.max(0, ...later);
        // Round outwards to a step of 1, 2 or 5 x a power of ten, about four steps across.
        const raw = (hi - lo || Math.abs(hi) || 1) / 4;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag;
        const from = Math.floor(lo / step); const to = Math.ceil(hi / step);
        const ticks = Array.from({ length: to - from + 1 }, (_, i) => Number(((from + i) * step).toPrecision(12)));
        return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
      })()
    : undefined;
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }} data-testid="cohort-trend">
      <h3 style={{ fontFamily: 'Roboto, ui-sans-serif, sans-serif', fontSize: 16, fontWeight: 500, color: '#3a3a4a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 14, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="k" tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }}
            label={{ value: 'participants completed', position: 'insideBottom', offset: -8, fontSize: 13, fill: '#4a4a60' }} />
          <YAxis tick={{ fontSize: 13, fontFamily: 'DM Mono', fill: '#4a4a60' }} domain={scale?.domain ?? ['auto', 'auto']} ticks={scale?.ticks} allowDataOverflow={scale != null} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 14 }} />
          <ReferenceLine y={0} stroke="#8a8780" />
          <Line type="monotone" dataKey="ucl" stroke="#8a8780" strokeDasharray="4 4" dot={false} connectNulls />
          <Line type="monotone" dataKey="lcl" stroke="#8a8780" strokeDasharray="4 4" dot={false} connectNulls />
          <Line type="monotone" dataKey="mean" stroke="#1a1a2e" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

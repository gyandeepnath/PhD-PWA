/** Small Recharts wrappers used across the dashboard, themed to match the app. */
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell,
} from 'recharts';

export interface Datum {
  label: string;
  value: number | null;
  flag?: 'good' | 'warn' | 'bad';
}

const FLAG_COLORS = { good: '#22c97a', warn: '#f5a623', bad: '#e64c4c' } as const;

export function BarPanel({
  title, data, color = '#4f8ef7', unit = '', baseline,
}: { title: string; data: Datum[]; color?: string; unit?: string; baseline?: number }) {
  const clean = data.filter((d) => d.value != null) as { label: string; value: number; flag?: keyof typeof FLAG_COLORS }[];
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <h3 style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: '#5a5a7a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={clean} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'DM Mono' }} />
          <YAxis tick={{ fontSize: 11, fontFamily: 'DM Mono' }} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 12 }} />
          {baseline != null && <ReferenceLine y={baseline} stroke="#e64c4c" strokeDasharray="4 4" />}
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]}>
            {clean.map((d, i) => (
              <Cell key={i} fill={d.flag ? FLAG_COLORS[d.flag] : color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinePanel({
  title, data, color = '#1a1a2e', unit = '', baseline,
}: { title: string; data: Datum[]; color?: string; unit?: string; baseline?: number }) {
  const clean = data.filter((d) => d.value != null);
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <h3 style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: '#5a5a7a', marginBottom: 8 }}>
        {title}{unit ? ` (${unit})` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={clean} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'DM Mono' }} />
          <YAxis tick={{ fontSize: 11, fontFamily: 'DM Mono' }} />
          <Tooltip contentStyle={{ fontFamily: 'DM Mono', fontSize: 12 }} />
          {baseline != null && <ReferenceLine y={baseline} stroke="#e64c4c" strokeDasharray="4 4" label={{ value: 'baseline', fontSize: 10 }} />}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

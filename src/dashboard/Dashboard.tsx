/**
 * Researcher analysis dashboard. Loads a session bundle, shows charts/tables built from the shared
 * condition aggregation, surfaces data-quality flags, and exports the CSV+JSON bundle.
 * Honest caveats are shown inline (uncalibrated gaze; sub-Nyquist blink tiers; blink-rate is
 * non-monotonic w.r.t. fatigue; small-N d').
 */
import { useEffect, useMemo, useState } from 'react';
import { gatherSession, listSessions, type SessionBundle } from '@/storage/gather';
import { buildConditionSummaries, baselineFatigueMean, type ConditionSummary } from './aggregate';
import { buildExportFiles, downloadExport } from '@/storage/export';
import { BarPanel, LinePanel, type Datum } from './charts';
import type { SessionRecord } from '@/storage/types';

type Tab = 'overview' | 'reaction' | 'fatigue' | 'search' | 'eye' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'reaction', label: 'Reaction Time' },
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'search', label: 'Search & Perception' },
  { id: 'eye', label: 'Data Quality / QC' },
  { id: 'export', label: 'Export' },
];

const FLAG_COLOR = { good: '#22c97a', warn: '#f5a623', bad: '#e64c4c' } as const;
const bar = (s: ConditionSummary[], key: keyof ConditionSummary, flagKey = false): Datum[] =>
  s.map((c) => ({ label: c.condition_label, value: c[key] as number | null, flag: flagKey ? c.qc.overall : undefined }));

export function Dashboard({ initialSessionId }: { initialSessionId?: string }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listSessions().then((s) => {
      setSessions(s);
      if (!sessionId && s[0]) setSessionId(s[0].session_id);
    });
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) gatherSession(sessionId).then(setBundle);
  }, [sessionId]);

  const summaries = useMemo(() => (bundle ? buildConditionSummaries(bundle) : []), [bundle]);
  const baseline = bundle ? baselineFatigueMean(bundle) : null;

  const onExport = async () => {
    if (!bundle) return;
    setExporting(true);
    try { await downloadExport(buildExportFiles(bundle)); } finally { setExporting(false); }
  };

  return (
    <div className="min-h-screen w-full bg-cream font-sans text-[#1a1a2e]" style={{ padding: '60px 3% 3%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="font-serif text-3xl font-light">Analysis Dashboard</h1>
        <select
          value={sessionId ?? ''}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #d8d4cc' }}
        >
          {sessions.map((s) => (
            <option key={s.session_id} value={s.session_id}>
              {s.participant_id} · {new Date(s.session_start_time).toLocaleString()}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="font-lab text-sm"
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #d8d4cc', cursor: 'pointer',
              background: tab === t.id ? '#1a1a2e' : '#fff', color: tab === t.id ? '#fff' : '#5a5a7a' }}>
            {t.label}
          </button>
        ))}
      </div>

      {!bundle && <p className="font-lab text-sm text-[#5a5a7a]">No session data found.</p>}

      {bundle && tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Stat label="Conditions completed" value={`${summaries.filter((s) => s.mean_rt_hits_ms != null).length}/${summaries.length}`} />
          <Stat label="Mean RT (hits)" value={fmt(avg(summaries.map((s) => s.mean_rt_hits_ms)), 'ms')} />
          <Stat label="Mean fatigue Δ vs baseline" value={fmt(avg(summaries.map((s) => s.fatigue_delta)))} />
          <Stat label="Comprehension accuracy" value={fmt(100 * (avg(summaries.map((s) => s.comprehension_correct)) ?? 0), '%')} />
          <Stat label="Camera QC (conditions OK)" value={`${summaries.filter((s) => s.qc.overall === 'good').length}/${summaries.length}`} />
          <Stat label="Engagement (conditions OK)" value={`${summaries.filter((s) => s.engagement === 'good').length}/${summaries.length}`} />
        </div>
      )}

      {bundle && tab === 'reaction' && (
        <Grid>
          <BarPanel title="Mean RT per condition" unit="ms" data={bar(summaries, 'mean_rt_hits_ms')} />
          <BarPanel title="Flanker congruency effect" unit="ms" data={bar(summaries, 'flanker_congruency_effect_ms')} color="#1a1a2e" />
          <BarPanel title="d′ (sensitivity)" data={bar(summaries, 'd_prime')} color="#22c97a" />
          <BarPanel title="Hit rate" data={bar(summaries, 'hit_rate')} color="#4f8ef7" />
          <Caveat text="Per-condition d′ rests on ~24 signal trials (SE often > 0.3). For inference, aggregate d′ across conditions per participant (see the R/Python templates). FCE is the reliable executive-control DV. RT stimuli use a fixed neutral-grey background so dot salience is constant across conditions." />
        </Grid>
      )}

      {bundle && tab === 'fatigue' && (
        <Grid>
          <LinePanel title="Composite fatigue by serial position" data={summaries.map((s) => ({ label: `${s.session_position + 1}:${s.condition_label}`, value: s.fatigue_mean }))} baseline={baseline ?? undefined} />
          <BarPanel title="Fatigue Δ from baseline" data={bar(summaries, 'fatigue_delta')} color="#f5a623" />
          <BarPanel title="Eye strain" data={bar(summaries, 'eye_strain')} color="#e64c4c" />
          <BarPanel title="Dryness" data={bar(summaries, 'dryness')} color="#e07b39" />
          <SummaryTable
            headers={['Cond', 'Pol', 'Composite', 'Δ', 'Strain', 'Dry', 'Blur', 'Burn', 'Head']}
            rows={summaries.map((s) => [s.condition_label, s.polarity, n(s.fatigue_mean), n(s.fatigue_delta), n(s.eye_strain), n(s.dryness), n(s.blur), n(s.burning), n(s.headache)])}
          />
        </Grid>
      )}

      {bundle && tab === 'search' && (
        <Grid>
          <BarPanel title="Search time" unit="ms" data={bar(summaries, 'search_time_ms')} />
          <BarPanel title="Search accuracy" data={bar(summaries, 'search_accuracy')} color="#22c97a" />
          <BarPanel title="Display comfort" data={bar(summaries, 'comfort_score')} color="#4f8ef7" />
          <BarPanel title="Text clarity" data={bar(summaries, 'clarity_score')} color="#1a1a2e" />
          <SummaryTable
            headers={['Cond', 'WCAG', 'Search ms', 'Acc', 'Eff', 'FalseDet', 'Comfort', 'Clarity']}
            rows={summaries.map((s) => [s.condition_label, `${s.wcag_contrast_ratio}${s.below_wcag_aa ? ' ⚠' : ''}`, n(s.search_time_ms, 0), n(s.search_accuracy), n(s.search_efficiency), n(s.false_detections, 0), n(s.comfort_score, 0), n(s.clarity_score, 0)])}
          />
          <Caveat text="Visual-search target counts differ across passages (recorded per condition); passage↔condition decoupling makes this orthogonal to condition. WCAG ⚠ marks conditions below AA (4.5:1) — include contrast as a covariate." />
        </Grid>
      )}

      {bundle && tab === 'eye' && (
        <Grid>
          <BarPanel title="Engagement quality score per condition" data={summaries.map((s) => ({ label: s.condition_label, value: s.quality_score, flag: s.engagement }))} />
          <BarPanel title="Full-blink rate per condition" unit="/min" data={bar(summaries, 'blink_rate_full')} color="#4f8ef7" />
          <EngagementTable summaries={summaries} />
          <BarPanel title="Camera face presence" data={summaries.map((s) => ({ label: s.condition_label, value: s.face_presence_ratio, flag: s.qc.facePresence }))} />
          <QcTable summaries={summaries} />
          <Caveat text="Engagement quality flags boredom/careless responding (reading skim, rushed or straight-lined ratings, RT disengagement, low face presence) so suspect conditions can be excluded or modelled — see 12_quality_flags.csv. Lighting QC flags low/over-exposed conditions that degrade blink/EAR detection. Blink rate is non-monotonic w.r.t. fatigue: it DROPS with concentration/reading and RISES with fatigue onset. Micro/partial tiers are sub-Nyquist below 25 fps (flagged). Gaze zones are meaningful only when gaze_calibrated is true (real per-participant calibration succeeded); otherwise treat them as a gross head-movement proxy." />
        </Grid>
      )}

      {bundle && tab === 'export' && (
        <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 20, maxWidth: 720 }}>
          <p className="font-lab text-sm text-[#5a5a7a]">
            Exports 11 CSVs + a nested JSON bundle + a master codebook + a provenance manifest (app
            version, git hash, condition-definition hash, per-file checksums). Analyse with the R /
            Python mixed-model templates in <code>src/analysis/</code>.
          </p>
          <button onClick={onExport} disabled={exporting}
            className="mt-4 rounded-xl px-8 py-3 font-lab text-sm text-white transition active:scale-95"
            style={{ background: '#1a1a2e', cursor: exporting ? 'wait' : 'pointer' }}>
            {exporting ? 'Exporting…' : 'Download data bundle ↓'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- small presentational helpers ----
function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>{children}</div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <div className="font-lab text-xs text-[#5a5a7a]">{label}</div>
      <div className="font-serif" style={{ fontSize: 28, marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Caveat({ text }: { text: string }) {
  return (
    <div style={{ gridColumn: '1 / -1', background: '#fff8ec', border: '1px solid #f5a62340', borderRadius: 12, padding: 14 }}>
      <p className="font-lab text-xs leading-relaxed" style={{ color: '#8a6d2f' }}>⚠ {text}</p>
    </div>
  );
}
function SummaryTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div style={{ gridColumn: '1 / -1', overflowX: 'auto', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
        <thead><tr>{headers.map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#5a5a7a', borderBottom: '1px solid #e5e2dc' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid #f3f1ec' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function EngagementTable({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={{ gridColumn: '1 / -1', overflowX: 'auto', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
        <thead><tr>{['Cond', 'Engagement', 'Quality', 'Read ms', 'Fatigue ms', 'Flags'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#5a5a7a', borderBottom: '1px solid #e5e2dc' }}>{h}</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.condition_id}>
              <td style={cell}>{s.condition_label}</td>
              <td style={{ ...cell, fontWeight: 700, color: FLAG_COLOR[s.engagement] }}>{s.engagement}</td>
              <td style={cell}>{n(s.quality_score)}</td>
              <td style={cell}>{n(s.reading_time_ms, 0)}</td>
              <td style={cell}>{n(s.fatigue_response_ms, 0)}</td>
              <td style={cell}>{s.engagement_reasons.length ? s.engagement_reasons.join('; ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function QcTable({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={{ gridColumn: '1 / -1', overflowX: 'auto', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
        <thead><tr>{['Cond', 'Camera', 'Eff FPS', 'Face presence', 'Off-axis', 'Lighting', 'Overall'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#5a5a7a', borderBottom: '1px solid #e5e2dc' }}>{h}</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.condition_id}>
              <td style={cell}>{s.condition_label}</td>
              <td style={cell}>{s.camera_active ? 'on' : 'off'}</td>
              <td style={cell}>{n(s.effective_fps, 0)}{s.camera_active && !s.fps_adequate_for_tiers ? ' ⚠' : ''}</td>
              <td style={{ ...cell, color: FLAG_COLOR[s.qc.facePresence] }}>{n(s.face_presence_ratio)}</td>
              <td style={{ ...cell, color: FLAG_COLOR[s.qc.offAxis] }}>{n(s.off_axis_ratio)}</td>
              <td style={{ ...cell, color: FLAG_COLOR[s.qc.lighting] }}>{s.lighting_quality ?? '—'}</td>
              <td style={{ ...cell, fontWeight: 700, color: FLAG_COLOR[s.qc.overall] }}>{s.qc.overall}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const cell = { padding: '6px 10px', borderBottom: '1px solid #f3f1ec' } as const;

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
function fmt(x: number | null, unit = ''): string {
  return x == null ? '—' : `${Math.round(x * 10) / 10}${unit}`;
}
function n(x: number | null, dp = 2): string {
  return x == null ? '—' : (Math.round(x * 10 ** dp) / 10 ** dp).toString();
}

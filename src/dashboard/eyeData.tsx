/**
 * The Data Quality / QC tab's per-condition view: "Is the blink data reliable?"
 *
 * One row per reading condition: the verdict (rule rel-r1, tracking/ocularReliability.ts — the same one
 * the export writes as ocular_reliability), then one status cell per check under the measure's one name
 * (MEASURE), then a line saying why when anything is not right, and Details with the rule, the numbers,
 * the notes and the engagement signals. Every number the older tables showed is still here: the tables
 * themselves sit under "Every number, as tables".
 *
 * WHY (Round 83). The investigator, testing 2.3.1, saw most conditions marked bad and long paragraphs of
 * reasons beside them. The red came from thresholds of the dashboard's own (aggregate.ts, qc_overall),
 * which the analysis does not apply; the paragraphs were every reason in full, side by side. Now "Not
 * usable" means the row is out of the eye-data analysis, and the line under it names the check.
 *
 * NOTES ARE NOT FLAGS. Few blinks, the light, a covered camera and a narrower eye are worth knowing and
 * no analysis rule uses them, so they never carry the ! of a flagged check: they are written as "Note:"
 * in plain ink beside the verdict, and the check's own cell keeps its ✓.
 */
import { useState } from 'react';
import type { ConditionSummary } from './aggregate';
import { MEASURE } from '@/tracking/measurementSchedule';
import { FPS_TIER_WORD, fpsText } from '@/tracking/frameRateGate';
import {
  RELIABILITY_RULE_VERSION, RELIABILITY_WORD, type CheckStatus, type Reliability, type ReliabilityCheck,
} from '@/tracking/ocularReliability';
import { UI_GROUNDS, UI_TEXT } from '@/lib/uiPalette';
import { CHECK_STATUS, More, Notice, STATUS, VERDICT_STATUS, cell, n, type StatusKey } from './parts';

export function countReliability(summaries: ConditionSummary[]): Record<Reliability, number> {
  const c: Record<Reliability, number> = { good: 0, usable: 0, not_usable: 0 };
  for (const s of summaries) c[s.camera_verdict.reliability]++;
  return c;
}

export function EyeDataPanel({ summaries }: { summaries: ConditionSummary[] }) {
  const counts = countReliability(summaries);
  const head = ['Cond', 'Verdict', 'Camera', MEASURE.blinks.name, MEASURE.samplingRate.name, MEASURE.faceInView.name, MEASURE.headTurnedAway.name, 'Reading seen', 'Engagement', ''];
  return (
    <div data-testid="camera-verdicts" style={{ gridColumn: '1 / -1', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <h3 className="font-sans" style={{ fontSize: 18, fontWeight: 700, color: UI_TEXT.ink }}>Is the blink data reliable?</h3>
      <p className="font-sans" data-testid="reliability-counts" style={{ fontSize: 16, color: UI_TEXT.body, marginTop: 4 }}>
        <span style={{ color: UI_TEXT.green, fontWeight: 600 }}>{STATUS.good.icon} {counts.good} good</span>{' · '}
        <span style={{ color: UI_TEXT.amber, fontWeight: 600 }}>{STATUS.warn.icon} {counts.usable} usable</span>{' · '}
        <span style={{ color: UI_TEXT.red, fontWeight: 600 }}>{STATUS.bad.icon} {counts.not_usable} not usable</span>
        <span style={{ color: UI_TEXT.muted }}> · rule {RELIABILITY_RULE_VERSION}</span>
      </p>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Roboto, system-ui, sans-serif', fontSize: 15 }}>
          <thead>
            <tr>{head.map((h, i) => <th key={i} style={{ textAlign: 'left', padding: '6px 6px', color: UI_TEXT.muted, fontWeight: 500, borderBottom: '1px solid #e5e2dc', verticalAlign: 'bottom' }}>{h}</th>)}</tr>
          </thead>
          {summaries.map((s) => <EyeDataRow key={s.condition_id} s={s} columns={head.length} />)}
        </table>
      </div>
      {/* The comparison figures are from the one verified reading study in the citation ledger (#2), with
          their spread, so a single participant is not judged against a mean. */}
      <Notice
        short="For comparison: adults reading on a computer blinked 11.6 times a minute (SD 7.84), and 16.1% of their blinks were incomplete (SD 15.7)."
        more={'21 adults reading on a computer for 15 minutes; individuals ranged from 0.9% to 56.5% incomplete — Portello, Rosenfield & Chu 2013. '
          + 'People differ a lot, so one participant with few blinks is not by itself a sign of a fault; the verdict above is what says the camera was seeing the eyes. '
          + 'The camera self-test after calibration (selftest_* in the export) is the direct check: the participant blinked on cue and the result was shown on the spot.'} />
    </div>
  );
}

/** One condition: its line of status cells, the reason and notes under it, and Details. */
function EyeDataRow({ s, columns }: { s: ConditionSummary; columns: number }) {
  const [open, setOpen] = useState(false);
  const v = s.camera_verdict;
  const st = STATUS[VERDICT_STATUS[v.reliability]];
  const byKey = Object.fromEntries(v.checks.map((c) => [c.key, c])) as Record<ReliabilityCheck['key'], ReliabilityCheck>;
  // The rate and its steadiness are one cell, in the researcher card's words ("24.1 · adequate"): the
  // worse of the two checks.
  const rateStatus = worstStatus([byKey.rate.status, byKey.consistency.status]);
  const rateValue = s.sampling_fps_observed == null || s.fps_tier == null ? 'not measurable'
    : `${fpsText(s.sampling_fps_observed)} · ${FPS_TIER_WORD[s.fps_tier].toLowerCase()}${byKey.consistency.status === 'flag' ? ', off usual' : ''}`;
  const pctOf = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const seen = s.observed_duration_ms != null && s.reading_time_ms ? s.observed_duration_ms / s.reading_time_ms : null;
  const engagementSignals = s.engagement_signals.filter((x) => x.kind === 'engagement');
  const td: React.CSSProperties = { padding: '6px 6px', verticalAlign: 'middle', whiteSpace: 'nowrap' };
  return (
    <tbody data-testid="camera-verdict" data-level={v.level} data-reliability={v.reliability} style={{ borderTop: '1px solid #eeeae2' }}>
      <tr>
        <td style={{ ...td, fontFamily: '"DM Mono", monospace', fontWeight: 700, fontSize: 16 }}>{s.condition_label}</td>
        <td style={td}>
          <span data-testid="reliability-badge" style={{ fontWeight: 700, color: st.color, border: `1.5px solid ${st.color}`, borderRadius: 999, padding: '1px 9px' }}>
            {st.icon} {RELIABILITY_WORD[v.reliability]}
          </span>
        </td>
        {/* "on" or "off" here; why it was off is the reason line and Details. */}
        <StatusCell status={CHECK_STATUS[byKey.camera.status]} value={s.camera_active ? 'on' : 'off'} />
        {s.camera_active ? (
          <>
            <StatusCell status={CHECK_STATUS[byKey.blinks.status]}
              value={s.blink_count_total == null ? 'not counted' : String(s.blink_count_total)} />
            <StatusCell status={CHECK_STATUS[rateStatus]} value={rateValue} />
            <StatusCell status={CHECK_STATUS[byKey.face.status]} value={pctOf(s.face_presence_ratio)} />
            <StatusCell status={CHECK_STATUS[byKey.head.status]} value={pctOf(s.off_axis_ratio)} />
            <StatusCell status={CHECK_STATUS[byKey.exposure.status]} value={pctOf(seen)} />
          </>
        ) : <td colSpan={5} style={{ ...td, color: UI_TEXT.muted }}>no eye data</td>}
        {/* About the participant, not the camera: it never changes the verdict. */}
        <StatusCell status={s.engagement === 'good' ? 'good' : s.engagement === 'warn' ? 'warn' : 'bad'} value={s.engagement} />
        <td style={{ ...td, textAlign: 'right' }}>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="font-sans text-[15px]"
            style={{ minHeight: 44, padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer', color: UI_TEXT.blue, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }}>
            {open ? 'Hide ▴' : 'Details ▾'}
          </button>
        </td>
      </tr>
      {(v.reason != null || v.notes.length > 0) && (
        <tr>
          <td />
          <td colSpan={columns - 1} style={{ padding: '0 6px 8px', fontSize: 15 }}>
            {v.reason != null && <span data-testid="verdict-reason" style={{ color: st.color }}>{sentence(v.reason)}</span>}
            {v.notes.length > 0 && (
              <span data-testid="verdict-notes" style={{ color: UI_TEXT.muted }}>
                {v.reason != null ? ' · ' : ''}{v.notes.length === 1 ? 'Note' : 'Notes'}: {v.notes.map((x) => x.short).join(', ')}
              </span>
            )}
          </td>
        </tr>
      )}
      <tr hidden={!open}>
        <td />
        <td colSpan={columns - 1} style={{ padding: '4px 6px 12px' }}>
          <ConditionDetails s={s} engagementSignals={engagementSignals} />
        </td>
      </tr>
    </tbody>
  );
}

/** One status in a table cell: the symbol and the value in the status colour, on a faint tint when not passed. */
function StatusCell({ status, value }: { status: StatusKey; value: string }) {
  const st = STATUS[status];
  const ground = status === 'warn' ? UI_GROUNDS.notice : status === 'bad' ? UI_GROUNDS.alert : undefined;
  return (
    <td data-testid="quality-cell" data-status={status} style={{ padding: '6px 6px', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
      <span style={{ color: st.color, background: ground, borderRadius: 6, padding: ground ? '2px 6px' : 0, fontWeight: status === 'good' || status === 'none' ? 400 : 600 }}>
        <span aria-hidden style={{ fontWeight: 700 }}>{st.icon}</span> {value}
      </span>
    </td>
  );
}

/** Behind Details: every check with its rule, the notes in full, every number of the condition, the engagement signals. */
function ConditionDetails({ s, engagementSignals }: { s: ConditionSummary; engagementSignals: ConditionSummary['engagement_signals'] }) {
  const v = s.camera_verdict;
  return (
    <div data-testid="condition-details" style={{ display: 'grid', gap: 10, whiteSpace: 'normal' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 13 }}>
          <thead><tr>{['', 'Check', 'Measured', 'Needed', 'Rule', 'If not met'].map((h) => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: UI_TEXT.muted, borderBottom: '1px solid #e5e2dc' }}>{h}</th>)}</tr></thead>
          <tbody>
            {v.checks.map((c) => (
              <tr key={c.key}>
                <td style={{ ...cell, color: STATUS[CHECK_STATUS[c.status]].color, fontWeight: 700 }}>{STATUS[CHECK_STATUS[c.status]].icon}</td>
                <td style={cell}>{c.label}</td>
                <td style={{ ...cell, color: STATUS[CHECK_STATUS[c.status]].color }}>{c.value}</td>
                <td style={cell}>{c.needed}</td>
                <td style={cell}>{c.gate}</td>
                <td style={cell}>{c.consequence || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.notes.length > 0 && (
        <div>
          <p className="font-sans text-[15px]" style={{ fontWeight: 600, color: UI_TEXT.body }}>Notes (they do not change the verdict)</p>
          <ul style={{ paddingLeft: 18, listStyle: 'disc' }}>
            {v.notes.map((x) => <li key={x.key} className="font-sans text-[15px]" style={{ color: UI_TEXT.body }}>{x.text}</li>)}
          </ul>
        </div>
      )}
      {s.camera_active && (
        <dl className="font-sans text-[15px]" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '2px 16px', color: UI_TEXT.body }}>
          <Num k="Minutes seen" v={n(s.observed_minutes, 1)} />
          <Num k={`${MEASURE.blinkRate.name} /min`} v={n(s.blink_rate, 1)} />
          <Num k={MEASURE.incompleteRatio.name} v={n(s.incomplete_blink_ratio)} />
          <Num k={`${MEASURE.interBlinkInterval.name} ms`} v={n(s.mean_inter_blink_interval_ms, 0)} />
          <Num k={`${MEASURE.perclos.name} P80`} v={n(s.perclos_p80)} />
          <Num k={`${MEASURE.perclos.name} P70`} v={n(s.perclos_p70)} />
          <Num k={MEASURE.longClosures.name} v={n(s.long_closure_count, 0)} />
          <Num k={MEASURE.onScreen.name} v={n(s.on_screen_ratio)} />
          <Num k={MEASURE.lighting.name} v={s.lighting_quality ?? '—'} />
          <Num k={MEASURE.pictureBrightness.name} v={n(s.mean_face_luma, 0)} />
          <Num k="Camera covered" v={s.camera_blocked_ms == null ? '—' : `${Math.round(s.camera_blocked_ms / 1000)} s`} />
          <Num k="Open eye vs calibration" v={s.open_eye_vs_baseline == null ? '—' : `${Math.round(s.open_eye_vs_baseline * 100)}%`} />
        </dl>
      )}
      <div>
        <p className="font-sans text-[15px]" style={{ fontWeight: 600, color: UI_TEXT.body }}>
          Engagement {s.engagement} · score {n(s.quality_score)}
        </p>
        {engagementSignals.length === 0
          ? <p className="font-sans text-[15px]" style={{ color: UI_TEXT.muted }}>No signal fired.</p>
          : (
            <ul style={{ paddingLeft: 18, listStyle: 'disc' }}>
              {engagementSignals.map((x) => (
                <li key={x.detail} className="font-sans text-[15px]" style={{ color: UI_TEXT.body }}>
                  {x.short}{x.penalty > 0 ? ` (−${x.penalty})` : ' (not counted)'}
                  <span style={{ color: UI_TEXT.muted }}> — {x.detail}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
function Num({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid #f3f1ec', padding: '2px 0' }}>
      <dt style={{ color: UI_TEXT.muted }}>{k}</dt><dd className="font-lab">{v}</dd>
    </div>
  );
}

/** Every number of every condition, as the three tables the tab used to open with. */
export function EyeTables({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
      <OcularTable summaries={summaries} />
      <EngagementTable summaries={summaries} />
      <QcTable summaries={summaries} />
    </div>
  );
}

const th = { textAlign: 'left', padding: '6px 10px', color: UI_TEXT.muted, borderBottom: '1px solid #e5e2dc' } as const;
const tableBox = { overflowX: 'auto', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 12 } as const;

function OcularTable({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={tableBox}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 13 }}>
        <thead><tr>{['Cond', MEASURE.blinks.name, 'Minutes seen', `${MEASURE.blinkRate.name} /min`, MEASURE.incompleteRatio.name, `${MEASURE.interBlinkInterval.name} ms`, `${MEASURE.perclos.name} P80`, `${MEASURE.perclos.name} P70`, MEASURE.longClosures.name, `${MEASURE.samplingRate.name} (tier)`].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.condition_id}>
              <td style={cell}>{s.condition_label}</td>
              <td style={cell}>{n(s.blink_count_total, 0)}</td>
              <td style={cell}>{n(s.observed_minutes, 1)}</td>
              <td style={cell}>{n(s.blink_rate, 1)}</td>
              <td style={cell}>{n(s.incomplete_blink_ratio)}</td>
              <td style={cell}>{n(s.mean_inter_blink_interval_ms, 0)}</td>
              <td style={cell}>{n(s.perclos_p80)}</td>
              <td style={cell}>{n(s.perclos_p70)}</td>
              <td style={cell}>{n(s.long_closure_count, 0)}</td>
              <td style={{ ...cell, color: checkColor(s, 'rate', 'consistency') }}><FpsCell s={s} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function EngagementTable({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={tableBox}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 13 }}>
        <thead><tr>{['Cond', 'Engagement', 'Quality', 'Read ms', 'Fatigue ms', 'Flags'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.condition_id}>
              <td style={cell}>{s.condition_label}</td>
              <td style={{ ...cell, fontWeight: 700, color: STATUS[s.engagement].color }}>{s.engagement}</td>
              <td style={cell}>{n(s.quality_score)}</td>
              <td style={cell}>{n(s.reading_time_ms, 0)}</td>
              <td style={cell}>{n(s.fatigue_response_ms, 0)}</td>
              <td style={cell}>{s.engagement_signals.length ? s.engagement_signals.map((x) => x.short).join(' · ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* The full sentences, as 12_quality_flags.csv carries them in `reasons`. */}
      {summaries.some((s) => s.engagement_reasons.length > 0) && (
        <More label="Flags in full">
          {summaries.filter((s) => s.engagement_reasons.length > 0).map((s) => (
            <p key={s.condition_id} className="font-sans text-[15px]" style={{ color: UI_TEXT.body, marginTop: 4 }}>
              <strong>{s.condition_label}</strong>: {s.engagement_reasons.join('; ')}
            </p>
          ))}
        </More>
      )}
    </div>
  );
}
function QcTable({ summaries }: { summaries: ConditionSummary[] }) {
  return (
    <div style={tableBox}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 13 }}>
        <thead><tr>{['Cond', 'Camera', `${MEASURE.samplingRate.name} (tier)`, MEASURE.faceInView.name, MEASURE.headTurnedAway.name, 'Reading seen', MEASURE.onScreen.name, MEASURE.lighting.name, 'Reliability'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.condition_id}>
              <td style={cell}>{s.condition_label}</td>
              <td style={cell}>{s.camera_active ? 'on' : 'off'}</td>
              <td style={{ ...cell, color: checkColor(s, 'rate', 'consistency') }}><FpsCell s={s} /></td>
              <td style={{ ...cell, color: checkColor(s, 'face') }}>{n(s.face_presence_ratio)}</td>
              <td style={{ ...cell, color: checkColor(s, 'head') }}>{n(s.off_axis_ratio)}</td>
              <td style={{ ...cell, color: checkColor(s, 'exposure') }}>
                {s.observed_duration_ms != null && s.reading_time_ms ? n(s.observed_duration_ms / s.reading_time_ms) : '—'}
              </td>
              {/* A quality check only (gaze-r2); no flag of its own, and — without a passed gaze check. */}
              <td style={cell} data-testid="on-screen-ratio">{n(s.on_screen_ratio)}</td>
              {/* Lighting is a note, not a check: ink, with the word itself saying low or overexposed. */}
              <td style={cell}>{s.lighting_quality ?? '—'}</td>
              <td style={{ ...cell, fontWeight: 700, color: STATUS[VERDICT_STATUS[s.camera_verdict.reliability]].color }}>
                {RELIABILITY_WORD[s.camera_verdict.reliability]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The colour of a table cell: the worst status of the reliability checks it shows; ink when none judged it. */
function checkColor(s: ConditionSummary, ...keys: ReliabilityCheck['key'][]): string | undefined {
  const st = worstStatus(s.camera_verdict.checks.filter((c) => keys.includes(c.key)).map((c) => c.status));
  return st === 'not_judged' ? undefined : STATUS[CHECK_STATUS[st]].color;
}

/**
 * The frame-rate gate fps-g2 in one cell: the eye's sampling rate while the face was seen, its tier
 * (A adequate, B reduced, C too slow) and "off usual" when more than 2 fps from the sitting's median —
 * the same rule as the export and the templates (tracking/frameRateGate.ts). It showed effective_fps
 * with a warning sign under 25, which face loss lowered and which the tablet's 23-25 fps nearly always
 * set off. To one decimal since Round 83 (fpsText): a whole number put 19.6, tier B, at "20".
 */
function FpsCell({ s }: { s: ConditionSummary }) {
  if (!s.camera_active) return <>—</>;
  return (
    <span data-testid="fps-tier" data-tier={s.fps_tier ?? ''} title={s.fps_tier ? FPS_TIER_WORD[s.fps_tier] : 'no rate'}>
      {s.sampling_fps_observed == null ? '—' : fpsText(s.sampling_fps_observed)} {s.fps_tier ?? ''}{s.fps_consistent === false ? ' · off usual' : ''}
    </span>
  );
}

/** A phrase as a sentence: capital first letter, nothing else touched. */
function sentence(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function worstStatus(xs: CheckStatus[]): CheckStatus {
  return xs.includes('fail') ? 'fail' : xs.includes('flag') ? 'flag' : xs.includes('pass') ? 'pass' : 'not_judged';
}

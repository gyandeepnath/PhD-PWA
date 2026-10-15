/**
 * Researcher analysis dashboard. Loads a session bundle, shows charts/tables built from the shared
 * condition aggregation, judges each condition's blink data by rule rel-r1 (the analysis's own checks,
 * tracking/ocularReliability.ts; the Data Quality tab is eyeData.tsx), and exports the CSV+JSON bundle.
 * Every tab opens with a short "How to read this page"; caveats are a line or two, with the full text
 * behind More (parts.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { get, put } from '@/storage/db';
import { gatherSession, listSessions, type SessionBundle } from '@/storage/gather';
import { buildConditionSummaries, baselineFatigueMean, cohortSummary, type ConditionSummary, type CohortSummary } from './aggregate';
import { MEASURE } from '@/tracking/measurementSchedule';
import { FPS_GATE } from '@/tracking/frameRateGate';
import { RELIABILITY_RULE_VERSION } from '@/tracking/ocularReliability';
import { backupExportFile, buildExportFiles, DamagedParticipantCodeError, downloadExport, downloadSessionMedia } from '@/storage/export';
import { buildAnalysisDataset } from '@/storage/analysisExport';
import { BarPanel, LinePanel, type Datum } from './charts';
import type { SessionRecord } from '@/storage/types';
import { N_CONDITIONS } from '@/experiment/conditions';
import { UI_TEXT } from '@/lib/uiPalette';
import { Caveat, Grid, HowToRead, More, Notice, SectionTitle, Stat, cell, countBySeverity, n } from './parts';
import { countReliability, EyeDataPanel, EyeTables } from './eyeData';
import { ScrollCue } from '@/components/ScrollCue';
import { useDialog } from '@/components/ConfirmDialog';
import { BuildIdentity } from '@/components/BuildInfo';
import { buildIdentity } from '@/lib/env';

type Tab = 'overview' | 'cohort' | 'reaction' | 'fatigue' | 'search' | 'eye' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'cohort', label: 'All Participants' },
  { id: 'reaction', label: 'Reaction Time' },
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'search', label: 'Search & Perception' },
  { id: 'eye', label: 'Data Quality / QC' },
  { id: 'export', label: 'Export' },
];

// Headers wrap, so the whole cohort table fits a tablet's width with its last columns in view.
const cohortHead: React.CSSProperties = { padding: '6px 8px', fontWeight: 400, verticalAlign: 'bottom', maxWidth: 150 };
const cohortCell: React.CSSProperties = { padding: '6px 8px', whiteSpace: 'nowrap' };
const bar = (s: ConditionSummary[], key: keyof ConditionSummary): Datum[] =>
  s.map((c) => ({ label: c.condition_label, value: c[key] as number | null }));
/*
 * An eye chart's bars, with a not-usable condition's bar in grey (rule rel-r1): its value is still drawn,
 * and marked as one the main eye-data analysis leaves out. The charts used to draw a camera-stopped or
 * too-slow condition exactly like a good one, beside a verdict that said not to use it.
 */
const eyeBar = (s: ConditionSummary[], key: keyof ConditionSummary): Datum[] =>
  s.map((c) => ({ label: c.condition_label, value: c[key] as number | null, dim: c.camera_verdict.reliability === 'not_usable' }));
const EYE_DIM_NOTE = 'Grey: blink data not usable (✕ above), left out of the main eye-data analysis';

export function Dashboard({ initialSessionId }: { initialSessionId?: string }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [exporting, setExporting] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [cohort, setCohort] = useState<CohortSummary | null>(null);
  const [cohortBusy, setCohortBusy] = useState(false);
  const dialog = useDialog();

  useEffect(() => {
    listSessions().then((s) => {
      setSessions(s);
      if (!sessionId && s[0]) setSessionId(s[0].session_id);
    });
  }, [sessionId]);

  /*
   * Cleared and guarded, because the header re-renders with the NEW participant immediately while
   * this gather is still in flight.
   *
   * Without the clear, every tab kept rendering the previous participant's numbers under the newly
   * selected name until IndexedDB answered — a visible window on a tablet gathering ten conditions
   * of eye metrics, with nothing on screen saying so. Without the cancellation guard, switching
   * A -> B -> C quickly leaves whichever gather resolves LAST in control, so B's data can sit under
   * C's name indefinitely. On a screen whose purpose is deciding whether to re-run a participant,
   * that is the worst available failure. The cohort effect below already used this pattern.
   */
  useEffect(() => {
    if (!sessionId) { setBundle(null); return; }
    let cancelled = false;
    setBundle(null);
    gatherSession(sessionId).then((b) => { if (!cancelled) setBundle(b); });
    return () => { cancelled = true; };
  }, [sessionId]);

  /*
   * The cohort is recomputed whenever the session LIST changes — which is what happens when a
   * sitting finishes — so the view tracks the study as it is collected rather than being a snapshot
   * somebody has to remember to refresh. It gathers every session, so it is deliberately not run on
   * mount of every tab: `sessions` changing is the signal, and the work is skipped while it is empty.
   */
  useEffect(() => {
    if (sessions.length === 0) { setCohort(null); return; }
    let cancelled = false;
    setCohortBusy(true);
    (async () => {
      const bundles = [];
      for (const s of sessions) {
        // Without the blink records: the cohort view reads none of them (Round 81).
        const b = await gatherSession(s.session_id, { blinkRecords: false });
        if (cancelled) return;
        if (b) bundles.push(b);
      }
      const ds = buildAnalysisDataset(bundles);
      if (cancelled) return;
      setCohort(cohortSummary(ds.files, ds.integrity, N_CONDITIONS));
      setCohortBusy(false);
    })().catch(() => { if (!cancelled) setCohortBusy(false); });
    return () => { cancelled = true; };
  }, [sessions]);

  /*
   * `summaries` is FINISHED condition-runs only, and every figure on this page is drawn from it.
   *
   * It used to be every condition row, and a row exists from the moment a condition starts. So a
   * condition the operator had just PAUSED — which the Pause dialog says "will be restarted on
   * resume" — appeared here with its reading, comprehension, ratings and eye metrics, averaged into
   * every chart as a finished measurement. The investigator found it by pausing a sitting and opening
   * this dashboard. Filtering here, once, at the source, rather than at each of the thirty-odd uses
   * below, is what guarantees none of them can be missed; `unfinished` is shown separately, by name.
   */
  const allSummaries = useMemo(() => (bundle ? buildConditionSummaries(bundle) : []), [bundle]);
  const summaries = useMemo(() => allSummaries.filter((s) => s.condition_complete), [allSummaries]);
  const unfinished = useMemo(() => allSummaries.filter((s) => !s.condition_complete), [allSummaries]);
  const reliability = countReliability(summaries);
  const plannedConditions = bundle?.session.conditions_per_session ?? allSummaries.length;
  const baseline = bundle ? baselineFatigueMean(bundle) : null;
  const mediaCount = (bundle?.media ?? []).length;

  const onExport = async () => {
    if (!bundle) return;
    setExporting(true);
    try {
      let files;
      try {
        files = buildExportFiles(bundle);
      } catch (e) {
        if (!(e instanceof DamagedParticipantCodeError)) throw e;
        await offerBackupOnly(e);
        return;
      }
      await downloadExport(files);

      /*
       * Two different facts, recorded separately.
       *
       * exported_at says an export was ATTEMPTED. It cannot say more: downloadExport drives
       * `a.click()`, which returns void whether the file was written, blocked, cancelled or refused
       * for want of disk. Chrome also prompts before allowing multiple downloads from one origin,
       * and this writes ~20 files, so a refused prompt is an ordinary outcome.
       *
       * export_confirmed_at says the OPERATOR looked and the files are there. Only that releases a
       * session to the unattended thirty-day purge, because that purge destroys the only copy of
       * consented research data and must never rest on an assertion nothing verified.
       */
      const now = Date.now();
      /*
       * evenWhenFull: these two stamps are what releases a session to be purged, so refusing them on
       * a full device left the sitting exported but never confirmed, and purgeExpired holds an
       * unconfirmed session for ever — safe, and permanently un-freeable. The files themselves have
       * already left the device by this point; only the bookkeeping is at stake.
       */
      const fresh = await get('sessions', bundle.session.session_id);
      if (fresh) await put('sessions', { ...fresh, exported_at: now }, { evenWhenFull: true });

      const confirmed = await dialog.confirm({
        title: 'Did every file arrive?',
        body: `${files.length} files were sent to your downloads.\n\n`
          + 'Check the receiving computer NOW and confirm they all arrived.\n\n'
          + 'Until you confirm, this session is protected from automatic deletion.',
        confirmLabel: 'I have checked — the files are there',
        cancelLabel: 'Not yet, or some are missing',
        testId: 'export-confirm-dialog',
      });
      if (confirmed) {
        const again = await get('sessions', bundle.session.session_id);
        if (again) await put('sessions', { ...again, export_confirmed_at: Date.now() }, { evenWhenFull: true });
      }
    } finally { setExporting(false); }
  };

  /*
   * The data files are refused for a participant code the app could not have issued (Round 81). That
   * refusal used to surface only as the red "Something failed in the background" banner, and named a
   * backup file nothing had written. The operator is now told, in plain words, what happened and what
   * can still be done: the backup file keeps every record and is written on its own. The sitting is
   * not marked exported, so it stays protected from automatic deletion.
   */
  const offerBackupOnly = async (e: DamagedParticipantCodeError) => {
    if (!bundle) return;
    const save = await dialog.confirm({
      title: 'The data files were not written',
      body: `This sitting's participant code is ${e.codeLength} characters long. The app only gives codes of up to 20, `
        + 'so the record has been changed or damaged since it was made.\n\n'
        + 'You can still save the backup file. It keeps every measurement of this sitting. Send it to the '
        + 'investigator with a note of what happened.\n\n'
        + 'This sitting stays on the tablet and will not be deleted automatically.',
      confirmLabel: 'Save the backup file',
      cancelLabel: 'Close',
      testId: 'export-refused-dialog',
    });
    if (!save) return;
    const file = backupExportFile(bundle);
    await downloadExport([file]);
    await dialog.alert({
      title: 'Backup file sent to your downloads',
      body: `${file.filename}\n\nCheck that it arrived, then send it to the investigator.`,
      confirmLabel: 'Done',
    });
  };

  /**
   * The consented binaries, separately from the data bundle. Separate because it is a different
   * act: the CSVs are de-identified measurements, the media are photographs and video of a person,
   * and the operator should have to choose to put them on the machine rather than receive them as
   * a side effect of exporting data.
   */
  /**
   * The pooled analysis dataset: EVERY session on this device, not just the one open.
   *
   * Distinct from the bundle download above, and deliberately so. That one is a faithful record of
   * one sitting and is what gets archived per participant. This one asserts that the sittings
   * belong together — that a participant's two visits are the two halves of one crossover — and it
   * refuses to make that assertion silently: the join is checked first and its verdict travels on
   * every row and in two accompanying files.
   */
  const onExportAnalysis = async () => {
    setExporting(true);
    try {
      const sessions = await listSessions();
      // The pooled set carries no 07b/07c, so the blink records are not read (Round 81).
      const bundles = (await Promise.all(sessions.map((x) => gatherSession(x.session_id, { blinkRecords: false }))))
        .filter((b): b is SessionBundle => b != null);
      const dataset = buildAnalysisDataset(bundles);
      setAnalysisSummary(
        `${dataset.rowCount} rows · ${dataset.integrity.analysable_participants}/`
        + `${dataset.integrity.total_participants} participants analysable`
        + (dataset.integrity.clean ? '' : ` · ${dataset.integrity.issues.filter((i) => i.severity === 'blocking').length} blocking issue(s) — see analysis_join_issues.csv`),
      );
      await downloadExport(dataset.files);
    } finally { setExporting(false); }
  };

  const onExportMedia = async () => {
    if (!bundle) return;
    setExporting(true);
    try {
      const r = await downloadSessionMedia(bundle);
      const lost = r.missing.length
        ? `\n\n${r.missing.length} inventory row(s) no longer have their file on this device (this is expected after a restore from a backup, which carries the inventory but not the binary):\n  ${r.missing.join('\n  ')}`
        : '';
      /*
       * A refusal is not a failure and must not read as one. It means the participant withdrew that
       * grant, and the export honouring it is the system working — but the operator has to be told,
       * or they will look for files that are deliberately absent.
       */
      const held = r.refused.length
        ? `\n\n${r.refused.length} file(s) were NOT written because the grant covering them has been withdrawn. `
          + `They should have been destroyed at the point of withdrawal; if they are still on this device, `
          + `use the session's media revocation to remove them.\n  ${r.refused.join('\n  ')}`
        : '';
      await dialog.alert({ title: 'Media files written', body: `${r.written} media file(s) written.${lost}${held}`, confirmLabel: 'Done' });
    } finally { setExporting(false); }
  };

  /*
   * The dashboard SCROLLS, in its own container. It was min-h-screen with no scroll container inside a
   * root that is overflow:hidden, on a body that is touch-action:none — so everything below the first
   * screen was unreachable by any gesture: on the Data Quality / QC tab about two screens of charts,
   * the "Why rows were excluded" table and every per-condition QC row, and the lower parts of three
   * other tabs. e2e/dashboardTabs.spec.ts visits every tab at the shortest study viewport.
   *
   * ORGANISED, NOT CUT (Round 83). The investigator found the justifications and flags "multiple
   * paragraph-like texts". Every page now opens with a short "How to read this page"; each condition is
   * one headline and a row of chips; reasons, rules and numbers sit behind Details or More, and every
   * number that was on the page is still on it (the full tables, under "Every number, as tables").
   */
  return (
    <div data-testid="dashboard-scroll" className="screen scrollable nav-band w-full bg-cream font-sans text-[#1a1a2e]" style={{ padding: '0 3% 3%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="font-serif text-3xl font-light">Analysis Dashboard</h1>
          {/*
            Two builds can differ here, and both matter: the one drawing this page, and the one that
            RECORDED the sitting (provenance, plus any build that took over part-way through it).
            Round 74: the version alone never changed, so neither could be told apart from the tablet.
          */}
          <p className="font-sans text-[15px]" style={{ color: UI_TEXT.muted, marginTop: 4 }}>
            This app: <BuildIdentity testId="dashboard-build" style={{ fontSize: 15 }} />
            {bundle?.session.provenance && (
              <>
                <br />
                <span data-testid="dashboard-recorded-build">
                  This sitting recorded by:{' '}
                  <span className="font-lab">{buildIdentity(bundle.session.provenance.app_version, bundle.session.provenance.build_time, bundle.session.provenance.git_hash)}</span>
                  {(bundle.session.additional_builds ?? []).length > 0 && ` — and part of it by ${(bundle.session.additional_builds ?? []).join(', ')}`}
                </span>
              </>
            )}
          </p>
        </div>
        <select
          value={sessionId ?? ''}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ fontFamily: '"DM Mono", monospace', fontSize: 15, padding: '8px 12px', borderRadius: 8, border: '1px solid #bdb8ae', background: '#fff', color: UI_TEXT.ink }}
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
            className="font-sans text-base"
            style={{ padding: '10px 16px', borderRadius: 10, border: '1px solid #bdb8ae', cursor: 'pointer',
              background: tab === t.id ? UI_TEXT.ink : '#fff', color: tab === t.id ? '#fff' : UI_TEXT.body }}>
            {t.label}
          </button>
        ))}
      </div>

      <HowToRead lines={HOW_TO_READ[tab]} />

      {!bundle && tab !== 'cohort' && <p className="font-sans text-base leading-relaxed" style={{ color: UI_TEXT.muted }}>No session data found.</p>}

      {tab === 'cohort' && (
        // minmax(0, 1fr): a grid item's minimum is its content by default, so the wide table below
        // pushed this column, and every tile and paragraph in it, past the right edge of the screen.
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
          {cohortBusy && <p className="font-sans text-base leading-relaxed" style={{ color: UI_TEXT.muted }}>Pooling every session…</p>}
          {!cohortBusy && cohort == null && <p className="font-sans text-base leading-relaxed" style={{ color: UI_TEXT.muted }}>No sessions on this device yet.</p>}
          {cohort != null && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Stat label="Participants" value={String(cohort.participants)} />
                <Stat label="Analysable participants" value={`${cohort.analysable_participants}/${cohort.participants}`} />
                <Stat label="Condition-runs pooled" value={String(cohort.rows)} />
                <Stat
                  label="Confirmatory set (modelled)"
                  value={`${cohort.confirmatory.rows} runs`}
                  sub={`${cohort.confirmatory.participants} participant${cohort.confirmatory.participants === 1 ? '' : 's'}`}
                />
                <Stat
                  label="Smallest / largest condition n"
                  value={`${cohort.minConditionN} / ${cohort.maxConditionN}`}
                />
              </div>

              {cohort.maxConditionN - cohort.minConditionN > 1 && (
                <Notice tone="warn"
                  short={`One condition is behind the others by more than one participant (${cohort.minConditionN} against ${cohort.maxConditionN}).`}
                  more="With a counterbalanced design every condition should accrue at the same rate, so a gap usually means that condition is failing or being abandoned rather than simply lagging." />
              )}

              <div>
                <SectionTitle>Primary outcome by condition</SectionTitle>
                <div style={{ overflowX: 'auto' }}>
                  <table className="font-lab" style={{ fontSize: 13, borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: UI_TEXT.muted }}>
                        <th style={cohortHead}>Condition</th>
                        <th style={cohortHead}>Polarity</th>
                        <th style={cohortHead}>Colour</th>
                        <th style={cohortHead}>n</th>
                        <th style={cohortHead}>Analysable</th>
                        <th style={cohortHead}>With outcome</th>
                        <th style={cohortHead}>{MEASURE.incompleteRatio.name} (pooled)</th>
                        <th style={cohortHead}>{MEASURE.incompleteRatio.name} (mean of runs)</th>
                        <th style={cohortHead}>Blinks</th>
                        <th style={cohortHead}>Eye data: good, usable, not usable</th>
                        <th style={cohortHead}>{MEASURE.samplingRate.name} under {FPS_GATE.ADEQUATE}</th>
                        <th style={cohortHead}>{MEASURE.samplingRate.name} off usual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cohort.conditions.map((c) => (
                        <tr key={c.condition_label} style={{ borderTop: '1px solid #e8e4dc' }}>
                          <td style={cohortCell}>{c.condition_label}</td>
                          <td style={cohortCell}>{c.polarity}</td>
                          <td style={cohortCell}>{c.text_colour}</td>
                          <td style={cohortCell}>{c.n}</td>
                          <td style={cohortCell}>{c.n_analysable}</td>
                          <td style={{ ...cohortCell, color: c.n_with_outcome < c.n ? UI_TEXT.red : undefined }}>{c.n_with_outcome}</td>
                          <td style={cohortCell}>{c.pooled_ibr == null ? '—' : c.pooled_ibr.toFixed(3)}</td>
                          <td style={cohortCell}>{c.mean_ibr == null ? '—' : c.mean_ibr.toFixed(3)}</td>
                          <td style={cohortCell}>{c.blinks_total}</td>
                          {/* The verdicts of rule rel-r1, as the Data Quality tab gives them; a zero is in plain ink. */}
                          <td style={cohortCell} data-testid="cohort-reliability">
                            <span style={{ color: c.n_good ? UI_TEXT.green : undefined }}>✓ {c.n_good}</span>{' · '}
                            <span style={{ color: c.n_usable ? UI_TEXT.amber : undefined }}>! {c.n_usable}</span>{' · '}
                            <span style={{ color: c.n_not_usable ? UI_TEXT.red : undefined }}>✕ {c.n_not_usable}</span>
                          </td>
                          <td style={{ ...cohortCell, color: c.n_fps_inadequate > 0 ? UI_TEXT.amber : undefined }}>{c.n_fps_inadequate}</td>
                          <td style={{ ...cohortCell, color: c.n_fps_inconsistent > 0 ? UI_TEXT.amber : undefined }}>{c.n_fps_inconsistent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Notice
                  short="Blinks is what the ratio rests on: ten rows of four blinks is not ten measurements. Eye data counts the verdicts of the Data Quality tab: good, usable, not usable."
                  more={'“Pooled” is incomplete blinks over all blinks in those rows, the quantity the binomial model weights by; “mean of runs” counts every run once however few blinks it had, so the two differ when blink counts vary. “With outcome” below n means rows where no blink was counted at all; a condition where that is common is broken, not merely noisy. “Analysable”, the outcome columns and Eye data cover the confirmatory set only: analysable by the join check, not withdrawn, not a test session, first protocol pass — the rows both analysis templates model. '
                    + `Of its camera-on rows, ${cohort.qcChecks.flagged} of ${cohort.qcChecks.of} are flagged by a §5.3–5.4 check (face in view, head turned away, reading seen); the R template prints the same count.`} />
              </div>

              {cohort.exclusions.length > 0 && (
                <div>
                  <SectionTitle>Why rows were excluded</SectionTitle>
                  {cohort.exclusions.map((e) => (
                    <p key={e.reason} className="font-sans text-[15px]" style={{ color: UI_TEXT.muted }}>
                      {e.n}x — {e.reason}
                    </p>
                  ))}
                </div>
              )}

              {cohort.issues.length > 0 && (
                <div>
                  <SectionTitle>Join and provenance checks</SectionTitle>
                  {/*
                    Red for a BLOCKING issue, the join check's word for one that stops a participant
                    being analysed (storage/joinIntegrity.ts: 'blocking' | 'warning'). This list tested
                    for 'error', which the join check never writes, so a blocking issue was amber here.
                  */}
                  <p className="font-sans text-[15px]" style={{ color: cohort.issues.some((i) => i.severity === 'blocking') ? UI_TEXT.red : UI_TEXT.amber }}>
                    {countBySeverity(cohort.issues)}: {[...new Set(cohort.issues.map((i) => i.code))].join(', ')}
                  </p>
                  <More label="Show each check">
                    {cohort.issues.map((i, k) => (
                      <p key={`${i.code}-${k}`} className="font-sans text-[15px]" style={{ color: i.severity === 'blocking' ? UI_TEXT.red : UI_TEXT.amber, lineHeight: 1.5, marginTop: 4 }}>
                        [{i.severity}] {i.code} — {i.detail}
                      </p>
                    ))}
                  </More>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {bundle && bundle.session.withdrawn_at != null && (
        <div
          data-testid="withdrawn-banner"
          className="font-sans text-base"
          style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, border: '1px solid #b83a3a', background: '#fdeeee', color: '#5a1414', lineHeight: 1.55 }}
        >
          <strong>The participant withdrew</strong> — recorded {new Date(bundle.session.withdrawn_at).toLocaleString()}.
          Nothing on this page may be analysed.
          <More tone="#5a1414">
            The measurements are kept so the withdrawal is auditable, and every export of this sitting
            carries withdrawn = TRUE, which both analysis templates and the pooled export use to leave this
            participant out entirely.
          </More>
        </div>
      )}

      {bundle && unfinished.length > 0 && (
        <div
          data-testid="unfinished-conditions"
          className="font-sans text-base"
          style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, border: '1px solid #c98a22', background: '#fff6e5', color: '#5a3a00', lineHeight: 1.55 }}
        >
          <strong>
            {unfinished.length === 1 ? '1 condition was' : `${unfinished.length} conditions were`} started and did not finish
          </strong>{' '}
          — {unfinished.map((u) => `${u.condition_label} (position ${u.session_position + 1})`).join(', ')}.
          Left out of every figure on this page.
          <More tone="#5a3a00">
            Paused or interrupted part-way, so {unfinished.length === 1 ? 'it is' : 'they are'} not a measurement.
            {bundle.session.withdrawn_at == null && ' A paused condition restarts from the beginning when the sitting is resumed.'}
            {' '}The partial rows are kept in the export, flagged condition_complete = FALSE.
          </More>
        </div>
      )}

      {bundle && tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {/*
            Counted on completion, and only completion. condition_complete is set when the
            reaction-time block ends, whatever it scored — so a participant who stopped responding
            still ran the condition and it still counts, which is why this was once moved off
            mean_rt_hits_ms (null for a block with no valid hits). And a condition that was paused
            part-way does NOT count, which counting on hit_rate never distinguished from "started".
            The earlier note, kept for its reasoning: counted on hit_rate, not on mean_rt_hits_ms.
            mean_rt_hits_ms is null when there were no valid non-anticipatory hits — which is exactly
            what a participant who stopped responding to the go target produces. That condition RAN,
            and produced a damning result, and this tile called it "not completed": the operator reads
            9/10, concludes condition 7 never happened, and re-runs it. hit_rate is null only when the
            block contained no signal trials at all, and its own type comment makes that distinction:
            "a hit rate of zero is a real and damning measurement... not the same statement as 'this
            block contained no signal trials'".
          */}
          <Stat label="Conditions completed" value={`${summaries.length}/${plannedConditions}`} />
          <Stat label="Mean RT (hits)" value={fmt(avg(summaries.map((s) => s.mean_rt_hits_ms)), 'ms')} />
          <Stat label="Mean fatigue change from baseline" value={fmt(avg(summaries.map((s) => s.fatigue_delta)))} />
          {/*
            The ?? 0 used to sit INSIDE the multiplication, so a null average became 0 before fmt
            could render it as an em dash, and a sitting where comprehension was never administered
            displayed "0%" — which reads as "answered every question wrong" and is a strong signal to
            exclude or re-run. The aggregator goes out of its way to keep this null rather than 0
            (aggregate.ts: "never 0, which would read as 'attempted and got none right'"), and the
            display threw that guarantee away. Its two neighbours above were always correct.
          */}
          <Stat label="Comprehension accuracy" value={(() => {
            const acc = avg(summaries.map((s) => s.comprehension_correct));
            return acc == null ? fmt(null) : fmt(100 * acc, '%');
          })()} />
          {/* The reliability verdict (rule rel-r1), as the Data Quality tab and the export give it. */}
          <Stat label="Eye data good" testId="overview-eye-data"
            value={`${reliability.good}/${summaries.length}`}
            sub={`${reliability.usable} usable · ${reliability.not_usable} not usable`} />
          <Stat label="Engagement good" value={`${summaries.filter((s) => s.engagement === 'good').length}/${summaries.length}`}
            sub={`${summaries.filter((s) => s.engagement === 'warn').length} warn · ${summaries.filter((s) => s.engagement === 'bad').length} bad`} />
        </div>
      )}

      {bundle && tab === 'reaction' && (
        <Grid>
          <BarPanel title="Mean RT per condition" unit="ms" data={bar(summaries, 'mean_rt_hits_ms')} />
          <BarPanel title="d′ (sensitivity)" data={bar(summaries, 'd_prime')} color="#22c97a" />
          <BarPanel title="Hit rate" data={bar(summaries, 'hit_rate')} color="#4f8ef7" />
          <Caveat
            short="Each condition's d′ rests on about 20 go trials, so one bar is imprecise. The go dot is drawn in the condition's own colours, so misses partly reflect the display."
            more="Pure colour go/no-go (~20 go trials per condition). Per-condition d′ is small-N (SE often > 0.3), so for inference aggregate d′ across conditions per participant (see the R/Python templates). RT runs in the condition's own display: the go-dot is the condition's text colour on its background, so go-target visibility varies with condition by design (yellow on white is 2.39:1). Misses therefore partly reflect the display; only commission errors (tapping no-go dots) count toward the disengagement flag." />
        </Grid>
      )}

      {bundle && tab === 'fatigue' && (
        <Grid>
          <LinePanel title="Fatigue score, in the order the conditions ran" data={summaries.map((s) => ({ label: `${s.session_position + 1}:${s.condition_label}`, value: s.fatigue_mean }))} baseline={baseline ?? undefined} />
          <BarPanel title="Fatigue: change from baseline" data={bar(summaries, 'fatigue_delta')} color="#f5a623" />
          <BarPanel title="Eye strain" data={bar(summaries, 'eye_strain')} color="#e64c4c" />
          <BarPanel title="Dryness" data={bar(summaries, 'dryness')} color="#e07b39" />
          <SummaryTable
            headers={['Condition', 'Polarity', 'Fatigue score', 'Change from baseline', 'Eye strain', 'Dryness', 'Blur', 'Burning', 'Headache']}
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
            headers={['Condition', 'Contrast (WCAG)', 'Search time ms', 'Accuracy', 'Efficiency', 'False detections', 'Comfort', 'Clarity']}
            rows={summaries.map((s) => [s.condition_label, `${s.wcag_contrast_ratio}${s.below_wcag_aa ? ' ⚠' : ''}`, n(s.search_time_ms, 0), n(s.search_accuracy), n(s.search_efficiency), n(s.false_detections, 0), n(s.comfort_score, 0), n(s.clarity_score, 0)])}
          />
          <Caveat
            short="Contrast below 4.5:1 (WCAG AA) is marked ⚠ in the table; include contrast as a covariate."
            more="Visual-search target counts differ across passages (recorded per condition); passage↔condition decoupling makes this orthogonal to condition. WCAG ⚠ marks conditions below AA (4.5:1) — include contrast as a covariate." />
        </Grid>
      )}

      {bundle && tab === 'eye' && (
        <Grid>
          <EyeDataPanel summaries={summaries} />
          <BarPanel title={`${MEASURE.blinkRate.name} per condition`} unit="/min" data={eyeBar(summaries, 'blink_rate')} color="#4f8ef7" dimNote={EYE_DIM_NOTE} />
          <BarPanel title={`${MEASURE.incompleteRatio.name} (CVS marker)`} data={eyeBar(summaries, 'incomplete_blink_ratio')} color="#e07b39" dimNote={EYE_DIM_NOTE} />
          <BarPanel title={`${MEASURE.perclos.name} P80 (drowsiness)`} data={eyeBar(summaries, 'perclos_p80')} color="#e64c4c" dimNote={EYE_DIM_NOTE} />
          <BarPanel title="Engagement quality score" data={summaries.map((s) => ({ label: s.condition_label, value: s.quality_score, flag: s.engagement }))} />
          <Caveat
            short="The fatigue markers used here are a lower blink rate and a higher incomplete-blink ratio. PERCLOS tracks drowsiness, so a value near zero is normal in an awake reader."
            more="What these numbers mean. For visual fatigue (this study) the markers used are a LOWER blink rate and a HIGHER share of incomplete blinks (Portello, Rosenfield & Chu 2013), read with the first/second-half bins and the gap between blinks. PERCLOS counts time with the eyes mostly closed; it tracks drowsiness, so in an awake participant it is small and a value near zero is not a fault (PERCLOS: Dinges & Grace 1998, FHWA tech brief — metadata only, not yet read at source). Blink rate goes DOWN with concentrated reading and UP with sleepiness, so never read 'higher = more tired' on its own. Blink duration and the micro-blink count need 25 frames a second or more; the blink counts and the incomplete-blink ratio follow the eye sampling rate's tiers (adequate from 20). The on-screen ratio is a quality check of whether the participant looked at the tablet, and needs a passed gaze check. A webcam is a screening-grade measure; an infrared eye-tracker is the reference standard." />
          <div style={{ gridColumn: '1 / -1' }}>
            <More label="Every number, as tables" testId="eye-tables">
              <EyeTables summaries={summaries} />
            </More>
          </div>
        </Grid>
      )}

      {bundle && tab === 'export' && (
        <div style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 20, maxWidth: 720 }}>
          <p className="font-sans text-base leading-relaxed" style={{ color: UI_TEXT.muted }}>
            Downloads this sitting: its data tables, a codebook of every column, and a backup. Keep the{' '}
            <code>backup_*.json</code>: it restores this session if the tablet is lost.
          </p>
          <More>
            <p className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.muted }}>
              Exports 20 CSVs, an analysis JSON, a complete session backup, a master codebook
              documenting every column, and a provenance manifest (app version, git hash,
              condition-definition hash, per-file checksums). Analyse with the R / Python mixed-model
              templates in <code>src/analysis/</code>.
            </p>
          </More>
          <button onClick={onExport} disabled={exporting}
            className="mt-4 rounded-xl px-8 py-3 font-sans text-base font-medium text-white transition active:scale-95"
            style={{ background: UI_TEXT.ink, cursor: exporting ? 'wait' : 'pointer' }}>
            {exporting ? 'Exporting…' : 'Download data bundle ↓'}
          </button>

          {/* The analysis dataset pools every session on the device, so it is offered separately
              from the single-session bundle above and says plainly what it covers. */}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #e5e2dc' }}>
            <p className="font-sans text-base leading-relaxed" style={{ color: UI_TEXT.muted }}>
              The analysis dataset pools <strong>every session on this device</strong> into one long
              file, one row per participant × condition, with the join checked and its verdict on
              every row.
            </p>
            <button onClick={onExportAnalysis} disabled={exporting}
              className="mt-3 rounded-xl px-8 py-3 font-sans text-base font-medium transition active:scale-95"
              style={{ background: '#fff', color: UI_TEXT.ink, border: `1px solid ${UI_TEXT.ink}`, cursor: exporting ? 'wait' : 'pointer' }}>
              {exporting ? 'Building…' : 'Download analysis dataset ↓'}
            </button>
            {analysisSummary && (
              <p className="font-sans text-[15px]" style={{ marginTop: 10, color: UI_TEXT.muted }}>{analysisSummary}</p>
            )}
          </div>
          {mediaCount > 0 && (
            <>
              <p className="font-sans text-base leading-relaxed" style={{ marginTop: 18, color: UI_TEXT.muted }}>
                This session holds <strong>{mediaCount}</strong> consented photo/video file(s). They
                are not part of the data bundle. Each is written under the name given in{' '}
                <code>15_media_inventory.csv</code>. They contain identifiable images of the
                participant — store them under the terms of the grant that was given.
              </p>
              <button onClick={onExportMedia} disabled={exporting}
                className="mt-2 rounded-xl px-8 py-3 font-sans text-base font-medium transition active:scale-95"
                style={{ background: '#fff', border: '1px solid #d8d4cc', cursor: exporting ? 'wait' : 'pointer' }}>
                Download media files ↓
              </button>
            </>
          )}
          {bundle.session.status !== 'complete' && (
            <p className="font-sans text-base leading-relaxed" style={{ marginTop: 18, background: '#fff6e5', border: '1px solid #f0d8a8', borderRadius: 10, padding: 12 }}>
              This sitting has not finished. Exporting is allowed — a withdrawn or interrupted
              session is still a record of what happened — but the export carries
              <code> session_complete=false</code>, and {summaries.length} of the{' '}
              {plannedConditions} planned condition(s) finished. Do not pool it with completed
              sittings without accounting for that.
            </p>
          )}
        </div>
      )}
      {dialog.element}
      <ScrollCue />
    </div>
  );
}

// ---- small helpers ----

/**
 * What each tab is for and how to read it: a few short lines, the same box on every tab (parts.tsx
 * HowToRead). Written for the investigator, not for a programmer; the words for statuses and measures are
 * the researcher card's and the export's.
 */
const HOW_TO_READ: Record<Tab, string[]> = {
  overview: [
    'One tile per question about this sitting; the tabs above give the detail.',
    'Eye data good: reading conditions whose blink data passed every check. Data Quality / QC says why the others did not.',
    'A dash (—) means not measured. It is never a zero.',
  ],
  cohort: [
    'Every participant on this tablet, read from analysis_long.csv: the rows and numbers the analysis will use.',
    'The other tabs answer “did this sitting work?”; this one answers “is the study working?”.',
    'Look for a condition with fewer rows than the others, or many rows without blinks.',
  ],
  reaction: [
    'One bar per finished condition, in the order they ran (N: negative polarity, P: positive).',
    '“No data” under a chart lists the conditions with nothing measured.',
  ],
  fatigue: [
    'One bar per finished condition. The fatigue score is the mean of the five items (0–10); the line shows it in the order the conditions ran, against the baseline before the first (dashed).',
    'Change from baseline: above 0 is more fatigue than at the start.',
  ],
  search: [
    'One bar per finished condition, in the order they ran.',
    'The table gives every figure, with ⚠ on conditions below 4.5:1 contrast.',
  ],
  eye: [
    `Each reading condition gets one verdict for its blink data, from the analysis's own checks (rule ${RELIABILITY_RULE_VERSION}): ✓ Good, ! Usable or ✕ Not usable.`,
    'Good: every check passed. Usable: in the analysis; one pre-planned re-check leaves it out. Not usable: not in the eye-data analysis.',
    'Each column is one check: ✓ passed, ! flagged, ✕ failed, – not measured. Tap Details for the numbers and the rule.',
    'A note (few blinks, the light, a covered camera) never changes the verdict; nor does Engagement, which is about the participant.',
  ],
  export: [
    'Download data bundle: this sitting. Download analysis dataset: every sitting on this tablet, pooled.',
    'Check on the receiving computer that every file arrived before confirming.',
  ],
};

function SummaryTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div style={{ gridColumn: '1 / -1', overflowX: 'auto', background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: '"DM Mono", monospace', fontSize: 13 }}>
        <thead><tr>{headers.map((h) => <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: UI_TEXT.muted, borderBottom: '1px solid #e5e2dc', verticalAlign: 'bottom' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={cell}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function avg(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
function fmt(x: number | null, unit = ''): string {
  return x == null ? '—' : `${Math.round(x * 10) / 10}${unit}`;
}

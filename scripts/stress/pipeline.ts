/**
 * ROUND 2 - structural stress of the export pipeline.
 *
 * Round 1 attacked individual functions with hostile VALUES. This round attacks the pipeline with
 * hostile SHAPES: bundles that are empty, truncated, duplicated, orphaned, mismatched or enormous.
 * These are the states a real device reaches after a crash mid-condition, a partial resume, a
 * withdrawn participant, or a session that was interrupted between two stores being written.
 *
 * The pipeline passes a scenario when it either produces a structurally valid export, or fails
 * loudly. It FAILS when it produces an export that looks complete but silently misrepresents what
 * happened - a row count that implies data which is not there, a join that landed on the wrong
 * record, or a summary computed over records that do not correspond.
 */
import { buildExportFiles } from '../../src/storage/export';
import { buildFixtureBundle } from '../../src/sim/bundleFixture';
import { buildConditionSummaries } from '../../src/dashboard/aggregate';
import type { SessionBundle } from '../../src/storage/gather';

interface Result { scenario: string; status: 'OK' | 'THREW' | 'BROKEN'; detail: string }
const results: Result[] = [];

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Run one scenario and structurally validate whatever came out. */
/**
 * `damaged` states whether this scenario deliberately breaks referential integrity. A damaged
 * bundle MUST be flagged by the integrity audit; an undamaged one must not be. Passing structurally
 * while misreporting the data is the failure this round exists to catch.
 */
function scenario(name: string, mutate: (b: SessionBundle) => void,
                  opts: { damaged?: boolean; expect?: (files: { filename: string; content: string }[]) => string | null } = {}) {
  const expect = opts.expect;
  const b = buildFixtureBundle();
  try { mutate(b); } catch (e) { results.push({ scenario: name, status: 'THREW', detail: 'mutation threw: ' + (e as Error).message }); return; }
  let files;
  try {
    files = buildExportFiles(b);
  } catch (e) {
    results.push({ scenario: name, status: 'THREW', detail: (e as Error).message.slice(0, 150) });
    return;
  }
  const problems: string[] = [];
  for (const f of files) {
    if (!f.filename.endsWith('.csv')) continue;
    const rows = parseCsv(f.content);
    const n = rows[0]?.length ?? 0;
    const bad = rows.slice(1).filter((r) => r.length !== n);
    if (bad.length) problems.push(`${f.filename}: ${bad.length} misaligned row(s)`);
    if (/(^|[,\n"])(NaN|-?Infinity|undefined)([,\n"]|$)/.test(f.content)) problems.push(`${f.filename}: contains a non-finite/undefined literal`);
  }
  const manifest = files.find((f) => f.filename === 'export_manifest.json');
  if (manifest) {
    const m = JSON.parse(manifest.content);
    for (const entry of m.files) {
      const actual = files.find((f) => f.filename === entry.filename);
      if (!actual) problems.push(`manifest lists a file that was not emitted: ${entry.filename}`);
      else if (actual.content.length !== entry.bytes) problems.push(`manifest byte count wrong for ${entry.filename}`);
    }
    if (m.non_finite_cells > 0) problems.push(`non_finite_cells = ${m.non_finite_cells}`);
  }
  // Semantic gate: does the export TELL the analyst when its own joins are unsound?
  const manifest2 = files.find((f) => f.filename === 'export_manifest.json');
  if (manifest2) {
    const m = JSON.parse(manifest2.content);
    const sound = m.integrity?.joins_sound;
    if (opts.damaged && sound !== false) {
      problems.push('integrity audit did NOT flag a deliberately damaged bundle');
    }
    if (!opts.damaged && sound === false) {
      problems.push(`integrity audit flagged an undamaged bundle (${m.integrity.errors} errors)`);
    }
  } else {
    problems.push('no manifest emitted');
  }
  const extra = expect?.(files);
  if (extra) problems.push(extra);
  results.push({
    scenario: name,
    status: problems.length ? 'BROKEN' : 'OK',
    detail: problems.join('; ') || `${files.length} files`,
  });
}

const rowsOf = (files: { filename: string; content: string }[], name: string) => {
  const f = files.find((x) => x.filename === name);
  return f ? parseCsv(f.content).length - 1 : -1;
};

console.log('='.repeat(100));
console.log('ROUND 2 - STRUCTURAL PIPELINE STRESS');
console.log('='.repeat(100));

// ---- emptiness and truncation
scenario('no conditions at all (session abandoned during setup)', (b) => {
  b.conditions = []; b.eyeMetrics = []; b.rtSummaries = []; b.comprehension = [];
  b.visualSearch = []; b.perception = []; b.reactionTrials = [];
  b.fatigue = b.fatigue.filter((f) => f.stage === 'baseline');
  b.session.conditions_per_session = 0;
}, (f) => (rowsOf(f, '02_conditions.csv') === 0 ? null : 'conditions.csv should have 0 rows'));

scenario('one condition only, all stores consistent (crashed after the first)', (b) => {
  const keep = b.conditions[0].condition_id;
  b.conditions = b.conditions.slice(0, 1);
  b.eyeMetrics = b.eyeMetrics.filter((x) => x.condition_id === keep);
  b.rtSummaries = b.rtSummaries.filter((x) => x.condition_id === keep);
  b.comprehension = b.comprehension.filter((x) => x.condition_id === keep);
  b.visualSearch = b.visualSearch.filter((x) => x.condition_id === keep);
  b.perception = b.perception.filter((x) => x.condition_id === keep);
  b.fatigue = b.fatigue.filter((x) => x.stage === 'baseline' || x.condition_id === keep);
  b.session.conditions_per_session = 1;
});

scenario('crashed mid-condition: eye metrics written, ratings not yet', (b) => {
  const drop = b.conditions[b.conditions.length - 1].condition_id;
  b.comprehension = b.comprehension.filter((x) => x.condition_id !== drop);
  b.visualSearch = b.visualSearch.filter((x) => x.condition_id !== drop);
  b.perception = b.perception.filter((x) => x.condition_id !== drop);
}, { damaged: true });

scenario('conditions present but every child store empty (stores written out of order)', (b) => {
  b.eyeMetrics = []; b.rtSummaries = []; b.comprehension = [];
  b.visualSearch = []; b.perception = []; b.fatigue = [];
}, { damaged: true });

scenario('no participant record (profile never saved)', (b) => { b.participant = undefined; });
scenario('no calibration record', (b) => { b.calibration = []; });
scenario('no CVS-Q at all', (b) => { b.cvsq = []; });
scenario('no NASA-TLX', (b) => { b.tlx = []; });
scenario('no lux readings whatsoever', (b) => { b.session.lux_readings = []; });

// ---- referential damage
scenario('orphan eye metrics (condition_id points nowhere)', (b) => {
  b.eyeMetrics = b.eyeMetrics.map((e) => ({ ...e, condition_id: 'ghost-' + e.condition_id }));
}, { damaged: true });
scenario('duplicate condition_id across two conditions', (b) => {
  if (b.conditions.length > 1) b.conditions[1] = { ...b.conditions[1], condition_id: b.conditions[0].condition_id };
}, { damaged: true });
scenario('duplicate session_position', (b) => {
  if (b.conditions.length > 1) b.conditions[1] = { ...b.conditions[1], session_position: b.conditions[0].session_position };
}, { damaged: true });
scenario('passage_id out of range', (b) => {
  b.conditions = b.conditions.map((c) => ({ ...c, passage_id: 9999 }));
});
scenario('negative passage_id', (b) => {
  b.conditions = b.conditions.map((c) => ({ ...c, passage_id: -1 }));
});
scenario('two fatigue records for the same condition', (b) => {
  const post = b.fatigue.find((f) => f.stage === 'post_condition');
  if (post) b.fatigue.push({ ...post, fatigue_id: post.fatigue_id + '-dup' });
}, { damaged: true });

// ---- value damage that survives typing
scenario('reading_time_ms of zero everywhere', (b) => {
  b.conditions = b.conditions.map((c) => ({ ...c, reading_time_ms: 0 }));
});
scenario('reading_time_ms null everywhere', (b) => {
  b.conditions = b.conditions.map((c) => ({ ...c, reading_time_ms: null }));
});
scenario('session_end_time before session_start_time', (b) => {
  b.session.session_end_time = b.session.session_start_time - 60000;
});
scenario('session_end_time null (never completed)', (b) => { b.session.session_end_time = null; });
scenario('unknown illumination level (legacy record)', (b) => {
  (b.session as { ambient_illumination_level: unknown }).ambient_illumination_level = 'high';
});
scenario('null illumination level', (b) => {
  (b.session as { ambient_illumination_level: unknown }).ambient_illumination_level = null;
});
scenario('primary outcome null in every condition (camera refused)', (b) => {
  b.eyeMetrics = b.eyeMetrics.map((e) => ({ ...e, camera_active: false, incomplete_blink_ratio: null }));
});
scenario('d-prime unestimable in every block', (b) => {
  b.rtSummaries = b.rtSummaries.map((r) => ({ ...r, d_prime: null, criterion: null, d_prime_se: null, d_prime_estimable: false }));
});

// ---- scale
scenario('200 conditions, every store replicated (10x a real sitting)', (b) => {
  const base = b.conditions[0];
  b.conditions = Array.from({ length: 200 }, (_, i) => ({
    ...base, condition_id: 'c' + i, session_position: i, condition_label: 'X' + i,
  }));
  const e = b.eyeMetrics[0]; const r = b.rtSummaries[0]; const cm = b.comprehension[0];
  const vs = b.visualSearch[0]; const pe = b.perception[0]; const fa = b.fatigue[1];
  b.eyeMetrics = b.conditions.map((c) => ({ ...e, condition_id: c.condition_id }));
  b.rtSummaries = b.conditions.map((c) => ({ ...r, condition_id: c.condition_id }));
  // Three items per condition, matching what the instrument actually writes. Emitting one
  // would make this a malformed bundle rather than a large one, and the integrity audit
  // would correctly reject it.
  b.comprehension = b.conditions.flatMap((c, i) => [0, 1, 2].map((qi) => ({
    ...cm, comprehension_id: `k${i}-${qi}`, condition_id: c.condition_id,
    question_index: qi, question_kind: (['gist', 'inference', 'detail'] as const)[qi],
  })));
  b.visualSearch = b.conditions.map((c) => ({ ...vs, condition_id: c.condition_id }));
  b.perception = b.conditions.map((c, i) => ({ ...pe, perception_id: 'p' + i, condition_id: c.condition_id }));
  b.fatigue = [b.fatigue[0], ...b.conditions.map((c, i) => ({ ...fa, fatigue_id: 'f' + i, condition_id: c.condition_id }))];
}, { expect: (f) => (rowsOf(f, '02_conditions.csv') === 200 ? null : 'expected 200 condition rows') });

scenario('50,000 reaction trials', (b) => {
  const t = b.reactionTrials[0];
  b.reactionTrials = Array.from({ length: 50000 }, (_, i) => ({ ...t, trial_id: 't' + i, trial_number: i }));
}, (f) => (rowsOf(f, '08_reaction_trials.csv') === 50000 ? null : 'expected 50000 trial rows'));

scenario('participant id of 10,000 characters', (b) => {
  b.session.participant_id = 'x'.repeat(10000);
});
scenario('every free-text field is a CSV bomb', (b) => {
  const bomb = 'a,b"c\r\nd\te';
  b.session.display_label = bomb;
  b.session.lux_deviation_note = bomb;
  if (b.participant) b.participant.exclusion_reason = bomb;
  b.conditions = b.conditions.map((c, i) => ({ ...c, condition_label: bomb + i }));
});

// ---- aggregate layer directly
try {
  const b = buildFixtureBundle();
  b.eyeMetrics = []; b.rtSummaries = []; b.fatigue = []; b.perception = []; b.comprehension = [];
  const sums = buildConditionSummaries(b);
  const bad = sums.filter((s) => Object.values(s).some((v) => typeof v === 'number' && !Number.isFinite(v)));
  results.push({
    scenario: 'buildConditionSummaries with no child records',
    status: bad.length ? 'BROKEN' : 'OK',
    detail: bad.length ? `${bad.length} summaries carry a non-finite value` : `${sums.length} summaries, all finite`,
  });
} catch (e) {
  results.push({ scenario: 'buildConditionSummaries with no child records', status: 'THREW', detail: (e as Error).message.slice(0, 150) });
}

// ---------------------------------------------------------------- report
const w = Math.max(...results.map((r) => r.scenario.length));
let broken = 0;
for (const r of results) {
  if (r.status !== 'OK') broken++;
  console.log(`${r.status === 'OK' ? ' ok ' : r.status === 'THREW' ? 'THRW' : 'BREK'}  ${r.scenario.padEnd(w)}  ${r.detail}`);
}
console.log(`\n${results.length - broken}/${results.length} scenarios clean`);
process.exit(broken ? 1 : 0);

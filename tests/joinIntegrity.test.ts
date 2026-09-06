/**
 * Pooling sessions into one analysis dataset asserts things that can be false.
 *
 * A broken join does not produce an obviously broken graph. It produces an ordinary-looking graph
 * of an artefact, which is the most dangerous output this software could generate. Each case below
 * is a way the join can be wrong on a real device, and the check must catch it rather than
 * quietly producing a tidy file.
 */
import { describe, it, expect } from 'vitest';
import { checkJoin, groupByProvenance, unresolvedParticipantKey } from '@/storage/joinIntegrity';
import type { SessionBundle } from '@/storage/gather';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';

/*
 * The TWO-LEVEL expectation, retained alongside the dormant crossover machinery. The study now runs
 * a single illumination level and one sitting; these cases keep the crossover checks proven so that
 * restoring the second level restores something known to work. Current-protocol coverage — one
 * sitting of ten, and the split — is in the describe at the foot of this file, and was ABSENT: the
 * split case shipped marking every participant unanalysable and no test noticed.
 */
const EXPECT = { conditionsPerParticipant: 20, sittingsPerParticipant: 2, illuminationLevels: 2 };

/** What checkJoin is actually handed under the protocol this build runs. */
const NOW = { conditionsPerParticipant: 10, sittingsPerParticipant: 1, illuminationLevels: 1 };
/** ...and when the ten conditions are split across two sittings for scheduling. */
const SPLIT = { conditionsPerParticipant: 10, sittingsPerParticipant: 2, illuminationLevels: 1 };

/** The build stamp a real SessionRecord always carries; `provenance` is not optional on the type. */
const BUILD_A = {
  app_version: '2.1.0', git_hash: 'aaaa111', build_time: '2026-01-01T00:00:00Z',
  condition_def_hash: 'cond-hash-A', schema_version: 7,
};

/** A minimal bundle: only the fields the join check reads. */
function bundle(opts: {
  pid: string;
  sid: string;
  start: number;
  illumination: 'dim' | 'moderate' | null;
  conditions: string[];
  enrolment?: number;
  withParticipant?: boolean;
  /** Positions this sitting recorded. Defaults to a contiguous run from `offset`. */
  positions?: number[];
  offset?: number;
  /** The build that collected it; null to model a record carrying no stamp at all. */
  provenance?: Record<string, unknown> | null;
}): SessionBundle {
  const positions = opts.positions ?? opts.conditions.map((_, i) => (opts.offset ?? 0) + i);
  return {
    session: {
      session_id: opts.sid,
      participant_id: opts.pid,
      enrolment_number: opts.enrolment ?? 1,
      session_start_time: opts.start,
      ambient_illumination_level: opts.illumination,
      condition_offset: opts.offset ?? 0,
      provenance: opts.provenance === undefined ? BUILD_A : opts.provenance ?? undefined,
    },
    participant: opts.withParticipant === false
      ? undefined
      : { participant_id: opts.pid, enrolment_number: opts.enrolment ?? 1 },
    conditions: opts.conditions.map((label, i) => ({
      condition_id: `${opts.sid}-c${i}`, condition_label: label, session_position: positions[i],
    })),
  } as unknown as SessionBundle;
}

const tenA = ['P1', 'P2', 'P3', 'P4', 'P5', 'N1', 'N2', 'N3', 'N4', 'N5'];

/** A participant who did everything correctly. */
const complete = (pid: string, enrolment = 1) => [
  bundle({ pid, sid: `${pid}-s1`, start: 1000, illumination: 'dim', conditions: tenA, enrolment }),
  bundle({ pid, sid: `${pid}-s2`, start: 2000, illumination: 'moderate', conditions: tenA, enrolment }),
];

describe('a correct dataset passes cleanly', () => {
  it('marks a complete crossover analysable with no issues', () => {
    const r = checkJoin(complete('P01'), EXPECT);
    expect(r.clean).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.analysable_participants).toBe(1);
    expect(r.participants[0].condition_runs).toBe(20);
  });

  it('handles several participants at once', () => {
    const r = checkJoin([...complete('P01', 1), ...complete('P02', 2), ...complete('P03', 3)], EXPECT);
    expect(r.clean).toBe(true);
    expect(r.total_participants).toBe(3);
    expect(r.analysable_participants).toBe(3);
  });
});

describe('the ways a real join goes wrong', () => {
  it('catches a participant with only one sitting', () => {
    // The illumination factor is between-sittings, so one sitting carries no contrast at all.
    const r = checkJoin([complete('P01')[0]], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].analysable).toBe(false);
    expect(r.participants[0].excluded_by).toContain('incomplete_crossover');
  });

  it('catches both sittings run under the SAME illumination', () => {
    // The most dangerous case: the data look complete and the plot looks normal, but the
    // participant contributes two replicates of one cell rather than a contrast.
    const r = checkJoin([
      bundle({ pid: 'P01', sid: 'a', start: 1, illumination: 'dim', conditions: tenA }),
      bundle({ pid: 'P01', sid: 'b', start: 2, illumination: 'dim', conditions: tenA }),
    ], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].excluded_by).toContain('illumination_not_crossed');
  });

  it('catches a third sitting — a duplicate enrolment or a restarted sitting', () => {
    const r = checkJoin([...complete('P01'),
      bundle({ pid: 'P01', sid: 'x', start: 3000, illumination: 'dim', conditions: tenA })], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].excluded_by).toContain('too_many_sittings');
  });

  it('catches missing conditions', () => {
    const r = checkJoin([
      bundle({ pid: 'P01', sid: 'a', start: 1, illumination: 'dim', conditions: tenA.slice(0, 7) }),
      bundle({ pid: 'P01', sid: 'b', start: 2, illumination: 'moderate', conditions: tenA }),
    ], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].excluded_by).toContain('condition_coverage');
    expect(r.participants[0].condition_runs).toBe(17);
  });

  it('catches the same design cell measured twice', () => {
    // One condition repeated within a sitting: the model expects one observation per cell, and two
    // understate that cell's standard error.
    const r = checkJoin([
      bundle({ pid: 'P01', sid: 'a', start: 1, illumination: 'dim', conditions: [...tenA.slice(0, 9), 'P1'] }),
      bundle({ pid: 'P01', sid: 'b', start: 2, illumination: 'moderate', conditions: tenA }),
    ], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].excluded_by).toContain('duplicate_cell');
  });

  it('catches a missing illumination assignment', () => {
    const r = checkJoin([
      bundle({ pid: 'P01', sid: 'a', start: 1, illumination: null, conditions: tenA }),
      bundle({ pid: 'P01', sid: 'b', start: 2, illumination: 'moderate', conditions: tenA }),
    ], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].excluded_by).toContain('illumination_level_missing');
  });

  it('warns when two participants share an enrolment number', () => {
    // Enrolment drives the Williams row AND the illumination order, so a collision means those two
    // people received identical assignments instead of the balanced ones the design intends.
    const r = checkJoin([...complete('P01', 4), ...complete('P02', 4)], EXPECT);
    const collision = r.issues.find((i) => i.code === 'enrolment_collision');
    expect(collision).toBeDefined();
    expect(collision!.severity).toBe('warning');
    // A warning, so both participants remain analysable — the researcher decides.
    expect(r.analysable_participants).toBe(2);
  });

  it('warns, but does not exclude, when a participant record is missing', () => {
    const b = complete('P01');
    const r = checkJoin([
      { ...b[0], participant: undefined } as SessionBundle,
      b[1],
    ], EXPECT);
    expect(r.issues.some((i) => i.code === 'participant_record_missing')).toBe(true);
    expect(r.clean).toBe(true);
  });
});

describe('one participant going wrong does not contaminate the others', () => {
  it('isolates the broken participant', () => {
    const broken = [bundle({ pid: 'BAD', sid: 'z', start: 1, illumination: 'dim', conditions: tenA })];
    const r = checkJoin([...complete('P01', 1), ...broken, ...complete('P02', 2)], EXPECT);
    expect(r.total_participants).toBe(3);
    expect(r.analysable_participants).toBe(2);
    const bad = r.participants.find((p) => p.participant_id === 'BAD')!;
    expect(bad.analysable).toBe(false);
    for (const good of ['P01', 'P02']) {
      expect(r.participants.find((p) => p.participant_id === good)!.analysable).toBe(true);
    }
  });

  it('orders sittings by start time, not by storage order', () => {
    // `global_position` depends on this: the second sitting must continue the count, and storage
    // order is not run order.
    const [first, second] = complete('P01');
    const r = checkJoin([second, first], EXPECT);
    expect(r.participants[0].session_ids).toEqual(['P01-s1', 'P01-s2']);
  });
});

describe('the analysis codebook cannot drift from the dataset', () => {
  it('documents every exported column, and exports every documented one', async () => {
    // The per-session export has a gate enforcing this; without one here the analysis files would
    // be the only undocumented output, which is precisely the set someone reads six months later
    // with no memory of what the columns mean.
    const { ANALYSIS_LONG_COLUMNS } = await import('@/storage/analysisExport');
    const { ANALYSIS_CODEBOOK } = await import('@/storage/analysisCodebook');

    const exported = new Set<string>(ANALYSIS_LONG_COLUMNS);
    const documented = new Set(ANALYSIS_CODEBOOK.map((c) => c.column));

    const undocumented = [...exported].filter((c) => !documented.has(c));
    const orphaned = [...documented].filter((c) => !exported.has(c));

    expect(undocumented, `columns exported without a codebook entry: ${undocumented.join(', ')}`).toEqual([]);
    expect(orphaned, `codebook entries for columns that are not exported: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('gives every column a role, a missing-value meaning and a description', () => {
    for (const c of ANALYSIS_CODEBOOK) {
      expect(c.role, `${c.column} has no role`).toBeTruthy();
      expect(c.missing.length, `${c.column} does not say what an empty cell means`).toBeGreaterThan(3);
      expect(c.description.length, `${c.column} has no usable description`).toBeGreaterThan(20);
    }
  });

  it('marks the primary outcome and its two count components', () => {
    const primary = ANALYSIS_CODEBOOK.filter((c) => c.role === 'primary').map((c) => c.column);
    expect(primary).toContain('n_incomplete');
    expect(primary).toContain('n_blinks_total');
    expect(primary).toContain('incomplete_blink_ratio');
  });
});

describe('a withdrawal is honoured by the exporter itself, not just by its caller', () => {
  /*
   * listSessions() filters the recycle bin before the exporter sees anything, so no binned session
   * reaches it today. But that is the CALLER's guarantee. importSessionBackup deliberately clears
   * deleted_at — correct for the bin, catastrophic for a withdrawal — so restoring a backup after a
   * tablet is replaced, which the operator manual instructs, returned a withdrawn session
   * indistinguishable from a consented one. withdrawn_at is a separate tombstone, preserved across
   * import, and blocking here regardless of how the bundle arrived.
   */
  it('blocks a withdrawn sitting and says why', () => {
    const [a, b] = complete('P10');
    (a.session as unknown as Record<string, unknown>).withdrawn_at = Date.now();
    const r = checkJoin([a, b], EXPECT);
    expect(r.clean).toBe(false);
    expect(r.participants[0].analysable).toBe(false);
    expect(r.participants[0].excluded_by).toContain('participant_withdrawn');
    expect(r.issues.some((i) => i.code === 'participant_withdrawn' && i.severity === 'blocking')).toBe(true);
  });

  it('does not treat an ordinary recycle-bin tombstone as a withdrawal', () => {
    // The two meanings were conflated in one field; only one of them survives a restore, and only
    // one of them is a participant's instruction.
    const [a, b] = complete('P11');
    (a.session as unknown as Record<string, unknown>).deleted_at = Date.now();
    const r = checkJoin([a, b], EXPECT);
    expect(r.issues.some((i) => i.code === 'participant_withdrawn')).toBe(false);
  });

  it('leaves consented participants unaffected', () => {
    const [a, b] = complete('P12');
    (a.session as unknown as Record<string, unknown>).withdrawn_at = Date.now();
    const r = checkJoin([a, b, ...complete('P13', 2)], EXPECT);
    expect(r.participants.find((p) => p.participant_id === 'P13')!.analysable).toBe(true);
  });
});

describe('the protocol this build actually runs', () => {
  const ten = (i: number) => Array.from({ length: 10 }, (_, k) => `c${k}`).slice(i, i + 10);

  it('accepts one sitting of ten conditions with no issues', () => {
    const r = checkJoin([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate', conditions: ten(0),
    })], NOW);
    expect(r.participants[0].excluded_by).toEqual([]);
    expect(r.analysable_participants).toBe(1);
  });

  it('accepts a SPLIT sitting where both halves are the same level, which is by design', () => {
    /*
     * The regression this exists for. Under one illumination level both halves of a split are
     * 'moderate' necessarily, which tripped illumination_not_crossed and marked every split
     * participant unanalysable with a reason that had become false. The split is a live operator
     * control with its own end-to-end spec, so this was reachable, not theoretical.
     */
    const r = checkJoin([
      bundle({ pid: 'P2', sid: 'a', start: 1, illumination: 'moderate', conditions: ['c0', 'c1', 'c2', 'c3', 'c4'] }),
      bundle({ pid: 'P2', sid: 'b', start: 2, illumination: 'moderate', conditions: ['c5', 'c6', 'c7', 'c8', 'c9'] }),
    ], SPLIT);
    expect(r.participants[0].excluded_by).not.toContain('illumination_not_crossed');
    expect(r.participants[0].excluded_by).toEqual([]);
  });

  it('reports a missing half of a split WITHOUT invoking a crossover that does not exist', () => {
    const r = checkJoin([
      bundle({ pid: 'P3', sid: 'a', start: 1, illumination: 'moderate', conditions: ['c0', 'c1', 'c2', 'c3', 'c4'] }),
    ], SPLIT);
    expect(r.participants[0].excluded_by).toContain('incomplete_split_sitting');
    expect(r.participants[0].excluded_by).not.toContain('incomplete_crossover');
    const f = r.issues.find((x) => x.code === 'incomplete_split_sitting')!;
    expect(f.detail).toMatch(/Illumination is not involved/i);
  });
});

describe('a session with no participant id is placed, not dropped', () => {
  /*
   * It used to raise its issue and then `continue` past the participant map, so it appeared in no
   * row of analysis_join_report.csv while its rows were still written — and two such sessions
   * shared one empty grouping key. The exporter's own rule is that nothing is silently dropped and
   * nothing is silently merged; this was both, committed by the module that states the rule.
   */
  const orphan = (sid: string, start: number) =>
    bundle({ pid: '', sid, start, illumination: 'moderate', conditions: tenA });

  it('still raises the blocking issue', () => {
    const r = checkJoin([orphan('s1', 1)], NOW);
    const issue = r.issues.find((i) => i.code === 'session_without_participant')!;
    expect(issue.severity).toBe('blocking');
    expect(issue.session_id).toBe('s1');
  });

  it('now also gets a participant row, flagged, so the join report states its existence', () => {
    const r = checkJoin([orphan('s1', 1)], NOW);
    expect(r.total_participants).toBe(1);
    expect(r.analysable_participants).toBe(0);
    expect(r.participants[0].participant_id).toBe(unresolvedParticipantKey('s1'));
    expect(r.participants[0].excluded_by).toContain('session_without_participant');
    expect(r.participants[0].session_ids).toEqual(['s1']);
  });

  it('keeps two unattributable sessions apart instead of merging them into one person', () => {
    const r = checkJoin([orphan('s1', 1), orphan('s2', 2)], NOW);
    expect(r.total_participants).toBe(2);
    expect(r.participants.map((p) => p.participant_id).sort())
      .toEqual(['unresolved:s1', 'unresolved:s2']);
    // Each contributes its own ten runs; merged they would have looked like one 20-run crossover.
    expect(r.participants.every((p) => p.condition_runs === 10)).toBe(true);
  });

  it('names the sitting it stands for, without passing itself off as a participant id', () => {
    const r = checkJoin([orphan('sess-0001', 1)], NOW);
    const key = r.participants[0].participant_id;
    expect(key).toContain('sess-0001');
    expect(key).not.toBe('sess-0001');
  });
});

describe('a hole in a sitting changes what two exported columns mean', () => {
  /*
   * analysis_long.csv writes polarity_switched and predecessor_condition_label by looking for the
   * row at session_position - 1. Where a condition is missing, the row after the hole finds no
   * predecessor and both come out empty — and the codebook gives empty one meaning: 'first
   * condition of the sitting'. condition_coverage counts the missing rows; only this says where
   * they were, which is what decides whether an empty cell is a sitting boundary or a lie.
   */
  it('reports a hole in the middle of a sitting, naming the missing positions', () => {
    const r = checkJoin([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate',
      conditions: ['c0', 'c1', 'c2', 'c4', 'c5'], positions: [0, 1, 2, 4, 5],
    })], NOW);
    const gap = r.issues.find((i) => i.code === 'condition_position_gap')!;
    expect(gap).toBeTruthy();
    expect(gap.severity).toBe('warning');
    expect(gap.session_id).toBe('s1');
    expect(gap.detail).toContain('3');
    expect(gap.detail).toContain('polarity_switched');
  });

  it('reports a sitting whose own OPENING condition is missing', () => {
    // The row that then leads the sitting exports empty and is not the sitting's first condition
    // either, so measuring from the earliest row present would have missed this entirely.
    const r = checkJoin([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate',
      conditions: ['c1', 'c2'], positions: [1, 2], offset: 0,
    })], NOW);
    expect(r.issues.map((i) => i.code)).toContain('condition_position_gap');
  });

  it('stays silent on a contiguous sitting that starts partway through the protocol', () => {
    // The second half of a split runs positions 5-9. That row IS its sitting's first condition,
    // which is exactly what the codebook's empty cell means.
    const r = checkJoin([
      bundle({ pid: 'P2', sid: 'a', start: 1, illumination: 'moderate', conditions: ['c0', 'c1', 'c2', 'c3', 'c4'], offset: 0 }),
      bundle({ pid: 'P2', sid: 'b', start: 2, illumination: 'moderate', conditions: ['c5', 'c6', 'c7', 'c8', 'c9'], offset: 5 }),
    ], SPLIT);
    expect(r.issues.map((i) => i.code)).not.toContain('condition_position_gap');
    expect(r.participants[0].excluded_by).toEqual([]);
  });

  it('does not make the participant unanalysable by itself — it explains, it does not judge', () => {
    const r = checkJoin([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate',
      conditions: tenA.filter((_, i) => i !== 3), positions: [0, 1, 2, 4, 5, 6, 7, 8, 9],
    })], NOW);
    expect(r.participants[0].excluded_by).not.toContain('condition_position_gap');
    expect(r.participants[0].excluded_by).toContain('condition_coverage');
  });
});

describe('which build measured these rows', () => {
  const BUILD_B = {
    app_version: '3.0.0', git_hash: 'bbbb222', build_time: '2027-06-01T00:00:00Z',
    condition_def_hash: 'cond-hash-B', schema_version: 9,
  };

  it('groups sittings by their build stamp and lists the sessions under each', () => {
    const groups = groupByProvenance([
      ...complete('P01', 1),
      bundle({ pid: 'P02', sid: 'x', start: 3, illumination: 'moderate', conditions: tenA, enrolment: 2, provenance: BUILD_B }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.git_hash === 'aaaa111')!.session_ids).toEqual(['P01-s1', 'P01-s2']);
    expect(groups.find((g) => g.git_hash === 'bbbb222')!.session_ids).toEqual(['x']);
  });

  it('warns when the dataset pools rows collected by two different builds', () => {
    const r = checkJoin([
      ...complete('P01', 1),
      bundle({ pid: 'P02', sid: 'x', start: 3, illumination: 'dim', conditions: tenA, enrolment: 2, provenance: BUILD_B }),
      bundle({ pid: 'P02', sid: 'y', start: 4, illumination: 'moderate', conditions: tenA, enrolment: 2, provenance: BUILD_B }),
    ], EXPECT);
    const issue = r.issues.find((i) => i.code === 'mixed_build_provenance')!;
    expect(issue).toBeTruthy();
    expect(issue.detail).toContain('cond-hash-A');
    expect(issue.detail).toContain('cond-hash-B');
  });

  it('BLOCKS a participant whose own sittings span a rebuild', () => {
    // Their within-subject contrast would be taken across two instruments, which is not a
    // within-subject contrast of the display conditions at all — and no column would show it.
    const r = checkJoin([
      bundle({ pid: 'P1', sid: 'a', start: 1, illumination: 'dim', conditions: tenA }),
      bundle({ pid: 'P1', sid: 'b', start: 2, illumination: 'moderate', conditions: tenA, provenance: BUILD_B }),
    ], EXPECT);
    expect(r.participants[0].excluded_by).toContain('mixed_build_within_participant');
    expect(r.clean).toBe(false);
  });

  it('reports a sitting carrying no build stamp at all rather than assuming the current one', () => {
    const r = checkJoin([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate', conditions: tenA, provenance: null,
    })], NOW);
    const issue = r.issues.find((i) => i.code === 'build_provenance_missing')!;
    expect(issue).toBeTruthy();
    expect(issue.session_id).toBe('s1');
    expect(groupByProvenance([bundle({
      pid: 'P1', sid: 's1', start: 1, illumination: 'moderate', conditions: tenA, provenance: null,
    })])[0]).toMatchObject({ app_version: null, git_hash: null, condition_def_hash: null, schema_version: null });
  });

  it('says nothing when every sitting came from the same build', () => {
    const r = checkJoin(complete('P01'), EXPECT);
    expect(r.issues.map((i) => i.code)).not.toContain('mixed_build_provenance');
    expect(r.issues.map((i) => i.code)).not.toContain('build_provenance_missing');
  });
});

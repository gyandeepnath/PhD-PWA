/**
 * Pooling sessions into one analysis dataset asserts things that can be false.
 *
 * A broken join does not produce an obviously broken graph. It produces an ordinary-looking graph
 * of an artefact, which is the most dangerous output this software could generate. Each case below
 * is a way the join can be wrong on a real device, and the check must catch it rather than
 * quietly producing a tidy file.
 */
import { describe, it, expect } from 'vitest';
import { checkJoin } from '@/storage/joinIntegrity';
import type { SessionBundle } from '@/storage/gather';
import { ANALYSIS_CODEBOOK } from '@/storage/analysisCodebook';

const EXPECT = { conditionsPerParticipant: 20, sittingsPerParticipant: 2 };

/** A minimal bundle: only the fields the join check reads. */
function bundle(opts: {
  pid: string;
  sid: string;
  start: number;
  illumination: 'dim' | 'moderate' | null;
  conditions: string[];
  enrolment?: number;
  withParticipant?: boolean;
}): SessionBundle {
  return {
    session: {
      session_id: opts.sid,
      participant_id: opts.pid,
      enrolment_number: opts.enrolment ?? 1,
      session_start_time: opts.start,
      ambient_illumination_level: opts.illumination,
    },
    participant: opts.withParticipant === false
      ? undefined
      : { participant_id: opts.pid, enrolment_number: opts.enrolment ?? 1 },
    conditions: opts.conditions.map((label, i) => ({
      condition_id: `${opts.sid}-c${i}`, condition_label: label,
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

/**
 * Whether the sessions on this device can legitimately be pooled into one analysis dataset.
 *
 * WHY THIS RUNS BEFORE ANY POOLED FILE IS WRITTEN. The per-session export is a faithful record of
 * one sitting. The analysis dataset is a different object: it asserts that these rows belong
 * together, that a given participant's two sittings are the two halves of one crossover, and that
 * the design is balanced in the way the model will assume. Every one of those assertions can be
 * false on a real device — a participant enrolled twice under different IDs, a sitting abandoned
 * and restarted, both sittings accidentally run under the same lamp setting — and none of it is
 * visible in a plot. A broken join does not produce an obviously broken graph. It produces a
 * perfectly ordinary-looking graph of an artefact, which is the single most dangerous output this
 * software could generate.
 *
 * So the rule here is the same one the rest of this codebase follows for measurements: report the
 * problem, never paper over it. Nothing is silently dropped, nothing is silently merged, and the
 * dataset ships with a machine-readable statement of exactly which participants are complete,
 * which are not, and why.
 */
import type { SessionBundle } from './gather';
import type { Provenance } from './types';
import { N_ILLUMINATION_BLOCKS } from '@/experiment/illumination';
import type { IlluminationLevel } from '@/experiment/illumination';

/** One problem found while checking whether the sessions can be pooled. */
export interface JoinIssue {
  /** 'blocking' means the affected rows must not enter a confirmatory analysis as they stand. */
  severity: 'blocking' | 'warning';
  code: string;
  participant_id: string | null;
  session_id: string | null;
  detail: string;
}

export interface ParticipantJoin {
  participant_id: string;
  enrolment_number: number | null;
  /** Session ids contributing to this participant, in the order they were run. */
  session_ids: string[];
  /** Illumination level of each sitting, aligned with session_ids. */
  illumination_levels: (IlluminationLevel | null)[];
  /** Condition-runs actually present across all this participant's sittings. */
  condition_runs: number;
  /** True when the participant contributes a complete, analysable crossover. */
  analysable: boolean;
  /** Codes of the issues that made `analysable` false. Empty when it is true. */
  excluded_by: string[];
}

export interface JoinIntegrity {
  participants: ParticipantJoin[];
  issues: JoinIssue[];
  /** Participants whose rows may enter a confirmatory analysis unchanged. */
  analysable_participants: number;
  total_participants: number;
  /** True when no blocking issue was found anywhere. */
  clean: boolean;
}

/**
 * How many condition-runs a complete participant contributes.
 *
 * Passed in rather than imported so a split-session protocol or a reduced design can be checked
 * against its own expectation instead of a constant that quietly stopped being true.
 */
export interface JoinExpectation {
  conditionsPerParticipant: number;
  sittingsPerParticipant: number;
  /**
   * Illumination levels the data was collected under. Defaults to this build's count.
   *
   * Passed in rather than read from the module constant so that a pooled file containing EARLIER
   * two-level data is still checked as a crossover, and so the crossover checks stay reachable
   * under test while the protocol runs a single level. A dormant check whose tests were deleted
   * with its caller is not recoverable, only present.
   */
  illuminationLevels?: number;
}

/**
 * The grouping key given to a session that carries no participant id.
 *
 * Such a session used to be reported as an issue and then dropped out of the participant map
 * entirely, so it appeared in NO row of analysis_join_report.csv while its ten rows were still
 * written to analysis_long.csv with participant_id empty. Two of them therefore shared one empty
 * grouping key, and a mixed model reading participant_id as the random-intercept level would have
 * treated two different people as one person — the exact silent merge this module exists to
 * prevent, committed by the module itself. Keyed on the session id so every unattributable session
 * is its own grouping level and can be traced back to the sitting it stands for, and prefixed so
 * that the join report names it for what it is rather than passing it off as somebody's id.
 */
export function unresolvedParticipantKey(sessionId: string): string {
  return `unresolved:${sessionId}`;
}

/** The build that collected a sitting. Every field nullable: absence is reported, never filled in. */
export interface ProvenanceGroup {
  app_version: string | null;
  git_hash: string | null;
  condition_def_hash: string | null;
  schema_version: number | null;
  /** Sittings collected under this exact build, in the order they were passed in. */
  session_ids: string[];
}

/** Human-readable one-line form of a build stamp, for an issue detail or a log line. */
export function describeProvenance(g: ProvenanceGroup): string {
  return `${g.app_version ?? 'unknown version'} @ ${g.git_hash ?? 'unknown commit'}`
    + ` (conditions ${g.condition_def_hash ?? 'unknown'}, schema ${g.schema_version ?? 'unknown'})`;
}

/**
 * The distinct builds represented in a set of sittings, each with the sittings it collected.
 *
 * The tablets run for the length of a PhD and the build changes underneath them — a blink
 * threshold retuned, the condition table edited. Rows collected either side of that are not
 * interchangeable, and in a pooled file nothing about a row says which instrument measured it.
 * Grouping is done ONCE here and read by both the join check and the export manifest, so the two
 * cannot come to different conclusions about how many builds are in the file.
 */
export function groupByProvenance(bundles: SessionBundle[]): ProvenanceGroup[] {
  const groups = new Map<string, ProvenanceGroup>();
  for (const b of bundles) {
    // Typed as always present on SessionRecord, but a restored backup or a hand-edited record can
    // arrive without it. An unstamped sitting is reported as unstamped, not quietly given the
    // stamp of whichever build happens to be reading it.
    const p = b.session.provenance as Provenance | undefined;
    const g: Omit<ProvenanceGroup, 'session_ids'> = {
      app_version: p?.app_version ?? null,
      git_hash: p?.git_hash ?? null,
      condition_def_hash: p?.condition_def_hash ?? null,
      schema_version: typeof p?.schema_version === 'number' ? p.schema_version : null,
    };
    const key = JSON.stringify(g);
    (groups.get(key) ?? groups.set(key, { ...g, session_ids: [] }).get(key)!)
      .session_ids.push(b.session.session_id);
  }
  return [...groups.values()];
}

export function checkJoin(bundles: SessionBundle[], expect: JoinExpectation): JoinIntegrity {
  const issues: JoinIssue[] = [];
  const byParticipant = new Map<string, SessionBundle[]>();
  /** Grouping keys that stand in for a missing participant id; seeded as blocking below. */
  const unattributable = new Set<string>();

  for (const b of bundles) {
    const realPid = b.session.participant_id;
    // Never dropped, and never merged: an unattributable session gets a key of its own so it
    // reaches the participant loop, the join report and the long rows like any other.
    const pid = realPid || unresolvedParticipantKey(b.session.session_id);
    if (!realPid) {
      unattributable.add(pid);
      issues.push({
        severity: 'blocking', code: 'session_without_participant',
        participant_id: pid, session_id: b.session.session_id,
        detail: 'Session carries no participant id, so its rows cannot be attributed to anyone. It is '
          + `grouped under the synthetic key ${pid} so that it appears in the join report and cannot `
          + 'merge with another unattributable session; those rows must not enter any analysis.',
      });
    }
    /*
     * A withdrawn session must never reach an analysis, whatever the caller passed in.
     *
     * listSessions() filters the recycle bin before the exporter sees anything, so today no binned
     * session arrives here — but that is the CALLER's guarantee, and buildAnalysisDataset has no
     * guard of its own. A second caller, or a restored backup, would inherit the hazard silently.
     * The check belongs where the assertion is made.
     */
    if (b.session.withdrawn_at != null) {
      issues.push({
        severity: 'blocking', code: 'participant_withdrawn',
        participant_id: pid, session_id: b.session.session_id,
        detail: 'This session is marked withdrawn by the participant. Its rows must not enter any '
          + 'analysis. If it reached this exporter, a restore or a caller bypassed the recycle bin.',
      });
    }
    if (!b.participant) {
      issues.push({
        severity: 'warning', code: 'participant_record_missing',
        participant_id: pid, session_id: b.session.session_id,
        detail: 'No participant record found for this session; demographic covariates will be empty for its rows.',
      });
    }
    (byParticipant.get(pid) ?? byParticipant.set(pid, []).get(pid)!).push(b);
  }

  const participants: ParticipantJoin[] = [];

  for (const [pid, list] of byParticipant) {
    const ordered = [...list].sort((a, b) => a.session.session_start_time - b.session.session_start_time);
    // Seeded, not re-raised: the issue itself was already recorded when the session was read, and
    // this carries its code onto the participant row so `excluded_by` names the real reason instead
    // of the exporter's generic "not resolved" fallback.
    const excluded: string[] = unattributable.has(pid) ? ['session_without_participant'] : [];
    const add = (severity: JoinIssue['severity'], code: string, detail: string, sid: string | null = null) => {
      issues.push({ severity, code, participant_id: pid, session_id: sid, detail });
      if (severity === 'blocking') excluded.push(code);
    };

    if (ordered.some((b) => b.session.withdrawn_at != null)) {
      add('blocking', 'participant_withdrawn',
        'At least one sitting is marked withdrawn by the participant. The participant is excluded '
        + 'from the analysis dataset; their rows remain present and flagged so the exclusion is '
        + 'auditable rather than silent.');
    }

    const levels = ordered.map((b) => b.session.ambient_illumination_level ?? null);
    // How many illumination levels this data was collected under; see JoinExpectation.
    const nLevels = expect.illuminationLevels ?? N_ILLUMINATION_BLOCKS;
    const runs = ordered.reduce((n, b) => n + b.conditions.length, 0);

    // --- sitting count -------------------------------------------------------------------
    if (ordered.length < expect.sittingsPerParticipant) {
      /*
       * Two different shortfalls, and they must not share a message.
       *
       * Under the two-level protocol a missing sitting meant a missing illumination level, and the
       * text said so. Under the single-level protocol the only reason for more than one sitting is
       * that the ten conditions were SPLIT for scheduling, so a missing sitting is a missing half
       * of one block — nothing to do with illumination. The crossover wording was being emitted
       * verbatim for the split case, where every clause of it is false.
       */
      if (nLevels > 1) {
        add('blocking', 'incomplete_crossover',
          `Only ${ordered.length} of ${expect.sittingsPerParticipant} sittings present. The illumination factor is `
          + 'between-sittings, so a participant with one sitting contributes no within-participant '
          + 'illumination contrast and cannot enter the crossover analysis as a complete case.');
      } else {
        add('blocking', 'incomplete_split_sitting',
          `Only ${ordered.length} of ${expect.sittingsPerParticipant} sittings present. The ten conditions were `
          + 'split across sittings for scheduling and at least one half is missing, so this '
          + 'participant has an incomplete condition set. Illumination is not involved: it is a '
          + 'single level throughout.');
      }
    } else if (ordered.length > expect.sittingsPerParticipant) {
      add('blocking', 'too_many_sittings',
        `${ordered.length} sittings found where ${expect.sittingsPerParticipant} were expected. This is either a `
        + 'duplicate enrolment or an abandoned sitting that was restarted; which rows are the real '
        + 'ones is a decision for the researcher, not for this exporter.');
    }

    // --- the whole-plot factor must actually vary within the participant -----------------
    const known = levels.filter((l): l is IlluminationLevel => l != null);
    if (known.length !== levels.length) {
      add('blocking', 'illumination_level_missing',
        'At least one sitting has no assigned illumination level, so it cannot be placed on the '
        + 'whole-plot factor.');
    } else if (nLevels > 1
               && ordered.length === expect.sittingsPerParticipant
               && new Set(known).size !== known.length) {
      /*
       * Only meaningful while illumination has more than one level. Under the single-level protocol
       * a split participant has two sittings that are BOTH 'moderate' by design, which tripped this
       * check and marked every one of them unanalysable — with a reason that had become false.
       */
      add('blocking', 'illumination_not_crossed',
        `Both sittings ran under ${known[0]}. Illumination is the session-level independent variable; `
        + 'with only one of its levels this participant carries no illumination contrast at all, and '
        + 'pooling them would silently average two replicates of the same cell.');
    }

    // --- condition coverage --------------------------------------------------------------
    if (runs !== expect.conditionsPerParticipant) {
      add(runs < expect.conditionsPerParticipant ? 'blocking' : 'warning', 'condition_coverage',
        `${runs} condition-runs present, ${expect.conditionsPerParticipant} expected. `
        + (runs < expect.conditionsPerParticipant
          ? 'Missing cells make the within-participant design unbalanced; a mixed model tolerates this '
            + 'but the participant is no longer a complete case.'
          : 'More runs than the design defines — check for a repeated condition.'));
    }

    /*
     * --- holes in a sitting's run of positions ------------------------------------------
     *
     * WHY THIS IS NOT COVERED BY condition_coverage. That check counts rows; this one asks WHERE
     * the missing ones were, and the answer changes the meaning of two exported columns.
     *
     * analysis_long.csv writes `polarity_switched` and `predecessor_condition_label` by looking for
     * the row at session_position - 1. When a condition is abandoned after its row is written but
     * before it completes — or is never written at all — the row AFTER the hole finds no
     * predecessor and both columns come out empty. The codebook gives empty exactly one meaning:
     * 'first condition of the sitting'. So a row in the middle of a sitting reads as the sitting's
     * opening condition, and `polarity_switched` is the covariate for the doubled grey-field
     * adaptation and the polarity after-effect — the row either drops out of that adjustment or is
     * modelled at the wrong point in the sitting.
     *
     * Comparing across the hole instead would be worse: the participant DID see whatever ran at the
     * missing position, so the polarity of the row two places back is not the polarity they came
     * from. The columns stay empty, which is honest, and the ambiguity is resolved here rather than
     * silently — this is the row-level "why" that the empty cell cannot carry on its own.
     */
    for (const b of ordered) {
      const seen = new Set(
        b.conditions.map((c) => c.session_position).filter((p): p is number => Number.isFinite(p)),
      );
      if (seen.size === 0) continue;
      // Measured from the sitting's RECORDED starting position, not from the earliest row present,
      // so that a sitting whose own opening condition is the missing one is caught too: the row
      // that then leads the sitting exports empty and is not the sitting's first condition either.
      const offset = b.session.condition_offset;
      const first = Number.isFinite(offset) ? Math.min(offset, ...seen) : Math.min(...seen);
      const last = Math.max(...seen);
      const holes: number[] = [];
      for (let p = first; p < last; p++) if (!seen.has(p)) holes.push(p);
      if (holes.length > 0) {
        // The rows left ambiguous are the ones immediately after a hole; a hole's own successor can
        // itself be missing, and only positions actually present can carry an ambiguous cell.
        const affected = holes.map((h) => h + 1).filter((p) => seen.has(p));
        const many = holes.length > 1;
        add('warning', 'condition_position_gap',
          `Position${many ? 's' : ''} ${holes.join(', ')} of this sitting ${many ? 'have' : 'has'} no `
          + `condition row, in a sitting otherwise running ${first} to ${last}. `
          + `The row${affected.length > 1 ? 's' : ''} at position ${affected.join(', ')} therefore `
          + `export${affected.length > 1 ? '' : 's'} polarity_switched and predecessor_condition_label `
          + 'EMPTY, which the codebook defines as "first condition of the sitting". It is not: '
          + 'something preceded it and was not recorded. Do not read those empty cells as a sitting '
          + 'boundary, and do not carry those rows into a carryover or after-effect term.',
          b.session.session_id);
      }
    }

    // --- no cell measured twice ----------------------------------------------------------
    const cells = new Map<string, number>();
    for (const b of ordered) {
      const lvl = b.session.ambient_illumination_level ?? 'unknown';
      for (const c of b.conditions) {
        const key = `${lvl}|${c.condition_label ?? c.condition_id}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
    }
    const dupes = [...cells.entries()].filter(([, n]) => n > 1);
    if (dupes.length > 0) {
      add('blocking', 'duplicate_cell',
        `Repeated design cells: ${dupes.map(([k, n]) => `${k} x${n}`).join(', ')}. A repeated cell means `
        + 'the same participant contributes two observations where the model expects one, which '
        + 'understates that cell\'s standard error.');
    }

    /*
     * --- one participant, one instrument -------------------------------------------------
     *
     * A split participant's two sittings are days apart, and a build can be deployed to the tablet
     * between them. If the condition table or the scoring changed in that window, the participant's
     * within-subject contrast is taken across two different instruments — which is not a
     * within-subject contrast at all, and no column in the long file would show it. Blocking,
     * because it is the participant-level assertion this module exists to make.
     */
    const builds = groupByProvenance(ordered);
    if (builds.length > 1) {
      add('blocking', 'mixed_build_within_participant',
        `This participant's ${ordered.length} sittings were collected by ${builds.length} different builds: `
        + `${builds.map(describeProvenance).join(' | ')}. Their within-participant comparison spans a `
        + 'change to the instrument, so it is not a within-participant comparison of the display '
        + 'conditions alone. Which build is authoritative is a decision for the researcher.');
    }

    participants.push({
      participant_id: pid,
      enrolment_number: ordered[0]?.participant?.enrolment_number ?? ordered[0]?.session.enrolment_number ?? null,
      session_ids: ordered.map((b) => b.session.session_id),
      illumination_levels: levels,
      condition_runs: runs,
      analysable: excluded.length === 0,
      excluded_by: [...new Set(excluded)],
    });
  }

  // --- enrolment numbers drive counterbalancing, so collisions matter --------------------
  const byEnrolment = new Map<number, string[]>();
  for (const p of participants) {
    if (p.enrolment_number == null) continue;
    (byEnrolment.get(p.enrolment_number) ?? byEnrolment.set(p.enrolment_number, []).get(p.enrolment_number)!)
      .push(p.participant_id);
  }
  for (const [n, ids] of byEnrolment) {
    if (ids.length > 1) {
      issues.push({
        severity: 'warning', code: 'enrolment_collision',
        participant_id: ids.join(' & '), session_id: null,
        detail: `Enrolment number ${n} is shared by ${ids.length} participants. Enrolment drives the Williams `
          + 'row and the illumination order, so these participants received identical assignments '
          + 'rather than the balanced ones the design intends.',
      });
    }
  }

  /*
   * --- which instrument measured this dataset -------------------------------------------
   *
   * The pooled file is the one the thesis is modelled from, and it is built from whatever sessions
   * happen to be on the device. Over two years of collection that can span several builds, and
   * nothing in analysis_long.csv distinguishes them. It is not automatically wrong to pool across
   * builds — most changes touch nothing an analyst cares about — but it is never something the
   * analyst should have to discover. The manifest carries the same grouping with the session ids,
   * so a row can be attributed to its build through session_id.
   */
  const builds = groupByProvenance(bundles);
  const unstamped = builds.find((g) => g.app_version == null && g.git_hash == null && g.condition_def_hash == null);
  if (builds.length > 1) {
    issues.push({
      severity: 'warning', code: 'mixed_build_provenance',
      participant_id: null, session_id: null,
      detail: `${bundles.length} sittings were collected by ${builds.length} different builds: `
        + `${builds.map((g) => `${describeProvenance(g)} x${g.session_ids.length}`).join(' | ')}. `
        + 'analysis_long.csv has no column that separates them; analysis_manifest.json lists which '
        + 'session_ids belong to each build. Check whether anything that changed between them '
        + 'affects the outcome before pooling, and report the range in the write-up.',
    });
  }
  if (unstamped) {
    issues.push({
      severity: 'warning', code: 'build_provenance_missing',
      participant_id: null, session_id: unstamped.session_ids.join(';'),
      detail: `${unstamped.session_ids.length} sitting(s) carry no build stamp at all, so the instrument `
        + 'that produced them cannot be identified. Expected on a record restored from a backup '
        + 'written before provenance was captured; anything else means a record was hand-edited.',
    });
  }

  participants.sort((a, b) => (a.enrolment_number ?? 0) - (b.enrolment_number ?? 0)
    || a.participant_id.localeCompare(b.participant_id));

  return {
    participants,
    issues,
    analysable_participants: participants.filter((p) => p.analysable).length,
    total_participants: participants.length,
    clean: !issues.some((i) => i.severity === 'blocking'),
  };
}

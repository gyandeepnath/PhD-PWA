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

export function checkJoin(bundles: SessionBundle[], expect: JoinExpectation): JoinIntegrity {
  const issues: JoinIssue[] = [];
  const byParticipant = new Map<string, SessionBundle[]>();

  for (const b of bundles) {
    const pid = b.session.participant_id;
    if (!pid) {
      issues.push({
        severity: 'blocking', code: 'session_without_participant',
        participant_id: null, session_id: b.session.session_id,
        detail: 'Session carries no participant id, so its rows cannot be attributed to anyone.',
      });
      continue;
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
    const excluded: string[] = [];
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

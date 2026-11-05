/**
 * The build a sitting is recorded by, and the one comparison of two builds every part of the app makes.
 *
 * ONE PARTICIPANT, ONE BUILD (Round 88, audit 86 D10). The pooled export's join check blocks a
 * participant whose sittings were recorded by different builds (joinIntegrity.ts,
 * mixed_build_within_participant): their within-participant contrast would span a change to the
 * instrument. That is deliberate, and docs/DEPLOYMENT.md says to update "between participants, never
 * between the two sittings of one participant". But the rule lived only there. The operator manual
 * says to update at the start of each study day, the update notice offered "Update now" between the two
 * halves of a split participant, and the New Session form said nothing when a second half began under a
 * newer build — so a participant could be lost from every pre-registered model by following the
 * manual, and nobody would know until the export.
 *
 * So the comparison is made HERE, once, and read by the join check (which decides), the update notice
 * (which warns before the build changes) and the New Session form (which warns when it already has).
 * The three cannot disagree about what "a different build" means.
 */
import { APP_VERSION, BUILD_TIME, GIT_HASH } from '@/lib/env';
import { conditionDefinitionHash } from '@/experiment/conditions';
import { DB_VERSION } from './schemaEnums';
import type { Provenance } from './types';

/** The build this tablet is running now: what a sitting started now is stamped with. */
export function currentProvenance(): Provenance {
  return {
    app_version: APP_VERSION, git_hash: GIT_HASH, build_time: BUILD_TIME,
    condition_def_hash: conditionDefinitionHash(), schema_version: DB_VERSION,
  };
}

/**
 * The fields that make two sittings' builds the same instrument, as the join check compares them.
 * build_time is not one of them: the same commit built twice is the same build. Every field nullable:
 * an unstamped sitting (a restored backup, a hand-edited record) is reported as unstamped, never given
 * the stamp of whichever build is reading it.
 */
export interface BuildKey {
  app_version: string | null;
  git_hash: string | null;
  condition_def_hash: string | null;
  schema_version: number | null;
}

export function buildKey(p: Partial<Provenance> | null | undefined): BuildKey {
  return {
    app_version: p?.app_version ?? null,
    git_hash: p?.git_hash ?? null,
    condition_def_hash: p?.condition_def_hash ?? null,
    schema_version: typeof p?.schema_version === 'number' ? p.schema_version : null,
  };
}

/** Whether two sittings were recorded by the same build, by the join check's own rule. */
export function sameBuild(a: Partial<Provenance> | null | undefined, b: Partial<Provenance> | null | undefined): boolean {
  return JSON.stringify(buildKey(a)) === JSON.stringify(buildKey(b));
}

/** Human-readable one-line form of a build, for an issue detail or an operator message. */
export function describeBuild(k: BuildKey): string {
  return `${k.app_version ?? 'unknown version'} @ ${k.git_hash ?? 'unknown commit'}`
    + ` (conditions ${k.condition_def_hash ?? 'unknown'}, schema ${k.schema_version ?? 'unknown'})`;
}

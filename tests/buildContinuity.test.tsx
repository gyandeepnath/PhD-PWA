/**
 * One participant, one build — said to the operator where it can still be acted on (Round 88, audit 86
 * D10).
 *
 * The pooled export's join check blocks a participant whose sittings were recorded by different builds
 * (mixed_build_within_participant): their within-participant contrast would span a change to the
 * instrument. The rule lived only in docs/DEPLOYMENT.md. The operator manual said to update at the start
 * of each study day; the update notice, gated only on a sitting being OPEN, offered "Update now" between
 * the two halves of a split, because the first half is complete; and the New Session form said nothing
 * when the second half began under a newer build. In the audit's reproduction a split participant whose
 * second half differed only in git_hash came out analysable = FALSE, from every pre-registered model.
 *
 * The notice now names the participants between sittings and asks "Update anyway"; the form names the
 * earlier sitting's build; and both use the join check's own comparison (storage/buildStamp.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { put, _resetForTests } from '@/storage/db';
import { participantsBetweenSittings, priorParticipantProgress } from '@/storage/gather';
import { buildKey, currentProvenance, describeBuild, sameBuild } from '@/storage/buildStamp';
import { groupByProvenance } from '@/storage/joinIntegrity';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import type { IlluminationAssignment } from '@/start/setupStages';
import type { Provenance, SessionRecord } from '@/storage/types';

let waiting = true;
vi.mock('@/lib/swUpdate', () => ({
  onUpdateWaiting: (l: (w: boolean) => void) => { l(waiting); return () => {}; },
  isUpdateWaiting: () => waiting,
  checkForUpdate: async () => (waiting ? 'waiting' : 'current'),
  applyUpdate: async () => {},
  installUpdateWatch: async () => {},
  onOfflineCopy: (l: (s: { state: string; reason: string | null }) => void) => { l({ state: 'ready', reason: null }); return () => {}; },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLDER: Provenance = { ...currentProvenance(), app_version: '2.3.9', git_hash: 'older01', build_time: 'earlier' };

const sitting = (sid: string, pid: string, start: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  ...buildFixtureBundle().session, session_id: sid, participant_id: pid, enrolment_number: 3,
  status: 'complete', deleted_at: null, withdrawn_at: null, session_start_time: start, session_index: 1,
  conditions_per_session: 5, condition_offset: 0, resume_next_index: undefined, provenance: currentProvenance(), ...extra,
});

/** `n` finished displays in a sitting. */
async function finished(sid: string, n: number) {
  const base = buildFixtureBundle().conditions[0];
  for (let i = 0; i < n; i++) await put('conditions', { ...base, condition_id: `${sid}-c${i}`, session_id: sid, session_position: i, completed_at: 1000 + i });
}

describe('one comparison of two builds, the join check\'s', () => {
  it('the warnings call two sittings the same build exactly when the join check groups them together', () => {
    const now = currentProvenance();
    const variants: Provenance[] = [
      now,
      { ...now, build_time: 'rebuilt later' }, // the same commit built twice is the same build
      { ...now, git_hash: 'other00' },
      { ...now, app_version: '9.9.9' },
      { ...now, condition_def_hash: 'changed' },
      { ...now, schema_version: now.schema_version - 1 },
    ];
    for (const v of variants) {
      const a = buildFixtureBundle();
      const b = buildFixtureBundle();
      a.session = { ...a.session, session_id: 'A', provenance: now };
      b.session = { ...b.session, session_id: 'B', provenance: v };
      expect(sameBuild(now, v), JSON.stringify(v)).toBe(groupByProvenance([a, b]).length === 1);
    }
    expect(sameBuild(now, { ...now, build_time: 'x' })).toBe(true);
    expect(describeBuild(buildKey(OLDER))).toContain('2.3.9 @ older01');
  });
});

describe('the store: who is between sittings, and whose earlier sitting was another build', () => {
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); });

  it('lists a participant whose first half is done and second still to come — and no one else', async () => {
    await put('sessions', sitting('half', 'SPL1', 1000));
    await finished('half', 5);
    // Ten displays done over two sittings: finished.
    await put('sessions', sitting('full-a', 'DONE1', 1000));
    await put('sessions', sitting('full-b', 'DONE1', 2000, { session_index: 2, condition_offset: 5 }));
    await finished('full-a', 5);
    await finished('full-b', 5);
    // One sitting still open: the open-sitting gate refuses the update for it, outright.
    await put('sessions', sitting('open', 'OPEN1', 1000, { status: 'in_progress' }));
    await finished('open', 3);
    // Withdrawn: never coming back.
    await put('sessions', sitting('gone', 'GONE1', 1000, { withdrawn_at: 1500 }));
    await finished('gone', 5);
    // In the recycle bin: does not count.
    await put('sessions', sitting('binned', 'BIN1', 1000, { deleted_at: 1500 }));
    await finished('binned', 5);
    expect(await participantsBetweenSittings()).toEqual([{ participant_id: 'SPL1', conditions_completed: 5, sittings: 1 }]);
  });

  it('matches the participant regardless of letter case, as the export joins them (audit 86 F2)', async () => {
    await put('sessions', sitting('a', 'spl2', 1000));
    await put('sessions', sitting('b', 'SPL2', 2000, { session_index: 2, condition_offset: 5 }));
    await finished('a', 5);
    await finished('b', 2);
    expect(await participantsBetweenSittings()).toEqual([{ participant_id: 'SPL2', conditions_completed: 7, sittings: 2 }]);
  });

  it('names an earlier sitting recorded by another build, and none recorded by this one', async () => {
    await put('sessions', sitting('same', 'SAME1', 1000));
    await finished('same', 5);
    expect((await priorParticipantProgress('SAME1')).earlierBuilds).toEqual([]);
    await put('sessions', sitting('old', 'OLD1', 1000, { provenance: OLDER }));
    await finished('old', 5);
    const p = await priorParticipantProgress('old1');
    expect(p.earlierBuilds).toEqual([{ session_index: 1, started_at: 1000, build: describeBuild(buildKey(OLDER)) }]);
    // An unstamped sitting (a restored backup) is not quietly given this build's stamp.
    await put('sessions', sitting('bare', 'BARE1', 1000, { provenance: undefined as unknown as Provenance }));
    expect((await priorParticipantProgress('BARE1')).earlierBuilds[0]?.build).toMatch(/unknown version @ unknown commit/);
  });
});

describe('the update notice between the two sittings of a split', () => {
  const mounted: { root: Root; host: HTMLElement }[] = [];
  beforeEach(() => { globalThis.indexedDB = new IDBFactory(); _resetForTests(); waiting = true; });
  afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

  async function renderBanner(): Promise<HTMLElement> {
    const { UpdateBanner } = await import('@/components/UpdateBanner');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    await act(async () => { root.render(createElement(UpdateBanner)); });
    // The two database questions the notice asks on mount.
    for (let i = 0; i < 20 && !/Update (now|anyway)/.test(host.textContent ?? ''); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    return host;
  }
  const button = (host: HTMLElement) => [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');

  it('names the participant, says what an update now would do, and asks "Update anyway"', async () => {
    await put('sessions', sitting('half', 'SPL1', 1000));
    await finished('half', 5);
    const host = await renderBanner();
    const warn = host.querySelector('[data-testid="update-split-warning"]');
    expect(warn, 'no warning between the two sittings of a split').not.toBeNull();
    expect(warn!.textContent).toMatch(/SPL1 \(5 of 10 displays done\)/);
    expect(warn!.textContent).toMatch(/must be recorded by one build/);
    expect(warn!.textContent).toMatch(/leaves that participant out of every model/);
    expect(button(host)).toEqual(['Update anyway']);
  });

  it('says nothing more, and offers "Update now", when nobody is between sittings', async () => {
    await put('sessions', sitting('a', 'DONE1', 1000, { conditions_per_session: 10 }));
    await finished('a', 10);
    const host = await renderBanner();
    expect(host.querySelector('[data-testid="update-split-warning"]')).toBeNull();
    expect(button(host)).toEqual(['Update now']);
  });
});

describe('the New Session form, when the earlier sitting was another build', () => {
  const mounted: { root: Root; host: HTMLElement }[] = [];
  afterEach(() => { for (const { root, host } of mounted.splice(0)) { act(() => root.unmount()); host.remove(); } });

  async function renderForm(assignment: IlluminationAssignment): Promise<HTMLElement> {
    const { SessionInit } = await import('@/start/setupStages');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    await act(async () => { root.render(createElement(SessionInit, { onSubmit: () => {}, resolveAssignment: async () => assignment })); });
    const type = async (testId: string, value: string) => {
      const el = host.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('pid', 'SPL1');
    await type('lux', '300');
    return host;
  }
  const base: IlluminationAssignment = {
    level: 'moderate', block: 0, orderFirst: 'moderate', enrolment: 3, conditionsCompleted: 5, priorPasses: 0,
    sittings: 1, withdrawnAt: null, storedParticipantId: 'SPL1', spellings: ['SPL1'], openSittings: [],
  };

  it('names both builds and what the analysis will do, and does not refuse the sitting', async () => {
    const host = await renderForm({ ...base, earlierBuilds: [{ session_index: 1, started_at: 1000, build: describeBuild(buildKey(OLDER)) }] });
    const panel = host.querySelector('[data-testid="earlier-build"]');
    expect(panel, 'no warning that the earlier sitting was another build').not.toBeNull();
    expect(panel!.textContent).toMatch(/Sitting 1 \(.+\): 2\.3\.9 @ older01/);
    expect(panel!.textContent).toContain(`This tablet now runs: ${describeBuild(buildKey(currentProvenance()))}`);
    expect(panel!.textContent).toMatch(/leaves out a participant whose sittings were recorded by different builds/);
    expect(panel!.textContent).toMatch(/Tell the investigator/);
    // A warning, not a refusal: the build cannot be taken back.
    expect(host.querySelector('[data-testid="begin-blocked"]')?.textContent ?? '').not.toMatch(/cannot be started/);
  });

  it('says nothing when every earlier sitting was this build', async () => {
    const host = await renderForm({ ...base, earlierBuilds: [] });
    expect(host.querySelector('[data-testid="earlier-build"]')).toBeNull();
  });
});

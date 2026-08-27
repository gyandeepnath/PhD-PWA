/**
 * Redoing an interrupted condition, and the integrity checks that catch it when it goes wrong.
 *
 * Resume reuses the condition_id of an interrupted condition so that redoing it OVERWRITES its
 * rows. That works for stores keyed BY condition_id. Three per-condition stores are keyed by their
 * own uuid — comprehension_results, display_perception, fatigue_scores — so before
 * clearConditionRows a redo APPENDED a second attempt beside the first.
 *
 * For comprehension that is not cosmetic. The per-condition score is a proportion over the rows
 * present, so two attempts at a three-item passage give six rows and a score of 0.5 — a value
 * 00_CODEBOOK.csv states cannot occur, sitting in the analysis-ready wide summary looking entirely
 * plausible. These tests pin the replace semantics and then exercise the three integrity checks
 * that exist to catch the same shape of corruption arriving by any other route, which until now no
 * test or fuzz seed reached.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { put, getAllByIndex, clearConditionRows, _resetForTests } from '@/storage/db';
import { auditBundle } from '@/storage/integrity';
import { buildFixtureBundle } from '@/sim/bundleFixture';
import { buildConditionSummaries } from '@/dashboard/aggregate';
import { QUESTIONS_PER_PASSAGE } from '@/experiment/passages';
import type { ComprehensionRecord } from '@/storage/types';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetForTests();
});

const item = (n: number, qi: number, correct: boolean): ComprehensionRecord => ({
  comprehension_id: `c-${n}-${qi}`,
  session_id: 'S1',
  condition_id: 'COND-A',
  passage_id: 0,
  question_index: qi,
  question_kind: (['gist', 'inference', 'detail'] as const)[qi],
  selected_index: correct ? 1 : 0,
  correct_index: 1,
  is_correct: correct,
  response_time_ms: 4000,
});

describe('a redo replaces the previous attempt rather than sitting beside it', () => {
  it('leaves exactly one set of comprehension items after a second attempt', async () => {
    // First attempt: all three items, all correct.
    for (let qi = 0; qi < QUESTIONS_PER_PASSAGE; qi++) await put('comprehension_results', item(1, qi, true));
    expect(await getAllByIndex('comprehension_results', 'by_condition', 'COND-A')).toHaveLength(3);

    // The condition is interrupted after COMPREHENSION and redone. Fresh uuids, same condition_id.
    await clearConditionRows('comprehension_results', 'COND-A');
    for (let qi = 0; qi < QUESTIONS_PER_PASSAGE; qi++) await put('comprehension_results', item(2, qi, false));

    const rows = await getAllByIndex('comprehension_results', 'by_condition', 'COND-A');
    expect(rows).toHaveLength(QUESTIONS_PER_PASSAGE);
    // The surviving attempt must be the SECOND one; keeping the first would report a score the
    // participant did not achieve on the attempt that actually ran.
    expect(rows.every((r) => r.comprehension_id.startsWith('c-2-'))).toBe(true);
  });

  it('touches only the condition it was asked about', async () => {
    await put('comprehension_results', item(1, 0, true));
    await put('comprehension_results', { ...item(1, 1, true), condition_id: 'COND-B', comprehension_id: 'other' });

    await clearConditionRows('comprehension_results', 'COND-A');

    expect(await getAllByIndex('comprehension_results', 'by_condition', 'COND-A')).toHaveLength(0);
    expect(await getAllByIndex('comprehension_results', 'by_condition', 'COND-B')).toHaveLength(1);
  });

  it('is safe to call for a condition that has no rows yet', async () => {
    await expect(clearConditionRows('comprehension_results', 'NEVER-WRITTEN')).resolves.toBeUndefined();
  });

  it('applies to the other two uuid-keyed per-condition stores', async () => {
    await put('display_perception', {
      perception_id: 'p1', session_id: 'S1', condition_id: 'COND-A', display_comfort_score: 70,
      text_clarity_score: 80, comfort_touched: true, clarity_touched: true, response_time_ms: 5000,
    });
    await clearConditionRows('display_perception', 'COND-A');
    expect(await getAllByIndex('display_perception', 'by_condition', 'COND-A')).toHaveLength(0);
  });
});

describe('the integrity audit catches a duplicated attempt however it arrives', () => {
  /** A bundle whose first condition carries two attempts at the same three items. */
  const doubled = () => {
    const b = buildFixtureBundle();
    const target = b.conditions[0].condition_id;
    const first = b.comprehension.filter((c) => c.condition_id === target);
    expect(first).toHaveLength(QUESTIONS_PER_PASSAGE);
    b.comprehension = [
      ...b.comprehension,
      ...first.map((c) => ({ ...c, comprehension_id: `${c.comprehension_id}-redo` })),
    ];
    return { bundle: b, target };
  };

  it('reports the wrong item count and the duplicated indices', () => {
    const { bundle, target } = doubled();
    const audit = auditBundle(bundle);
    const checks = audit.findings.map((f) => f.check);
    expect(checks).toContain('comprehension_item_count');
    expect(checks).toContain('comprehension_item_unique');
    expect(audit.errors).toBeGreaterThan(0);
    expect(audit.findings.some((f) => f.refs.includes(target))).toBe(true);
  });

  it('flags a condition that lost an item, which no other check would notice', () => {
    // The dangerous direction: the proportion is simply computed over a smaller denominator and
    // looks like a valid score.
    const b = buildFixtureBundle();
    const target = b.conditions[0].condition_id;
    const idx = b.comprehension.findIndex((c) => c.condition_id === target);
    b.comprehension.splice(idx, 1);

    const audit = auditBundle(b);
    expect(audit.findings.map((f) => f.check)).toContain('comprehension_item_count');

    // And confirm the aggregate really would have produced a plausible-looking number.
    const summary = buildConditionSummaries(b).find((s) => s.condition_id === target)!;
    expect(summary.comprehension_correct).not.toBeNull();
    expect(summary.comprehension_correct).toBeGreaterThanOrEqual(0);
    expect(summary.comprehension_correct).toBeLessThanOrEqual(1);
  });

  it('flags an item index outside the range the passage defines', () => {
    const b = buildFixtureBundle();
    const target = b.conditions[0].condition_id;
    const row = b.comprehension.find((c) => c.condition_id === target)!;
    row.question_index = QUESTIONS_PER_PASSAGE + 4;

    const audit = auditBundle(b);
    expect(audit.findings.map((f) => f.check)).toContain('comprehension_item_range');
  });

  it('passes an undamaged bundle, so the checks are not merely always-on', () => {
    const audit = auditBundle(buildFixtureBundle());
    const comp = audit.findings.filter((f) => f.check.startsWith('comprehension_item'));
    expect(comp).toHaveLength(0);
  });
});

describe('a duplicated attempt produces a score the codebook says cannot exist', () => {
  it('yields 0.5 over six rows, which is why the replace semantics matter', () => {
    const b = buildFixtureBundle();
    const target = b.conditions[0].condition_id;
    b.comprehension = b.comprehension.filter((c) => c.condition_id !== target);
    // Attempt one: all correct. Attempt two: all wrong. Six rows, proportion 0.5.
    for (let qi = 0; qi < QUESTIONS_PER_PASSAGE; qi++) {
      b.comprehension.push({ ...item(1, qi, true), condition_id: target, session_id: b.session.session_id });
      b.comprehension.push({ ...item(2, qi, false), condition_id: target, session_id: b.session.session_id });
    }
    const summary = buildConditionSummaries(b).find((s) => s.condition_id === target)!;
    expect(summary.comprehension_correct).toBe(0.5);
    // 0.5 is not a multiple of 1/3, so it cannot arise from a single well-formed attempt.
    const valid = [0, 1 / 3, 2 / 3, 1];
    expect(valid.some((v) => Math.abs(v - (summary.comprehension_correct ?? -1)) < 1e-9)).toBe(false);
  });
});

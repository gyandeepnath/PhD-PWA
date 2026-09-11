/**
 * Every citation must resolve, and every reference must be cited.
 *
 * The standing rule on this project is absolute: "Every citation must resolve to an item in the
 * research library or be explicitly marked as externally discovered and awaiting verification."
 * Nothing enforced it, and a violation survived several passes of review — the synopsis carried
 * `(Advanced Perceptual Contrast Algorithm, n.d.; World Wide Web Consortium, 2023)` where the first
 * of those had no reference-list entry, no entry in the verification ledger, and, worse, argued the
 * opposite of the sentence citing it: APCA is the polarity-AWARE candidate algorithm, cited in
 * support of the claim that the prevailing standard is polarity-blind. The reference entry had
 * existed in an older draft and was lost when the list was rebuilt; the in-text citation stayed.
 *
 * Both directions are checked, because each catches a different accident:
 *   - a citation with no reference is a claim attributed to nothing
 *   - a reference with no citation is a padded bibliography, which is what an examiner scanning for
 *     provenance problems looks for first
 *
 * The same two checks run against the presentation, whose reference slides are headed "Sources
 * cited in this presentation" and so make the stronger promise of the two.
 */
import { describe, it, expect } from 'vitest';
import { CVSQ_CUTOFF, scoreCvsq } from '@/scales/cvsq';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SYNOPSIS = readFileSync(join(ROOT, 'synopsis', 'SYNOPSIS_AdtU.md'), 'utf8');
const LEDGER = readFileSync(join(ROOT, 'docs', 'CITATION_VERIFICATION.md'), 'utf8');

/** Body text and reference block, split at the REFERENCES heading. */
function split(md: string) {
  const at = md.search(/^# REFERENCES\s*$/m);
  expect(at, 'the synopsis has no REFERENCES heading').toBeGreaterThan(0);
  return { body: md.slice(0, at), refs: md.slice(at) };
}

/**
 * The surname a reference is alphabetised under. Corporate authors ("World Wide Web Consortium")
 * have no comma before their first initial, so they are taken whole.
 */
function referenceKeys(refBlock: string): string[] {
  return refBlock.split('\n')
    .filter((l) => /^[A-ZÀ-Þ]/.test(l) && /\((?:\d{4}|n\.d\.)/.test(l))
    .map((l) => {
      const m = /^([^,(]+(?:,\s*[A-ZÀ-Þ]\.)?)/.exec(l);
      const head = (m ? m[1] : l).trim().replace(/,\s*[A-ZÀ-Þ].*$/, '').replace(/\.$/, '').trim();
      // A work is identified by author AND year: Piepenbrock 2014a and 2014b are two references,
      // as are Buchner 2007 and 2009 and Dobres 2016 and 2017.
      const year = /\((\d{4}[a-z]?|n\.d\.)/.exec(l);
      return `${head}|${year ? year[1] : '?'}`;
    })
    .filter(Boolean);
}

/**
 * Author tokens used in in-text citations. Deliberately narrow: a capitalised, possibly accented
 * or hyphenated surname immediately preceding `et al.`, `and colleagues`, `&`, or a year. Anything
 * it cannot parse confidently is skipped rather than guessed at, so this raises no false alarms.
 */
function citedNames(body: string): Set<string> {
  const text = body.replace(/\*/g, '');
  const out = new Set<string>();
  const NAME = "[A-ZÀ-Þ][\\wÀ-ÿ'’-]+(?:-[A-ZÀ-Þ][\\wÀ-ÿ'’-]+)?";
  /*
   * A corporate author is several capitalised words, not one. The first version of this test missed
   * the very citation it was written for — `(Advanced Perceptual Contrast Algorithm, n.d.)` — because
   * NAME stopped at "Advanced" and then found no year. A guard that cannot catch its own regression
   * is worse than no guard, so parenthetical citations are matched with a multi-word form.
   */
  const MULTI = "[A-ZÀ-Þ][\\wÀ-ÿ'’-]+(?:[ ][A-ZÀ-Þ][\\wÀ-ÿ'’-]+){0,4}";

  // (Surname et al., 2024) · (Surname & Other, 2007) · (Surname, 2018) · (Lin, M., et al., 2025)
  for (const m of text.matchAll(new RegExp(`\\((${MULTI})(?:,\\s*[A-ZÀ-Þ]\\.)?(?:\\s+(?:et al\\.|&\\s+${NAME}))?,\\s*(?:\\d{4}|n\\.d\\.)`, 'g'))) {
    out.add(m[1]);
  }
  // ; Surname et al., 2022  — second and later works inside one parenthetical
  for (const m of text.matchAll(new RegExp(`;\\s*(${MULTI})(?:,\\s*[A-ZÀ-Þ]\\.)?(?:\\s+(?:et al\\.|&\\s+${NAME}))?,\\s*(?:\\d{4}|n\\.d\\.)`, 'g'))) {
    out.add(m[1]);
  }
  // Narrative: Surname et al. (2020) · Surname and Other (2007) · Surname and colleagues (2024)
  for (const m of text.matchAll(new RegExp(`(${NAME})(?:\\s+(?:et al\\.|and colleagues|and\\s+${NAME}))?\\s*\\((?:\\d{4}|n\\.d\\.)`, 'g'))) {
    out.add(m[1]);
  }
  return out;
}

/** Corporate and multi-word authors whose first token is not the whole key. */
const CORPORATE: Record<string, string> = { World: 'World Wide Web Consortium' };
const canonical = (n: string) => CORPORATE[n] ?? n;

describe('the synopsis', () => {
  const { body, refs } = split(SYNOPSIS);
  const keys = referenceKeys(refs);

  const surnames = keys.map((k) => k.split('|')[0]);

  it('has a reference list at all, with no work listed twice', () => {
    expect(keys.length, 'no reference entries were parsed').toBeGreaterThan(30);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i), 'a work is listed twice').toEqual([]);
  });

  it('resolves every in-text citation to a reference-list entry', () => {
    /*
     * The regression this file exists for. `(Advanced Perceptual Contrast Algorithm, n.d.)` cited a
     * work the reference list did not contain, so the claim it supported was attributed to nothing.
     */
    const dangling = [...citedNames(body)]
      .map(canonical)
      .filter((n) => !surnames.some((k) => k === n || k.startsWith(n) || n.startsWith(k)));
    expect(dangling.sort(), 'an in-text citation has no reference-list entry').toEqual([]);
  });

  it('cites every work in the reference list at least once', () => {
    const body_ = body.replace(/\*/g, '');
    const orphans = surnames.filter((k) => !body_.includes(k.split(',')[0].split(' ')[0]));
    expect(orphans, 'a reference is listed but never cited — a padded bibliography').toEqual([]);
  });

  it('has a verification-ledger entry for every reference', () => {
    // The ledger is the project's record that a citation was checked. A reference absent from it
    // has never been verified, whatever the reference list says.
    const missing = surnames.filter((k) => !LEDGER.includes(k.split(',')[0].split(' ')[0]));
    expect(missing, 'a reference has no status in docs/CITATION_VERIFICATION.md').toEqual([]);
  });
});

describe('the presentation', () => {
  const deckSrc = readFileSync(join(ROOT, 'synopsis', 'build_pptx.cjs'), 'utf8');

  /** The deck's reference list is a literal array in the builder. */
  function deckRefs(): string[] {
    const block = /const REFS = \[([\s\S]*?)\n\]/.exec(deckSrc);
    expect(block, 'the deck has no REFS array').not.toBeNull();
    return [...block![1].matchAll(/^\s*'((?:[^'\\]|\\.)*)',?\s*$/gm)].map((m) => m[1].replace(/\\'/g, "'"));
  }

  it('cites on a slide every work it lists as a reference', () => {
    /*
     * The reference slides are headed "Sources cited in this presentation". Sethi & Ziat (2023) and
     * Soukupová & Čech (2016) were listed there and cited on no slide — and the second of those is
     * the work that licenses the deck's own eye-aspect-ratio method, so the citation was missing
     * from the place it was actually needed.
     */
    const refs = deckRefs();
    expect(refs.length, 'no references were parsed out of the deck').toBeGreaterThan(20);

    // Slide content is everything in the builder outside the REFS array.
    const slides = deckSrc.replace(/const REFS = \[[\s\S]*?\n\]/, '');
    const orphans = refs
      .map((r) => /^([^,(]+)/.exec(r)![1].trim().replace(/\.$/, ''))
      .filter((surname) => !slides.includes(surname));
    expect(orphans, 'the deck lists a reference it never cites').toEqual([]);
  });

  it('matches the synopsis, entry for entry, on every work it shares with it', () => {
    /*
     * Two bibliographies in one submission disagreeing on the same work is the kind of thing an
     * examiner notices. The deck abbreviated Ccami-Bernal's ten authors with an ellipsis — which
     * APA reserves for twenty-one or more — while the synopsis listed all ten.
     */
    const { refs: synRefs } = split(SYNOPSIS);
    const normalise = (s: string) => s.replace(/\*/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    const synopsisByKey = new Map<string, string>();
    for (const line of synRefs.split('\n')) {
      if (!/^[A-ZÀ-Þ]/.test(line) || !/\((?:\d{4}|n\.d\.)/.test(line)) continue;
      const n = normalise(line);
      const year = /\((\d{4}[a-z]?|n\.d\.)/.exec(n);
      synopsisByKey.set(`${n.slice(0, 18)}|${year ? year[1] : '?'}`, n);
    }

    const mismatched: string[] = [];
    for (const r of deckRefs()) {
      const norm = normalise(r);
      const yr = /\((\d{4}[a-z]?|n\.d\.)/.exec(norm);
      const syn = synopsisByKey.get(`${norm.slice(0, 18)}|${yr ? yr[1] : '?'}`);
      if (!syn) continue;                       // not shared; the deck may cite a subset
      if (!syn.startsWith(norm.replace(/\.$/, ''))) mismatched.push(norm.slice(0, 110));
    }
    expect(mismatched, 'the deck and the synopsis print the same work differently').toEqual([]);
  });

  it('describes its own verification status truthfully', () => {
    /*
     * The reference slide footnote claimed every reference had been checked "against its PubMed
     * record or, where PubMed does not index it, against the issuing authority". The ledger says
     * otherwise for five items: the issuing authority was unreachable in every one of those cases,
     * and the ledger is explicit that corroboration is not confirmation. A claim about how
     * carefully the work was done is exactly the claim that must not be overstated.
     */
    // The footnote must be DERIVED from the ledger, not typed. A typed one was wrong twice: first by
    // claiming verification at the issuing authority that never happened, then by miscounting
    // ("20 of 25" where the ledger gives 22 and 3).
    expect(deckSrc.includes('function verificationFootnote()'),
      'the verification footnote is no longer computed from the ledger').toBe(true);
    expect(/para\(s, verificationFootnote\(\)/.test(deckSrc),
      'the reference slide does not use the computed footnote').toBe(true);

    // And what it computes must match the ledger read independently here.
    const statuses = new Map<string, string>();
    for (const entry of LEDGER.split('\n### ').slice(1)) {
      const st = /\*\*Status:\s*([A-Z][^.*]*)/.exec(entry);
      const head = /^\d+\.\s*([^,(&—]+)/.exec(entry);
      if (st && head) statuses.set(head[1].trim().split(' ')[0], st[1].trim());
    }
    let confirmed = 0, notIndexed = 0;
    const unresolved: string[] = [];
    for (const r of deckRefs()) {
      const surname = /^([^,(]+)/.exec(r)![1].trim().replace(/\.$/, '').split(' ')[0];
      const hits = [...statuses].filter(([k]) => k.startsWith(surname) || surname.startsWith(k)).map(([, v]) => v);
      if (!hits.length) { unresolved.push(surname); continue; }
      if (hits.some((h) => h.includes('NOT INDEXED'))) notIndexed += 1;
      else if (hits.some((h) => h.startsWith('CONFIRMED'))) confirmed += 1;
      else unresolved.push(surname);
    }
    expect(unresolved, 'a deck reference has no usable status in the ledger').toEqual([]);
    expect(confirmed + notIndexed, 'the ledger does not cover the whole deck bibliography')
      .toBe(deckRefs().length);
  });
});

describe('the lighting standards the project decided it may not cite', () => {
  /*
   * docs/ILLUMINATION_AMENDMENT.md records, in terms: "NOT VERIFIED — must not be cited until
   * checked at source: EN 12464-1, ISO 9241, IS 3646". The egress proxy blocks the publisher and
   * standards domains, so none of the three was ever read. The synopsis honoured that decision and
   * says so in Section 3.4. Three other places did not: src/experiment/illumination.ts cited IS 3646
   * for a figure that had also become false, cited ISO 9241 as the authority for choosing 300 lux,
   * and tests/counterbalance.test.ts repeated the second one. The project's own rule was being
   * broken in the project's own source.
   */
  const FORBIDDEN = ['EN 12464', 'ISO 9241', 'IS 3646'];

  /** Where naming the standards IS the point: the records that mark them unverified. */
  const ALLOWED = [
    'docs/CITATION_VERIFICATION.md',
    'docs/ILLUMINATION_AMENDMENT.md',
    'docs/LITERATURE_VALIDATION.md',
    'synopsis/SYNOPSIS_AdtU_Short.md',
    'synopsis/LITERATURE_REVIEW.md',
    'tests/citationIntegrity.test.ts',
  ];

  it('are cited as authority nowhere outside the records that mark them unverified', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT }).toString('utf8').split('\n')
      .filter((f) => /\.(ts|tsx|js|cjs|mjs|md|html|py)$/.test(f))
      .filter((f) => !ALLOWED.includes(f));

    const offenders: string[] = [];
    for (const f of tracked) {
      let text: string;
      try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
      for (const std of FORBIDDEN) {
        if (!text.includes(std)) continue;
        /*
         * Naming one in order to say it is NOT relied on is the behaviour we want, not a violation.
         * The disclaimer often falls on the next line of a wrapped comment, so a window of three
         * lines is searched rather than the matching line alone.
         */
        const lines = text.split('\n');
        const EXEMPT = /NOT VERIFIED|not verified|never read|not cited|not to be cited|WITHDRAWN|could not be (?:read|verified)|records .* as NOT/i;
        const bare = lines
          .map((l, i) => ({ l, window: lines.slice(Math.max(0, i - 4), i + 4).join(' ') }))
          .filter(({ l }) => l.includes(std))
          .filter(({ window }) => !EXEMPT.test(window));
        if (bare.length) offenders.push(`${f}: ${bare[0].l.trim().slice(0, 110)}`);
      }
    }
    expect(offenders, 'a lighting standard the project has not read is cited as authority').toEqual([]);
  });
});

describe('the verification ledger', () => {
  it('marks unverified items as unverified rather than as checked', () => {
    // Statuses are the ledger's whole purpose; a status the file does not define is a typo that
    // silently reads as verified.
    const statuses = [...LEDGER.matchAll(/\*\*Status:\s*([A-Z][A-Z ,]+[A-Z])/g)].map((m) => m[1].trim());
    expect(statuses.length, 'no statuses were parsed').toBeGreaterThan(30);
    // Kept in step with the legend at the top of docs/CITATION_VERIFICATION.md.
    const known = ['CONFIRMED', 'CONFIRMED, FIELD DIFFERS', 'METADATA CONFIRMED', 'NOT INDEXED IN PUBMED',
      'NOT VERIFIED', 'UNRESOLVED', 'FAILED'];
    const unknown = [...new Set(statuses)].filter((s) => !known.some((k) => s.startsWith(k)));
    expect(unknown, 'an entry carries a status the ledger does not define').toEqual([]);
  });
});

/**
 * The CVS-Q cut-off in the code and the cut-off in the citation ledger must be the same number.
 *
 * They were not. The ledger recorded "the ≥7 cut-off ... used by this project's instrument", taking
 * the figure from the PORTUGUESE cross-cultural version; the code implements ≥6, which is the
 * ORIGINAL 16-item instrument's cut-off and the one this study administers. A contradiction between
 * the code and the project's own verified record is the kind that gets resolved in the wrong
 * direction: changing the constant to 7 would silently reclassify every participant scoring exactly
 * 6, at baseline and at session end, and in both directions of the change score.
 *
 * The instrument's own authors settle it — see docs/CITATION_VERIFICATION.md entry 24b — and this
 * test keeps the two in step.
 */
describe('the CVS-Q cut-off agrees with the verified record', () => {
  const ledger = readFileSync(resolve(__dirname, '..', 'docs/CITATION_VERIFICATION.md'), 'utf8');

  it('is six, the original instrument’s cut-off', () => {
    expect(CVSQ_CUTOFF).toBe(6);
  });

  it('classifies exactly at the boundary, not one either side of it', () => {
    expect(scoreCvsq(Array(16).fill(0), Array(16).fill(0)).symptomatic).toBe(false);
    // Six items at severity 1 (frequency 1 x intensity 1) → item score 1 each → total 6.
    const six = Array(16).fill(0).map((_, i) => (i < 6 ? 1 : 0));
    const scored = scoreCvsq(six, six);
    expect(scored.total).toBe(6);
    expect(scored.symptomatic).toBe(true);
    const five = Array(16).fill(0).map((_, i) => (i < 5 ? 1 : 0));
    expect(scoreCvsq(five, five).symptomatic).toBe(false);
  });

  it('the ledger records six as this project’s cut-off, and seven as the Portuguese version’s', () => {
    expect(ledger).toMatch(/whose cut-off is \*\*≥6\*\*/);
    expect(ledger).toMatch(/≥7 is the \*\*Portuguese\*\* version's cut-off/);
  });

  it('the ledger still says the ≥6 is not read from the primary source', () => {
    // It rests on the same-authors CVS-Q teen statement; the Seguí (2015) full text was unreachable
    // from this environment. An honest ledger says which, and this keeps that caveat in place until
    // someone actually reads the paper.
    expect(ledger).toMatch(/not a reading of the primary/);
  });
});

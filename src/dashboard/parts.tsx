/**
 * The dashboard's small pieces, shared by every tab: one look for a status, a "More" that keeps the full
 * text one tap away, the short notice and caveat built on it, "How to read this page", and the tile.
 *
 * WHY THEY EXIST (Round 83). Testing 2.3.1, the investigator found the justifications and flags
 * "multiple paragraph-like texts". Nothing in them was wrong, and none of it may be dropped — a number
 * or a reason on this page is what an operator acts on, and the wording records why a rule is what it
 * is. So the page is organised, not cut: a line or two is shown, and the rest sits behind More, in the
 * page (hidden, not unmounted), so a search or a test still finds it.
 */
import { useState } from 'react';
import { UI_GROUNDS, UI_TEXT } from '@/lib/uiPalette';
import type { CheckStatus, Reliability } from '@/tracking/ocularReliability';

/**
 * One look for every status on the page, the same words as the researcher card and the export:
 * ✓ passed / good, ! flagged / usable, ✕ failed / not usable, – not measured. Text colours are the
 * operator palette's (each at least 4.5:1 on white and on the tinted grounds, tests/contrast.test.ts),
 * and every status carries its symbol and a word, so none is told by colour alone.
 */
export const STATUS = {
  good: { color: UI_TEXT.green, icon: '✓' },
  warn: { color: UI_TEXT.amber, icon: '!' },
  bad: { color: UI_TEXT.red, icon: '✕' },
  none: { color: UI_TEXT.muted, icon: '–' },
} as const;
export type StatusKey = keyof typeof STATUS;
export const CHECK_STATUS: Record<CheckStatus, StatusKey> = { pass: 'good', flag: 'warn', fail: 'bad', not_judged: 'none' };
export const VERDICT_STATUS: Record<Reliability, StatusKey> = { good: 'good', usable: 'warn', not_usable: 'bad' };

/**
 * "More" — what used to be printed in full, one tap away. The content stays in the page (hidden, not
 * unmounted), so nothing that was reachable has gone. A 44 px target, like every button on the console.
 */
export function More({ label = 'More', children, tone, testId }: { label?: string; children: React.ReactNode; tone?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testId}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="font-sans text-[15px]"
        style={{ minHeight: 44, padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer', color: tone ?? UI_TEXT.blue, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }}>
        {label === 'More' ? (open ? 'Less ▴' : 'More ▾') : `${label} ${open ? '▴' : '▾'}`}
      </button>
      <div hidden={!open}>{children}</div>
    </div>
  );
}

/** A short line that is always shown, and the rest behind More. */
export function Notice({ short, more, tone }: { short: string; more?: string; tone?: 'warn' }) {
  const color = tone === 'warn' ? UI_TEXT.amber : UI_TEXT.muted;
  const box: React.CSSProperties = tone === 'warn'
    ? { border: '1px solid #f5a623', borderRadius: 10, padding: '10px 14px 2px', background: UI_GROUNDS.notice }
    : { marginTop: 6 };
  return (
    <div style={box}>
      <p className="font-sans text-[15px] leading-relaxed" style={{ color }}>{short}</p>
      {more && <More tone={tone === 'warn' ? UI_TEXT.amber : undefined}><p className="font-sans text-[15px] leading-relaxed" style={{ color }}>{more}</p></More>}
    </div>
  );
}

/** The caveat under a tab's charts: one or two lines, the full text, unchanged, behind More. */
export function Caveat({ short, more }: { short: string; more: string }) {
  return (
    <div data-testid="caveat" style={{ gridColumn: '1 / -1', background: UI_GROUNDS.caution, border: '1px solid #f5a62340', borderRadius: 12, padding: '12px 14px 2px' }}>
      <p className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.amber }}>⚠ {short}</p>
      <More tone={UI_TEXT.amber}><p className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.amber }}>{more}</p></More>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="font-sans text-sm font-medium uppercase tracking-wide" style={{ color: UI_TEXT.muted, marginBottom: 6 }}>{children}</p>;
}

/** What a tab is for and how to read it: a few short lines, the same box on every tab. */
export function HowToRead({ lines }: { lines: string[] }) {
  return (
    <div data-testid="how-to-read" style={{ background: UI_GROUNDS.info, border: '1px solid #c9d6f2', borderRadius: 12, padding: '10px 14px', margin: '0 0 14px' }}>
      <p className="font-sans text-[15px]" style={{ fontWeight: 600, color: UI_TEXT.ink }}>How to read this page</p>
      <ul style={{ margin: '4px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
        {lines.map((l) => (
          <li key={l} className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.body }}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>{children}</div>;
}

export function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div data-testid={testId} style={{ background: '#fff', border: '1px solid #e5e2dc', borderRadius: 14, padding: 16 }}>
      <div className="font-sans text-[15px] leading-relaxed" style={{ color: UI_TEXT.muted }}>{label}</div>
      <div className="font-serif" style={{ fontSize: 28, marginTop: 4 }}>{value}</div>
      {sub && <div className="font-sans text-[15px]" style={{ color: UI_TEXT.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/** A table cell's padding and rule, shared by every table on the page. */
export const cell = { padding: '6px 10px', borderBottom: '1px solid #f3f1ec' } as const;

/** A number to `dp` places, or a dash for not measured — never a zero. */
export function n(x: number | null, dp = 2): string {
  return x == null ? '—' : (Math.round(x * 10 ** dp) / 10 ** dp).toString();
}

/** "2 blocking · 1 warning": the join check's own two words (storage/joinIntegrity.ts). */
export function countBySeverity(issues: { severity: string }[]): string {
  const blocking = issues.filter((i) => i.severity === 'blocking').length;
  const rest = issues.length - blocking;
  return [blocking ? `${blocking} blocking` : '', rest ? `${rest} warning${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}

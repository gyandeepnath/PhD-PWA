/**
 * The instruction card shown before each task of a display — reading, word search and the reaction
 * task — so the participant always knows what comes next. Drawn in the active condition's colours.
 *
 * ONE CARD FOR ALL THREE. The reaction task used to roll its own: a DM Mono 24 px heading where the
 * others have Georgia 36, a 14 px button, a narrower column, and "Task 4 of 4 · Reaction" set as the
 * heading instead of the eyebrow (screen audit F15). It now renders this card, with the target dot
 * and the "colour has changed" banner in the `children` slot.
 *
 * The eyebrow, the counter rule and the button are the shared ones (loopChrome.tsx): eyebrow 16 px in
 * full ink (it was 12 px DM Mono, 10.3 px on the tablet at the old scale), and "Display k of N · Step
 * j of 5 · Name" drawn from experiment/taskSteps.tsx.
 */
import type { ReactNode } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { Eyebrow, PrimaryButton } from './loopChrome';

interface Props {
  eyebrow: string;
  title: string;
  /** One paragraph each. A line may carry markup, e.g. the target colour's name in that colour. */
  lines: ReactNode[];
  /** Shown under the lines, above the button: the reaction task's target dot and change banner. */
  children?: ReactNode;
  buttonLabel?: string;
  background: string;
  text: string;
  onBegin: () => void;
}

export function TaskIntro({ eyebrow, title, lines, children, buttonLabel = 'Begin →', background, text, onBegin }: Props) {
  return (
    <div
      data-testid="task-intro"
      className="screen w-full"
      /*
       * Fixed vertical padding, not a percentage: a percentage padding is a percentage of the WIDTH, so
       * on the 1280 px root that Chrome's address bar produces it took 102 px top and bottom. The
       * card's content is centred and narrow, so it never comes near the Pause chip (top left) or the
       * researcher indicator (bottom left).
       */
      style={{ background, color: text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 8%' }}
    >
      <div style={{ maxWidth: 620, textAlign: 'center' }}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 300, fontSize: 36, margin: '12px 0 18px' }}>{title}</h1>
        {lines.map((l, i) => (
          <p key={i} style={{ fontFamily: STIMULUS_FONT_STACK, fontSize: 17, lineHeight: 1.6, marginBottom: 10 }}>
            {l}
          </p>
        ))}
        {children}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
          <PrimaryButton ink={text} ground={background} onClick={onBegin}>{buttonLabel}</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

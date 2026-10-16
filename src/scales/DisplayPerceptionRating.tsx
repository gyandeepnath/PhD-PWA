/**
 * Display comfort + text clarity ratings (0-100), each a 100 mm visual analogue line (Round 84; see
 * vas.ts). Shown on the active condition's colours so the participant rates the display they're using.
 * Unanswered is null, not a value: this scale once opened with the track filled to the midpoint while its
 * label read "not set" — an anchor at 50 — and then as a slider whose thumb was merely hidden there.
 */
import { useMemo, useRef, useState } from 'react';
import { now } from '@/lib/timing';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import type { PhysicalSource, SessionPhysical } from '@/lib/physicalCalibration';
import { displayStepLabel, type DisplayPosition } from '@/experiment/taskSteps';
import { ActionRow, Eyebrow, LOOP_TEXT_MIN_PX, PrimaryButton } from '@/tasks/loopChrome';
import { VasLine } from './VasLine';
import { drawnLineMm, SLIDER_VERSION, vasLineCssPx } from './vas';

export interface PerceptionResult {
  comfort: number;
  clarity: number;
  comfortTouched: boolean;
  clarityTouched: boolean;
  /** Time from mount to submit (ms) — engagement signal. */
  responseTimeMs: number;
  /** The rating format (vas.ts SLIDER_VERSION). */
  sliderVersion: string;
  /** The length the lines were drawn at when the participant pressed Continue, mm; null if unmeasurable. */
  lineMm: number | null;
  lineSource: PhysicalSource;
}

interface Props {
  background: string;
  text: string;
  /** The sitting's ruler calibration (or its absence), which sets the line's 100 mm. */
  physical: SessionPhysical;
  onComplete: (r: PerceptionResult) => void;
  /** Which display of the sitting this is, for the eyebrow. */
  display?: DisplayPosition;
}

/**
 * Every word on this screen at the condition-screen floor, 16 px in the stimulus face and full ink
 * (screen audit F9): the instruction was 12 px DM Mono and the anchors 14, which the tablet drew at
 * 10.3 and 12 CSS px at the old scale — in the condition's ink, so least legible in the lowest-contrast
 * conditions. The eyebrow says which display and step this is (taskSteps.tsx); the button is the shared
 * one, at the right-hand edge under the lines (loopChrome.tsx). The end words are long, so they sit
 * under the line's two ends rather than beside them, which keeps the line its full 100 mm.
 */
const label: React.CSSProperties = { fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX };

export function DisplayPerceptionRating({ background, text, physical, onComplete, display }: Props) {
  /** Whole millimetres from the left end, or null while unanswered. */
  const [comfort, setComfort] = useState<number | null>(null);
  const [clarity, setClarity] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const mountedAt = useRef(now());
  const firstLine = useRef<HTMLDivElement | null>(null);
  const line = useMemo(() => vasLineCssPx(physical, window.devicePixelRatio), [physical]);
  const both = comfort != null && clarity != null;
  const ready = both && !sent;

  return (
    <div
      className="screen w-full font-sans"
      // Fixed vertical padding: a percentage is a share of the WIDTH, which the address bar changes.
      style={{ background, color: text, display: 'flex', flexDirection: 'column', padding: '40px 6%' }}
    >
      {/*
        Centred in the screen, not top-aligned: this block used to sit at the top with half the screen
        empty below it, which is the layout the investigator asked to be rid of. Auto margins, so a
        taller block collapses to the top instead of being clipped.
      */}
      <div style={{ width: '100%', maxWidth: 720, margin: 'auto' }}>
      <Eyebrow>{displayStepLabel('DISPLAY_PERCEPTION', display)}</Eyebrow>
      <h2 className="mt-2 font-serif text-3xl font-light">How did this display feel?</h2>
      <p className="mt-1" style={label}>Tap each line to rate this display. Tap again or slide to change it.</p>
      {/*
        The gap between the two items is about twice a label's distance from its own line. With the end
        words UNDER each line, a 22 px gap left the first line's end words ("Very uncomfortable") as close
        to the second item's label as that label was to its own line, so the two read as one block
        (seen in the Round 84 screenshots). There is room for it at every viewport the suite fits. Drawn
        as part of the first item (spaceBelow), so a tap in it marks neither line (VasLine.tsx).
      */}
      <div className="mt-6" style={{ display: 'flex', flexDirection: 'column' }}>
        <VasLine
          name="comfort" label="Comfort of the display" left="Very uncomfortable" right="Very comfortable" anchors="below"
          ink={text} value={comfort} lineCssPx={line.cssPx} onChange={setComfort} spaceBelow={44}
          lineRef={(el) => { firstLine.current = el; }}
        />
        <VasLine
          name="clarity" label="Clarity of the text" left="Very unclear" right="Very clear" anchors="below"
          ink={text} value={clarity} lineCssPx={line.cssPx} onChange={setClarity} spaceBelow={32}
        />
      </div>
      {/* The 32 px above the status line is the clarity item's own space (spaceBelow), as between the items. */}
      <ActionRow
        status={both ? 'Thank you — tap Continue.' : 'Mark both lines to continue.'}
      >
        <PrimaryButton
          ink={text} ground={background} enabled={ready}
          onClick={() => {
            // A ref as well as the state: two taps inside one frame both see the state from before the first.
            if (!ready || sentRef.current) return;
            sentRef.current = true;
            setSent(true);
            onComplete({
              comfort: comfort as number, clarity: clarity as number, comfortTouched: true, clarityTouched: true,
              responseTimeMs: now() - mountedAt.current, sliderVersion: SLIDER_VERSION,
              lineMm: drawnLineMm(firstLine.current?.getBoundingClientRect().width ?? NaN, physical, window.devicePixelRatio),
              lineSource: line.source,
            });
          }}
        >
          Continue →
        </PrimaryButton>
      </ActionRow>
      </div>
    </div>
  );
}

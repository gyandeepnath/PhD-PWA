/**
 * 5-item visual-fatigue scale, each item a 100 mm visual analogue line (Round 84; see vas.ts).
 * Stored per item 0-10 in tenths (whole millimetres / 10); composite = mean of items.
 *
 * Audit fix: submit is disabled until all five are answered, so an untouched all-zero record can't be
 * silently submitted (the original defaulted every slider to 0 with submit always enabled). Since Round
 * 84 an unanswered line has no value at all — null, not 0 — and no marker, so there is no default to be
 * anchored by or to submit by accident.
 */
import { useMemo, useRef, useState } from 'react';
import { mean } from '@/lib/stats';
import { now } from '@/lib/timing';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import type { PhysicalSource, SessionPhysical } from '@/lib/physicalCalibration';
import { ActionRow, Eyebrow, LOOP_TEXT_MIN_PX, PrimaryButton } from '@/tasks/loopChrome';
import { VasLine } from './VasLine';
import { drawnLineMm, SLIDER_VERSION, vasLineCssPx } from './vas';

export interface FatigueResult {
  items: { eye_strain: number; dryness: number; blur: number; burning: number; headache: number };
  mean: number;
  touched: { eye_strain: boolean; dryness: boolean; blur: boolean; burning: boolean; headache: boolean };
  /** Time from mount to submit (ms) — engagement/careless-responding signal. */
  responseTimeMs: number;
  /** The rating format (vas.ts SLIDER_VERSION). */
  sliderVersion: string;
  /** The length the lines were drawn at when the participant pressed Continue, mm; null if unmeasurable. */
  lineMm: number | null;
  /** Where the millimetres per pixel behind that length came from (the ruler, or a documented fallback). */
  lineSource: PhysicalSource;
}

const ITEMS = [
  { key: 'eye_strain', label: 'Tired or aching eyes' },
  { key: 'dryness', label: 'Dry or irritated feeling' },
  { key: 'blur', label: 'Difficulty focusing / blur' },
  { key: 'burning', label: 'Burning or stinging' },
  { key: 'headache', label: 'Head pain or pressure' },
] as const;

type Key = (typeof ITEMS)[number]['key'];

interface Props {
  prompt: string;
  /** Condition colours (post-condition rating runs under the active display); default = neutral cream. */
  background?: string;
  text?: string;
  /** Inside a display: "Display k of N · Step 3 of 5 · Ratings". None before the displays begin. */
  eyebrow?: string;
  /** The sitting's ruler calibration (or its absence), which sets the line's 100 mm. */
  physical: SessionPhysical;
  onComplete: (r: FatigueResult) => void;
}

/*
 * FULL INK AND 16 PX for anything the participant must read (screen audit F9). The ink was at 60%
 * alpha once, and translucency multiplies the condition's own contrast: in P4 (yellow on white, 2.39:1)
 * the instruction line fell to about 1.67:1, so the participant got the least legible instructions in
 * exactly the low-contrast conditions — a legibility effect correlated with the factor under test.
 * The SIZE did the same: the instruction was 12 px DM Mono, the item labels 14, the "0" and "10" ends
 * 11 px — 9.5 CSS px on the tablet at the old scale. Everything is now 16 px in the stimulus face;
 * hierarchy is carried by size and weight.
 *
 * ONE INK. The answered value, the track and the button were drawn in a separate `accent`: the
 * condition's ink after a display, but #4f8ef7 at the baseline — a blue at 3.2:1 on the cream, the
 * value of every answered item set in it. The scale now draws everything in `text`, as the two other
 * questionnaires do (the NASA-TLX's accent became #1f5fbf for the same reason).
 *
 * Shared by the baseline (on the cream set-up ground, before any display) and every post-display
 * rating, so the instrument looks the same at the reference point as at each repeat — the same
 * 100 mm lines, at the same place on the screen.
 */
const label: React.CSSProperties = { fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX };

const EMPTY: Record<Key, number | null> = { eye_strain: null, dryness: null, blur: null, burning: null, headache: null };

export function FatigueScale({ prompt, background = '#F8F7F5', text = '#1a1a2e', eyebrow, physical, onComplete }: Props) {
  /** Whole millimetres from the left end of each line, or null while unanswered. */
  const [values, setValues] = useState<Record<Key, number | null>>(EMPTY);
  const [sent, setSent] = useState(false);
  const sentRef = useRef(false);
  const mountedAt = useRef(now());
  const firstLine = useRef<HTMLDivElement | null>(null);
  // Fixed for the life of the screen: the pixel ratio and the calibration do not change under it.
  const line = useMemo(() => vasLineCssPx(physical, window.devicePixelRatio), [physical]);
  const answered = ITEMS.filter((it) => values[it.key] != null).length;
  const allTouched = answered === ITEMS.length;

  const submit = () => {
    // A ref as well as the state: two taps inside one frame both see the state from before the first.
    if (!allTouched || sent || sentRef.current) return;
    sentRef.current = true;
    setSent(true);
    // Tenths of the 0-10 scale: whole millimetres of the line, divided by ten.
    const items = Object.fromEntries(ITEMS.map((it) => [it.key, (values[it.key] as number) / 10])) as FatigueResult['items'];
    const touched = Object.fromEntries(ITEMS.map((it) => [it.key, true])) as FatigueResult['touched'];
    onComplete({
      items, mean: mean(Object.values(items)), touched, responseTimeMs: now() - mountedAt.current,
      sliderVersion: SLIDER_VERSION,
      lineMm: drawnLineMm(firstLine.current?.getBoundingClientRect().width ?? NaN, physical, window.devicePixelRatio),
      lineSource: line.source,
    });
  };

  return (
    // Fixed vertical padding: a percentage is a share of the WIDTH, which the address bar changes.
    <div className="screen w-full font-sans" style={{ background, color: text, display: 'flex', flexDirection: 'column', padding: '40px 5%' }}>
      {/*
        Centred in the screen, not top-aligned: this block used to sit at the top with half the screen
        empty below it, which is the layout the investigator asked to be rid of. Auto margins, so a
        taller block collapses to the top instead of being clipped.
      */}
      <div style={{ width: '100%', maxWidth: 720, margin: 'auto' }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={`${eyebrow ? 'mt-2 ' : ''}font-serif text-3xl font-light`}>{prompt}</h2>
      <p className="mt-1" style={label}>Tap each line where it matches how your eyes feel. Tap again or slide to change it.</p>

      {/* The gap between items is wider than a label's distance from its own line, so each label groups with its line. */}
      <div className="mt-3" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {ITEMS.map((it, i) => (
          <VasLine
            key={it.key} name={it.key} label={it.label} left="None" right="Severe" anchors="beside"
            ink={text} value={values[it.key]} lineCssPx={line.cssPx}
            onChange={(mm) => setValues((v) => ({ ...v, [it.key]: mm }))}
            lineRef={i === 0 ? (el) => { firstLine.current = el; } : undefined}
          />
        ))}
      </div>

      {/*
        No score and no delta are shown to the participant.
        This screen used to display the composite and, beside it, a colour-coded
        "Δ +2.3 vs baseline" — red when worse, green when better — after every one of the ten
        conditions. That is performance feedback on a repeated self-report outcome, and it is the
        strongest kind: a comparative judgement against the participant's own earlier state,
        colour-coded for valence. It feeds each rating back into the next one, invites consistency
        or contrast effects, and makes the fatigue trajectory partly a report of what the
        participant was just told about themselves.
        The operator manual forbids the operator from giving feedback of any kind, for exactly this
        reason. The instrument should not do what the operator is instructed not to do. The
        composite and the delta are both computed and exported; they belong in the dashboard, which
        is researcher-facing, not here.

        The `baselineMean` prop is GONE, not merely unused. It survived the removal as a parameter
        the experiment still passed and this component still accepted and ignored — a wire from the
        baseline rating to the screen that must not show it, needing only one line to become live
        again. A comment saying "no longer used" does not stop that; not having the value here does.
      */}
      <ActionRow style={{ marginTop: 20 }} status={allTouched ? 'Thank you — tap Continue.' : `Mark every line to continue (${answered} of ${ITEMS.length} marked).`}>
        <PrimaryButton ink={text} ground={background} enabled={allTouched && !sent} onClick={submit}>
          Continue →
        </PrimaryButton>
      </ActionRow>
      </div>
    </div>
  );
}

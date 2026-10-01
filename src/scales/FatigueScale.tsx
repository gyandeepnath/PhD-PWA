/**
 * 5-item visual-analogue fatigue scale (0-10). Composite = mean of items.
 *
 * Audit fix: each slider has a `touched` flag and submit is disabled until all five are touched,
 * so an untouched all-zero record can't be silently submitted (the original defaulted every
 * slider to 0 with submit always enabled).
 */
import { useRef, useState } from 'react';
import { mean } from '@/lib/stats';
import { now } from '@/lib/timing';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { ActionRow, Eyebrow, LOOP_TEXT_MIN_PX, PrimaryButton } from '@/tasks/loopChrome';
import { ratingTrack } from './trackStyle';

export interface FatigueResult {
  items: { eye_strain: number; dryness: number; blur: number; burning: number; headache: number };
  mean: number;
  touched: { eye_strain: boolean; dryness: boolean; blur: boolean; burning: boolean; headache: boolean };
  /** Time from mount to submit (ms) — engagement/careless-responding signal. */
  responseTimeMs: number;
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
  onComplete: (r: FatigueResult) => void;
}

/*
 * FULL INK AND 16 PX for anything the participant must read (screen audit F9). The ink was at 60%
 * alpha once, and translucency multiplies the condition's own contrast: in P4 (yellow on white, 2.39:1)
 * the instruction line fell to about 1.67:1, so the participant got the least legible instructions in
 * exactly the low-contrast conditions — a legibility effect correlated with the factor under test.
 * The SIZE did the same: the instruction was 12 px DM Mono, the item labels 14, the "0" and "10" ends
 * 11 px — 9.5 CSS px on the tablet at the old scale. Everything is now 16 px in the stimulus face;
 * hierarchy is carried by size and weight. Decoration (the empty track) may still be translucent.
 *
 * ONE INK. The answered value, the track and the button were drawn in a separate `accent`: the
 * condition's ink after a display, but #4f8ef7 at the baseline — a blue at 3.2:1 on the cream, the
 * value of every answered item set in it. The scale now draws everything in `text`, as the two other
 * questionnaires do (the NASA-TLX's accent became #1f5fbf for the same reason).
 *
 * Shared by the baseline (on the cream set-up ground, before any display) and every post-display
 * rating, so the instrument looks the same at the reference point as at each repeat.
 */
const label: React.CSSProperties = { fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX };

export function FatigueScale({ prompt, background = '#F8F7F5', text = '#1a1a2e', eyebrow, onComplete }: Props) {
  const [values, setValues] = useState<Record<Key, number>>({
    eye_strain: 0, dryness: 0, blur: 0, burning: 0, headache: 0,
  });
  const [touched, setTouched] = useState<Record<Key, boolean>>({
    eye_strain: false, dryness: false, blur: false, burning: false, headache: false,
  });

  const [sent, setSent] = useState(false);
  const mountedAt = useRef(now());
  const allTouched = ITEMS.every((it) => touched[it.key]);
  const composite = mean(ITEMS.map((it) => values[it.key]));

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
      <p className="mt-1" style={label}>Tap or drag each slider. 0 = none, 10 = severe.</p>

      <div className="mt-5 space-y-5">
        {ITEMS.map((it) => (
          <div key={it.key}>
            <div className="flex justify-between" style={{ ...label, marginBottom: 4 }}>
              <span>{it.label}</span>
              <span style={{ fontWeight: 700 }}>
                {touched[it.key] ? `${values[it.key]} / 10` : 'not set'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...label, width: 22, textAlign: 'right' }}>0</span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={values[it.key]}
                aria-label={it.key}
                className={touched[it.key] ? undefined : 'vl-untouched'}
                onPointerDown={() => setTouched((t) => ({ ...t, [it.key]: true }))}
                style={{
                  flex: 1,
                  color: text,
                  // Full-ink dashed track, solid up to the answer once touched. See ratingTrack.
                  background: ratingTrack(text, touched[it.key], values[it.key] * 10),
                }}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [it.key]: Number(e.target.value) }));
                  setTouched((t) => ({ ...t, [it.key]: true }));
                }}
              />
              <span style={{ ...label, width: 22 }}>10</span>
            </div>
          </div>
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
      <ActionRow style={{ marginTop: 24 }} status={allTouched ? 'Thank you — tap Continue.' : 'Set all sliders to continue.'}>
        <PrimaryButton
          ink={text} ground={background} enabled={allTouched && !sent}
          onClick={() => {
            if (!allTouched || sent) return;
            setSent(true);
            onComplete({ items: { ...values }, mean: composite, touched: { ...touched }, responseTimeMs: now() - mountedAt.current });
          }}
        >
          Continue →
        </PrimaryButton>
      </ActionRow>
      </div>
    </div>
  );
}

/**
 * One visual analogue line: an item label, a 100 mm line with a word at each end, and — once the
 * participant has touched it — a marker. The rules it follows, and the evidence for them, are in vas.ts.
 *
 * Drawn entirely in the condition's ink (`ink`), at full opacity, like every other word and mark on a
 * condition screen (loopText.test.ts): the line is the only thing to aim at, so it must be as visible in
 * the lowest-contrast condition as the text was. It is SOLID, with an end stop at each end and nothing in
 * between — no ticks, no fill, no number — so the only marks on it are its ends and, once answered, the
 * participant's own.
 *
 * Touch: a tap anywhere in the target (much taller than the line, and a little past each end, where it
 * reads as 0 or 100) places the marker at that point along the line; dragging moves it; a second tap
 * re-places it. Pointer capture keeps a drag that leaves the target attached to this line. Keyboard, for
 * the operator: Home and End set the ends, and the arrows move a placed marker by a millimetre.
 *
 * ONLY A TAP INSIDE THE TARGET MARKS THE LINE (Round 85). On a touch screen the browser hands a tap that
 * lands near something tappable, but not on it, to that thing (Chromium's touch adjustment). The item's
 * label, its end words and the space under it were not tappable, so a tap on the label a few pixels
 * above the target was taken as a rating on the line, at the left end where the label starts — measured
 * in headless Chromium with a touch screen at 1152 x 720: taps 3-9.5 px above the target marked it, and
 * so did taps 1-9 px into the space below it. With a real fingertip, whose contact is wider, the reach
 * is probably larger (not measured on the Xiaomi Pad 6). Every part of an item that is not the target
 * now takes a tap itself and ignores it (`sinkTaps`): the browser then has the tapped element itself to
 * give the tap to, and the line is marked only by a tap inside its own target. The space between items
 * is part of the item above it (`spaceBelow`) for the same reason, so no gap is left unowned.
 */
import { useRef, type CSSProperties } from 'react';
import { STIMULUS_FONT_STACK } from '@/lib/fonts';
import { LOOP_TEXT_MIN_PX } from '@/tasks/loopChrome';
import { vasMm, VAS_LINE_MM } from './vas';

/**
 * Height of the touch target, design px (about 9.5 mm on the study tablet). The line sits LINE_Y from its
 * top, leaving room above for the marker and more below it, where a fingertip lands.
 */
export const VAS_TARGET_PX = 46;
const LINE_Y = 22;
/** The line's thickness, its end stops' height, and the marker's width and height (design px). */
const LINE_PX = 3;
const END_STOP_PX = 16;
const MARKER_W_PX = 4;
/** The marker stands mostly ABOVE the line, so the fingertip that placed it does not cover it. */
const MARKER_ABOVE_PX = 20;
const MARKER_BELOW_PX = 10;
/** How far past each end the target reaches, design px: a tap there reads as the end. */
export const VAS_OVERSHOOT_PX = 12;
/** Width kept for an end word drawn beside the line ("None", "Severe"). */
const BESIDE_ANCHOR_PX = 60;

const text16: CSSProperties = { fontFamily: STIMULUS_FONT_STACK, fontSize: LOOP_TEXT_MIN_PX, lineHeight: 1.4 };

/** Does nothing: its being there is what makes the element answer a tap itself (see the header). */
function ignoreTap() {}

/**
 * Makes an element take a tap itself, so the browser does not hand a tap on it to the nearest line.
 * A native listener, because React listens at the root and the element would otherwise have none of its
 * own; adding the same function twice is a no-op, so a re-run of the ref is harmless.
 */
function sinkTaps(el: HTMLElement | null) {
  el?.addEventListener('click', ignoreTap);
}

export function VasLine({ name, label, left, right, anchors, ink, value, lineCssPx, onChange, lineRef, spaceBelow = 0 }: {
  /** The item's key: the target's data-testid is `vas-<name>`. */
  name: string;
  label: string;
  /** The words at the two ends. */
  left: string;
  right: string;
  /** Short end words go beside the line, long ones under its ends. */
  anchors: 'beside' | 'below';
  ink: string;
  /** Whole millimetres from the left end (0-100), or null: not answered, which is not 0. */
  value: number | null;
  /** The line's length in CSS px (100 mm on this screen; vasLineCssPx). Drawn at that size at any display scale. */
  lineCssPx: number;
  onChange: (mm: number) => void;
  /** The line element, so the screen can record the length it was drawn at. */
  lineRef?: (el: HTMLDivElement | null) => void;
  /** Space under the item, design px, before the next one: part of this item, so a tap there marks nothing. */
  spaceBelow?: number;
}) {
  const line = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const place = (clientX: number) => {
    const r = line.current?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return;
    onChange(vasMm((clientX - r.left) / r.width));
  };

  /*
   * In design px, divided by the display scale, so the line is lineCssPx CSS px on screen at whatever
   * scale the root is drawn: inside the scaled #root, w design px are w x scale CSS px. If the column
   * cannot hold it (a screen far smaller than the study tablet's), the target shrinks with the row and
   * the length actually drawn is what the screen records.
   */
  const targetWidth = `calc(${lineCssPx.toFixed(2)}px / var(--vl-scale) + ${2 * VAS_OVERSHOOT_PX}px)`;

  const target = (
    <div
      data-testid={`vas-${name}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={VAS_LINE_MM}
      aria-valuenow={value ?? undefined}
      aria-valuetext={value == null ? 'not set' : undefined}
      data-value={value ?? ''}
      style={{ position: 'relative', height: VAS_TARGET_PX, width: targetWidth, flex: '0 1 auto', minWidth: 0, touchAction: 'none', cursor: 'pointer', outline: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        place(e.clientX);
      }}
      onPointerMove={(e) => { if (dragging.current) place(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onLostPointerCapture={() => { dragging.current = false; }}
      onKeyDown={(e) => {
        if (e.key === 'Home') onChange(0);
        else if (e.key === 'End') onChange(VAS_LINE_MM);
        else if (value != null && (e.key === 'ArrowLeft' || e.key === 'ArrowDown')) onChange(Math.max(0, value - 1));
        else if (value != null && (e.key === 'ArrowRight' || e.key === 'ArrowUp')) onChange(Math.min(VAS_LINE_MM, value + 1));
        else return;
        e.preventDefault();
      }}
    >
      <div
        ref={(el) => { line.current = el; lineRef?.(el); }}
        data-vas-line=""
        style={{ position: 'absolute', left: VAS_OVERSHOOT_PX, right: VAS_OVERSHOOT_PX, top: LINE_Y - LINE_PX / 2, height: LINE_PX, background: ink }}
      >
        <div style={{ position: 'absolute', left: -1, top: LINE_PX / 2 - END_STOP_PX / 2, width: 2, height: END_STOP_PX, background: ink }} />
        <div style={{ position: 'absolute', right: -1, top: LINE_PX / 2 - END_STOP_PX / 2, width: 2, height: END_STOP_PX, background: ink }} />
        {value != null && (
          <div
            data-testid={`vas-${name}-marker`}
            style={{
              position: 'absolute', left: `${value}%`, top: LINE_PX / 2 - MARKER_ABOVE_PX, width: MARKER_W_PX,
              height: MARKER_ABOVE_PX + MARKER_BELOW_PX, marginLeft: -MARKER_W_PX / 2, background: ink,
            }}
          />
        )}
      </div>
    </div>
  );

  return (
    // As wide as the line and its end words, centred in the column; the label starts where they do.
    // Every element here but the target takes its own taps (sinkTaps), so only the target marks the line.
    <div style={{ width: 'fit-content', maxWidth: '100%', margin: '0 auto', color: ink }}>
      {/* The label starts where the line does, so it reads as the line's own. */}
      <div ref={sinkTaps} data-vas-label="" style={{ ...text16, paddingLeft: (anchors === 'beside' ? BESIDE_ANCHOR_PX : 0) + VAS_OVERSHOOT_PX }}>{label}</div>
      {anchors === 'beside' ? (
        // The end words take the row's full height (padded down to the line), so the row has no strip
        // above or below a word that belongs to nothing.
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <span ref={sinkTaps} style={{ ...text16, width: BESIDE_ANCHOR_PX, flex: 'none', textAlign: 'right', paddingTop: LINE_Y - 11 }}>{left}</span>
          {target}
          <span ref={sinkTaps} style={{ ...text16, width: BESIDE_ANCHOR_PX, flex: 'none', paddingTop: LINE_Y - 11 }}>{right}</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex' }}>{target}</div>
          <div ref={sinkTaps} style={{ ...text16, display: 'flex', justifyContent: 'space-between', gap: 24, padding: `0 ${VAS_OVERSHOOT_PX}px`, marginTop: -4 }}>
            <span>{left}</span>
            <span>{right}</span>
          </div>
        </>
      )}
      {spaceBelow > 0 && <div ref={sinkTaps} data-vas-space="" style={{ height: spaceBelow }} />}
    </div>
  );
}

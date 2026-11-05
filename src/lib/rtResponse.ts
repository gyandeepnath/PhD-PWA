/**
 * What a touch on the reaction field is, by the phase it lands in and its own timestamp.
 *
 * Round 89, audit 86 D15. The response window was closed by a poll: the trial loop checked
 * `now() - start >= window` once per animation frame, so for up to one frame past the window the phase
 * still read 'stimulus' and the touch was taken as a response. Its latency then exceeded the window,
 * and the trial loop, reading a latency outside [0, window] as a clock fault, recorded the trial as a
 * FALSE START with no time — "a response made before the stimulus appeared" — for a touch made after it
 * had gone. The audit's run tapped 120-128 ms after onset against the harness's 120 ms window and got
 * ten such false starts in forty trials; in production (1,000 ms) the band is one frame, about 7 ms at
 * 144 Hz, 17 ms at 60 Hz. The window now closes at its deadline, judged on the touch's own timestamp
 * against the onset (the same performance clock): a touch after it is ignored, as a touch between
 * trials always was, and the trial is a miss or a correct rejection with false_start FALSE. A touch
 * inside the window is taken exactly as before, with exactly its own timestamp. Versioned:
 * RT_WINDOW_VERSION, rt_window_version in 02_conditions.csv.
 */
export type RtTouch = 'false_start' | 'response' | 'ignored';

/** The rule in force: 'rw-v2', the window closed at its deadline (Round 89). */
export const RT_WINDOW_VERSION = 'rw-v2';
/** Rows recorded before the stamp existed: the window closed at the first frame past it. */
export const RT_WINDOW_VERSION_V1 = 'rw-v1';

export function classifyRtTouch(
  phase: string, touchAt: number, onsetAt: number, windowMs: number, alreadyResponded: boolean,
): RtTouch {
  if (phase === 'fixation' || phase === 'delay') return 'false_start';
  if (phase !== 'stimulus' || alreadyResponded) return 'ignored';
  const latency = touchAt - onsetAt;
  return latency >= 0 && latency <= windowMs ? 'response' : 'ignored';
}

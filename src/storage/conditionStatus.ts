/**
 * Whether a condition-run FINISHED — the one definition every consumer of condition data uses.
 *
 * THE DEFECT THIS EXISTS FOR. A condition row is created when the condition starts, and each stage
 * writes its own rows as it completes: reading and eye metrics, then comprehension, perception,
 * post-condition fatigue, visual search, and finally the reaction-time block, which stamps
 * `completed_at`. Nothing downstream ever read that stamp. So a condition PAUSED part-way — which
 * the Pause dialog itself says "will be restarted on resume" — was displayed on the dashboard,
 * averaged into its charts and cohort view, and exported by both export products exactly as if it
 * were a finished measurement. The investigator found it by pausing a sitting and opening the
 * dashboard. A sitting paused in its tenth condition and never resumed went further: the pooled file
 * counted ten condition rows, passed the complete-case check, and marked the participant
 * `analysable = TRUE` — including when the tenth row was entirely empty.
 *
 * `completed_at` is the right signal because it is written in the same handler that commits the
 * last measurement of the run, and nowhere else. It is null on a condition that was started and not
 * finished, whatever the reason: a pause, a crash, a withdrawal, a tab closed mid-task.
 *
 * Incomplete rows are NOT deleted. The standing rule in this codebase is to pass data through and
 * carry a flag; a paused condition's reading exposure may be perfectly good ocular data that an
 * analyst chooses to use in a sensitivity analysis. What changes is that nothing presents it as a
 * finished condition any more.
 */
export function isConditionComplete(c: { completed_at?: number | null }): boolean {
  return typeof c.completed_at === 'number' && Number.isFinite(c.completed_at);
}

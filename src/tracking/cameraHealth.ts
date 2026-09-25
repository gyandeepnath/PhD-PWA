/**
 * Is the camera seeing anything, and is it seeing the participant? — judged frame by frame.
 *
 * WHY THIS EXISTS. The investigator "closed the camera" mid-task and nothing happened. Covering the
 * lens, or the Android camera-privacy switch (which gives apps a blank feed rather than ending the
 * stream), keeps frames arriving — just black. The face tracker returns a result for every one of them,
 * with no face in it, so the stall watchdog (cameraLiveness.ts), which fires only when results STOP,
 * never fired, and a reading exposure was written as camera_active TRUE over a black image. A face
 * that is simply out of view (the participant leaned away, a hand over the face) was likewise
 * surfaced nowhere as it happened.
 *
 * Two states, judged from the frame's own pixels, which are already read every frame for lighting QC:
 *
 *   BLOCKED — mean luminance below `blockedLuma` AND spread below `blockedStd`, continuously for
 *   `blockedMs`. Both conditions, because a dim room is dark but not flat. Clears after `recoverMs`
 *   of normal frames: uncovering the lens restores the picture without restarting anything.
 *
 *   NO FACE — no face in a frame that is not blocked. Counted as an episode once it lasts
 *   `episodeMs`; the longest and the count are recorded per condition.
 *
 * The thresholds are ENGINEERING bounds for "the sensor sees nothing", not methodological ones: a
 * blank or covered feed is near 0 on a 0-255 scale with almost no variation, while a face lit at the
 * protocol's 300 lux reads far above both. Pure and injectable so it can be tested without a camera.
 */
export interface CameraHealthConfig {
  blockedLuma: number;
  blockedStd: number;
  blockedMs: number;
  recoverMs: number;
  episodeMs: number;
}

export const CAMERA_HEALTH_DEFAULTS: CameraHealthConfig = {
  blockedLuma: 15,
  blockedStd: 6,
  blockedMs: 3000,
  recoverMs: 1000,
  episodeMs: 2000,
};

export interface FrameObservation {
  /** Monotonic time of the frame, ms. */
  t: number;
  /** Mean luminance 0-255, or null when the frame could not be read. */
  luma: number | null;
  /** Spatial standard deviation of luminance, or null. */
  lumaStd: number | null;
  face: boolean;
}

export interface CameraHealthCounts {
  /** Time the feed was judged blocked (covered / switched off), ms. */
  blockedMs: number;
  /** Longest continuous stretch with no face in an unblocked feed, ms. */
  noFaceLongestMs: number;
  /** Stretches with no face lasting at least `episodeMs`. */
  noFaceEpisodes: number;
}

export class CameraHealth {
  private darkSince: number | null = null;
  private lightSince: number | null = null;
  private blocked = false;
  private blockedStartedAt: number | null = null;
  private noFaceSince: number | null = null;
  private lastT: number | null = null;
  private counts: CameraHealthCounts = { blockedMs: 0, noFaceLongestMs: 0, noFaceEpisodes: 0 };

  constructor(private readonly cfg: CameraHealthConfig = CAMERA_HEALTH_DEFAULTS) {}

  /** Feed one frame. Returns true when the blocked state CHANGED on this frame. */
  observe(f: FrameObservation): boolean {
    const was = this.blocked;
    const dark = f.luma != null && f.lumaStd != null
      && f.luma < this.cfg.blockedLuma && f.lumaStd < this.cfg.blockedStd;

    if (dark) {
      this.lightSince = null;
      if (this.darkSince == null) this.darkSince = f.t;
      if (!this.blocked && f.t - this.darkSince >= this.cfg.blockedMs) {
        this.blocked = true;
        this.blockedStartedAt = this.darkSince;
      }
    } else {
      this.darkSince = null;
      if (this.blocked) {
        if (this.lightSince == null) this.lightSince = f.t;
        if (f.t - this.lightSince >= this.cfg.recoverMs) {
          this.blocked = false;
          this.counts.blockedMs += this.lightSince - (this.blockedStartedAt ?? this.lightSince);
          this.blockedStartedAt = null;
          this.lightSince = null;
        }
      }
    }

    // A blocked feed has no face by construction; that is the blocked state, not a missing face.
    if (!f.face && !this.blocked && !dark) {
      if (this.noFaceSince == null) this.noFaceSince = f.t;
    } else if (this.noFaceSince != null) {
      this.closeNoFace(this.lastT ?? f.t);
    }
    this.lastT = f.t;
    return this.blocked !== was;
  }

  private closeNoFace(end: number): void {
    if (this.noFaceSince == null) return;
    const d = Math.max(0, end - this.noFaceSince);
    this.counts.noFaceLongestMs = Math.max(this.counts.noFaceLongestMs, d);
    if (d >= this.cfg.episodeMs) this.counts.noFaceEpisodes += 1;
    this.noFaceSince = null;
  }

  isBlocked(): boolean {
    return this.blocked;
  }

  /** How long the face has been missing right now, ms; 0 when a face is in view or the feed is blocked. */
  noFaceForMs(now: number): number {
    return this.noFaceSince == null ? 0 : Math.max(0, now - this.noFaceSince);
  }

  /** Counts since the last reset, closing any open stretch at `now` without ending it. */
  read(now: number): CameraHealthCounts {
    const c = { ...this.counts };
    if (this.noFaceSince != null) {
      const d = Math.max(0, now - this.noFaceSince);
      c.noFaceLongestMs = Math.max(c.noFaceLongestMs, d);
      if (d >= this.cfg.episodeMs) c.noFaceEpisodes += 1;
    }
    if (this.blocked && this.blockedStartedAt != null) c.blockedMs += Math.max(0, now - this.blockedStartedAt);
    return c;
  }

  /** Start counting afresh (a new condition) without forgetting whether the feed is blocked now. */
  resetCounts(now: number): void {
    this.counts = { blockedMs: 0, noFaceLongestMs: 0, noFaceEpisodes: 0 };
    if (this.blocked) this.blockedStartedAt = now;
    if (this.noFaceSince != null) this.noFaceSince = now;
  }
}

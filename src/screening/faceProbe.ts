/**
 * Detect a face in the camera preview, and report whether the tracker can run at all.
 *
 * Three documents tell the operator to verify a face box before the session — OPERATOR_MANUAL's
 * bench checklist, and DEPLOYMENT's device-setup and offline-readiness steps. There was no face box
 * and no face detection: the preview rendered a raw video with a hard-coded chip reading "Camera
 * active", so the operator ticked a box that verified nothing.
 *
 * That matters beyond the wording. MediaPipe is not imported until tracking starts, which happens
 * AFTER the preview is torn down, so a device whose model files did not precache — the deployment
 * doc admits this can happen on a 17 MB precache in aeroplane mode — passed every documented check
 * and then collected a whole study with no ocular data. Running FaceMesh here makes the preview the
 * probe: if the model cannot load, the operator finds out before the participant is in the chair.
 *
 * Reports absence honestly: `status` is 'loading' until the model answers, and 'unavailable' when
 * it cannot be loaded at all — never a green tick on an unanswered question.
 */
import { faceEar } from '@/tracking/blink';
import { loadFaceMesh, faceMeshAssetPath } from '@/tracking/faceMeshLoader';

export type FaceProbeStatus = 'loading' | 'searching' | 'detected' | 'unavailable';

export interface FaceProbeResult {
  status: FaceProbeStatus;
  /** Normalised bounding box of the detected face, for drawing. Null until one is found. */
  box: { x: number; y: number; w: number; h: number } | null;
  /** Mean eye-aspect-ratio of the detected face — a live check that the eye landmarks are usable. */
  ear: number | null;
  /** Why the model could not be loaded, when status is 'unavailable'. */
  error: string | null;
}

export interface FaceProbeHandle {
  stop: () => void;
}

/**
 * Start probing. Calls `onUpdate` as the state changes; the caller stops it when the preview closes.
 */
export function startFaceProbe(
  video: HTMLVideoElement,
  onUpdate: (r: FaceProbeResult) => void,
): FaceProbeHandle {
  let stopped = false;
  let raf = 0;
  let lastEmit = '';

  const emit = (r: FaceProbeResult) => {
    // Only push a change, so the caller is not re-rendered on every frame.
    const key = `${r.status}|${r.box ? Math.round(r.box.x * 100) + ',' + Math.round(r.box.y * 100) : '-'}`;
    if (key === lastEmit) return;
    lastEmit = key;
    onUpdate(r);
  };

  emit({ status: 'loading', box: null, ear: null, error: null });

  void (async () => {
    try {
      // Same loader and the same base-relative asset resolution as the tracker, so the probe
      // exercises exactly the code path the session will use. Sharing it is the point: when the
      // two had their own copies of this import, one packaging quirk broke both identically and
      // the probe reported the failure it was built to catch only after the build reached a device.
      const FaceMeshCtor = await loadFaceMesh();
      if (stopped) return;
      const fm = new FaceMeshCtor({ locateFile: faceMeshAssetPath });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

      fm.onResults((r) => {
        if (stopped) return;
        const lm = r.multiFaceLandmarks?.[0];
        if (!lm || lm.length === 0) {
          emit({ status: 'searching', box: null, ear: null, error: null });
          return;
        }
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (const p of lm) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const ear = faceEar(lm);
        emit({
          status: 'detected',
          box: { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) },
          ear: Number.isFinite(ear) ? ear : null,
          error: null,
        });
      });

      emit({ status: 'searching', box: null, ear: null, error: null });

      const pump = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          try { await fm.send({ image: video }); } catch { /* transient frame error */ }
        }
        raf = requestAnimationFrame(pump);
      };
      raf = requestAnimationFrame(pump);
    } catch (err) {
      if (stopped) return;
      emit({
        status: 'unavailable',
        box: null,
        ear: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}

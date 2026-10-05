// Vitest global setup. fake-indexeddb is imported by storage tests that need it.
import 'fake-indexeddb/auto';

// jsdom has no canvas: getContext returns null after printing "Not implemented". The live camera
// overlay and the eye-openness trace (components/LiveCamera.tsx) already treat a null context as
// "draw nothing", so the stub only removes the noise.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

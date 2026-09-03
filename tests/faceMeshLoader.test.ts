/**
 * The FaceMesh constructor must be found whichever way the bundler exposed it.
 *
 * These cases are not hypothetical. `@mediapipe/face_mesh` is Closure-compiled and assigns its
 * symbols with `var wa = this || self`, so where the constructor lands depends entirely on how the
 * file was loaded. The dev server (esbuild, CommonJS interop) puts it on the module exports; the
 * production build (Rollup, ESM) leaves the namespace empty and puts it on the global. The app read
 * `mod.FaceMesh` directly, which is correct for exactly one of those, and the other is the one that
 * ships. A device reported `c.FaceMesh is not a constructor` after the full gate had passed green.
 *
 * Each test below is one real bundler shape.
 */
import { describe, it, expect } from 'vitest';
import { resolveFaceMeshCtor } from '@/tracking/faceMeshLoader';

class FakeFaceMesh {
  setOptions() {}
  onResults() {}
  async send() {}
}

const noGlobal = {};

describe('resolveFaceMeshCtor', () => {
  it('finds the constructor on the module namespace (esbuild / CommonJS interop — the dev server)', () => {
    expect(resolveFaceMeshCtor({ FaceMesh: FakeFaceMesh }, noGlobal)).toBe(FakeFaceMesh);
  });

  it('finds the constructor on the global when the namespace is empty (Rollup / ESM — the production build)', () => {
    // This is the exact shape that shipped and failed on the tablet: nothing on the module at all.
    expect(resolveFaceMeshCtor({}, { FaceMesh: FakeFaceMesh })).toBe(FakeFaceMesh);
  });

  it('finds the constructor under a default export (interop that wraps the namespace)', () => {
    expect(resolveFaceMeshCtor({ default: { FaceMesh: FakeFaceMesh } }, noGlobal)).toBe(FakeFaceMesh);
  });

  it('accepts a default export that is itself the constructor', () => {
    expect(resolveFaceMeshCtor({ default: FakeFaceMesh }, noGlobal)).toBe(FakeFaceMesh);
  });

  it('prefers the module namespace over the global when both are populated', () => {
    class Other { }
    // Not arbitrary: if a previous page load left a stale constructor on the global, the freshly
    // imported one is the one that matches the assets this build will fetch.
    expect(resolveFaceMeshCtor({ FaceMesh: FakeFaceMesh }, { FaceMesh: Other })).toBe(FakeFaceMesh);
  });

  it('throws rather than returning a non-constructor when the export is present but wrong', () => {
    // `mod.FaceMesh` existing is not the same as it being usable. Returning it here is what
    // produced "is not a constructor" at the `new` site, one stack frame away from any context.
    expect(() => resolveFaceMeshCtor({ FaceMesh: 'not-a-function' }, noGlobal)).toThrow(/not found/i);
  });

  it('names every slot it checked, so a new bundler shape is diagnosable from the message alone', () => {
    let message = '';
    try {
      resolveFaceMeshCtor({ FaceMesh: undefined }, noGlobal);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain('module.FaceMesh=undefined');
    expect(message).toContain('globalThis.FaceMesh=undefined');
  });

  it('survives a null or undefined module without throwing the wrong error', () => {
    expect(() => resolveFaceMeshCtor(null, noGlobal)).toThrow(/not found/i);
    expect(() => resolveFaceMeshCtor(undefined, undefined)).toThrow(/not found/i);
  });
});

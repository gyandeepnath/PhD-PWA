/**
 * Obtain the FaceMesh constructor, whichever way the bundler happened to expose it.
 *
 * WHY THIS FILE EXISTS. `@mediapipe/face_mesh` is a Closure-compiled bundle that publishes its
 * symbols onto a global, not onto a module export. The relevant line inside it is:
 *
 *     var wa = this || self;   ...   P("FaceMesh", ctor)   // assigns wa.FaceMesh
 *
 * `this` at the top of that IIFE depends entirely on how the file was loaded:
 *
 *   - Vite dev server: esbuild pre-bundles it as CommonJS, so `this` is the module's exports
 *     object and `mod.FaceMesh` exists. Everything works.
 *   - Production build: the package sets `"module": "face_mesh.js"`, so Rollup treats it as ESM.
 *     `this` is `undefined` at ESM top level, so `wa` falls through to `self` and the constructor
 *     lands on `window`. The module namespace is EMPTY and `mod.FaceMesh` is undefined.
 *
 * The result was `c.FaceMesh is not a constructor` on a real device — after every unit test, every
 * end-to-end test and the whole verification gate had passed, because nothing ever loaded this
 * module from a production bundle in a real browser. The failure mode is the worst kind available
 * here: the app carries on, the operator is told tracking is unavailable, and a session runs to
 * completion with the primary outcome empty for every condition.
 *
 * Both callers went through their own copy of this import, which is how a single packaging quirk
 * became two identical latent bugs. There is now one path, and `tests/faceMeshLoader.test.ts` plus
 * the production-bundle end-to-end check guard it.
 */

/** The shape of the constructor this project uses. Narrower than the package's own typings. */
export interface FaceMeshLike {
  setOptions: (o: Record<string, unknown>) => void;
  onResults: (cb: (r: { multiFaceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>> }) => void) => void;
  send: (i: { image: HTMLVideoElement }) => Promise<void>;
  close?: () => void;
}

export type FaceMeshCtor = new (cfg: { locateFile: (f: string) => string }) => FaceMeshLike;

/** Every place the constructor is known to end up, in the order it is worth looking. */
type Candidate = { where: string; value: unknown };

/**
 * Pull the constructor out of an already-imported module namespace and the global scope.
 *
 * Exported separately from `loadFaceMesh` so it can be unit-tested against each bundler shape
 * without a real dynamic import — the shapes are the whole point, and they are what broke.
 */
export function resolveFaceMeshCtor(mod: unknown, globalScope: unknown = globalThis): FaceMeshCtor {
  const m = mod as Record<string, unknown> | null | undefined;
  const g = globalScope as Record<string, unknown> | null | undefined;
  const def = m?.default as Record<string, unknown> | undefined;

  const candidates: Candidate[] = [
    { where: 'module.FaceMesh', value: m?.FaceMesh },
    { where: 'module.default.FaceMesh', value: def?.FaceMesh },
    // The default export may itself BE the constructor under some interop settings.
    { where: 'module.default', value: def },
    { where: 'globalThis.FaceMesh', value: g?.FaceMesh },
  ];

  for (const c of candidates) {
    if (typeof c.value === 'function') return c.value as FaceMeshCtor;
  }

  // Report what was actually there. A bare "not a constructor" cost a field session; the next
  // person to hit a new bundler shape should be able to see which slots were populated.
  const seen = candidates.map((c) => `${c.where}=${describe(c.value)}`).join(', ');
  throw new Error(`FaceMesh constructor not found in the loaded module or global scope (${seen})`);
}

function describe(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  return typeof v;
}

/**
 * Import the model wrapper and return its constructor.
 *
 * Throws with a readable message rather than returning a broken value: callers surface the message
 * to the operator, and "not a constructor" told them nothing they could act on.
 */
export async function loadFaceMesh(): Promise<FaceMeshCtor> {
  const mod = await import('@mediapipe/face_mesh');
  return resolveFaceMeshCtor(mod);
}

/**
 * Where the model's own asset files live.
 *
 * Base-relative on purpose: a root-absolute path 404s on a subdirectory deployment, which is
 * exactly how this app is served from GitHub Pages.
 */
export function faceMeshAssetPath(file: string): string {
  const base = new URL(import.meta.env.BASE_URL ?? './', document.baseURI);
  return new URL(`mediapipe/${file}`, base).toString();
}

/**
 * Resume persistence. Stores a coarse, condition-level resume pointer in localStorage so an
 * interrupted in-progress session can be continued from the start of the next condition (matching
 * the original build's "resume at the beginning of the next condition to ensure data integrity" —
 * a partially-completed condition is discarded rather than stitched together).
 */
const KEY = 'visulab_resume';

export interface ResumePointer {
  sessionId: string;
  /** Condition index to resume at (0-based). >= 8 means proceed to the end questionnaire. */
  nextStepIndex: number;
  savedAt: number;
}

function available(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function saveResume(sessionId: string, nextStepIndex: number): void {
  if (!available()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ sessionId, nextStepIndex, savedAt: Date.now() }));
  } catch {
    /* storage full / disabled — resume simply won't be available */
  }
}

export function loadResume(): ResumePointer | null {
  if (!available()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ResumePointer;
    if (typeof p.sessionId === 'string' && typeof p.nextStepIndex === 'number') return p;
    return null;
  } catch {
    return null;
  }
}

export function clearResume(sessionId?: string): void {
  if (!available()) return;
  try {
    if (sessionId) {
      const cur = loadResume();
      if (cur && cur.sessionId !== sessionId) return; // don't clear someone else's pointer
    }
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

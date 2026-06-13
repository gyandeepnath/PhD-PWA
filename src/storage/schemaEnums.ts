/** Shared enums/type aliases used across the data model (kept separate to avoid cycles). */
export type { Polarity } from '@/experiment/conditions';
export type { WcagLevel } from '@/lib/contrast';

/** Current IndexedDB schema version. v1-5 = original; v6 adds the audit refinement fields. */
export const DB_NAME = 'VisualErgonomicsDB';
export const DB_VERSION = 6;

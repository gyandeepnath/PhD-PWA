/** Shared enums/type aliases used across the data model (kept separate to avoid cycles). */
export type { Polarity } from '@/experiment/conditions';
export type { WcagLevel } from '@/lib/contrast';

/** Current IndexedDB schema version. v1-5 = original; v6 added audit fields; v7 added session
 *  status + soft-delete (deleted_at) + display_label for the session manager. */
export const DB_NAME = 'VisualErgonomicsDB';
export const DB_VERSION = 7;

/** Shared enums/type aliases used across the data model (kept separate to avoid cycles). */
export type { Polarity } from '@/experiment/conditions';
export type { WcagLevel } from '@/lib/contrast';

/** Current IndexedDB schema version. v1-5 = original; v6 added audit fields; v7 added session
 *  status + soft-delete (deleted_at) + display_label for the session manager. */
export const DB_NAME = 'VisualErgonomicsDB';
/**
 * Bumped to 9 for the media_captures object store and the per-session media_consent grants.
 *
 * Bumped to 8 for the nasa_tlx object store, and for the session-record fields that carry the
 * two-level illumination factor (illumination_block, illumination_order_first, lux_readings,
 * lux_all_in_range, lux_deviation_note). The upgrade is purely additive — existing stores and
 * records are untouched, so a device holding pilot data keeps it and simply gains the new store.
 */
export const DB_VERSION = 9;

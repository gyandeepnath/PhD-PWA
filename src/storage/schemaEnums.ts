/** Shared enums/type aliases used across the data model (kept separate to avoid cycles). */
export type { Polarity } from '@/experiment/conditions';
export type { WcagLevel } from '@/lib/contrast';

/** Current IndexedDB schema version. v1-5 = original; v6 added audit fields; v7 added session
 *  status + soft-delete (deleted_at) + display_label for the session manager. */
export const DB_NAME = 'VisualErgonomicsDB';
/**
 * Bumped to 11 to re-key ocular_events (Round 80 fix). Build 6ffc2c7, which was deployed, created the
 * store keyed on condition_id; 005ab45 changed the key to record_id (so the camera self-test's record,
 * 'selftest:' + session_id, can live beside the reading records) without bumping the version. On a
 * device that opened 6ffc2c7, the store kept the old key, and writing a self-test record — which has no
 * condition_id — failed, so every camera sitting stopped when its camera check was accepted. Version 11
 * rebuilds the store under record_id and carries every existing row across (db.ts upgrade).
 *
 * Bumped to 10 for the ocular_events store (Round 78): each reading window's blinks and per-frame
 * eye-openness trace. Additive, like every bump before it.
 *
 * Bumped to 9 for the media_captures object store and the per-session media_consent grants.
 *
 * Bumped to 8 for the nasa_tlx object store, and for the session-record fields that carry the
 * two-level illumination factor (illumination_block, illumination_order_first, lux_readings,
 * lux_all_in_range, lux_deviation_note). The upgrade is purely additive — existing stores and
 * records are untouched, so a device holding pilot data keeps it and simply gains the new store.
 */
export const DB_VERSION = 11;

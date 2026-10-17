/**
 * "Deep history": music from the owner's NAS archive that predates consistent
 * Last.fm scrobbling (music-cms-mvp migration 014 and its one-off import).
 * Those artists, albums and tracks carry deep_history=true, have no plays and
 * are also tagged "deep history".
 *
 * Track filters use the track's own flag, which the import sets on every track
 * of a flagged album: filtering through album.deep_history joins all ~137k
 * tracks and times out.
 */

import { z } from "zod";

export const deepHistoryParam = z
	.boolean()
	.optional()
	.describe("true: only deep history (pre-Last.fm archive music, never scrobbled); false: leave it out; omit for everything");

/**
 * Filter clause for the deep_history option, or null when it isn't set.
 * Excluding uses "!=true" on purpose: with "=false" SQLite walks the
 * deep_history index across ~98% of tracks (seconds) instead of using a
 * selective index such as play_count.
 */
export function deepHistoryFilter(deep_history: boolean | undefined): string | null {
	if (deep_history === undefined) return null;
	return deep_history ? "deep_history=true" : "deep_history!=true";
}

/** Spread into a result: marks deep history records, adds nothing otherwise. */
export function deepHistoryMark(rec: { deep_history?: boolean }): { deep_history?: true } {
	return rec.deep_history ? { deep_history: true } : {};
}

/** One-line explanation for tool descriptions. */
export const DEEP_HISTORY_NOTE =
	"Deep history items (deep_history: true) come from the owner's music archive, from before consistent scrobbling: they have no plays, so play-count filters and sorts treat them as never played.";

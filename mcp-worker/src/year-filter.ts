/**
 * Year-range filters for PocketBase queries.
 *
 * An album's year is albums.release_year, filled in by the sync service's
 * MusicBrainz enrichment. Albums it hasn't reached yet have 0 there, so a
 * Last.fm year tag such as "1997" counts instead. The filter matches either.
 */

import type { PocketBase } from "./pocketbase";
import { pbString } from "./pocketbase";

const YEAR_TAG = /^(19|20)\d\d$/;
const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; ids: Map<number, string> } | null = null;

/** Year tag ids by year, one request per hour per isolate. */
async function yearTagIds(pb: PocketBase): Promise<Map<number, string>> {
	if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
	const res = await pb.list<{ id: string; name: string }>("tags", {
		filter: 'name>="1900" && name<="2099"',
		fields: "id,name",
		perPage: 500,
		skipTotal: true,
	});
	const ids = new Map(res.items.filter((t) => YEAR_TAG.test(t.name)).map((t) => [Number(t.name), t.id]));
	cache = { at: Date.now(), ids };
	return ids;
}

export type YearRange = { min_year?: number; max_year?: number };

/**
 * A filter expression matching albums (prefix "") or tracks (prefix "album.")
 * released between min_year and max_year inclusive, or null if no range is set.
 */
export async function yearFilter(pb: PocketBase, range: YearRange, prefix: "" | "album." = ""): Promise<string | null> {
	const { min_year: lo, max_year: hi } = range;
	if (lo === undefined && hi === undefined) return null;
	const from = lo ?? 1900;
	const to = hi ?? 2099;
	if (from > to) throw new Error(`min_year (${from}) is after max_year (${to})`);

	const field = `${prefix}release_year`;
	const byField = `(${field}>=${from} && ${field}<=${to})`;
	const tags = [...(await yearTagIds(pb)).entries()].filter(([y]) => y >= from && y <= to).map(([, id]) => id);
	if (tags.length === 0) return byField;
	const byTag = tags.map((id) => `${prefix}tag_relations~${pbString(id)}`).join(" || ");
	return `(${byField} || (${field}=0 && (${byTag})))`;
}

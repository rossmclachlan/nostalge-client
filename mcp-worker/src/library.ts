/**
 * Read-only library queries over the music-cms-mvp PocketBase schema
 * (see music-cms-mvp/pocketbase/pb_migrations):
 *
 *   artists  name, mbid, play_count, tags(json), tag_relations -> tags[]
 *   albums   title, artist -> artists, release_year, play_count, track_count,
 *            wiki_summary, tags(json), tag_relations -> tags[]
 *   tracks   title, artist -> artists, album -> albums, duration_ms, play_count,
 *            first_played_at, last_played_at (play stats derived from scrobbles)
 *   tags     name (unique), slug (unique), usage_count
 *
 * artists, albums and tracks also have source and deep_history (see
 * deep-history.ts).
 *
 * There are no "crates" or "releases" collections. Matching the app's Crates
 * tab, a crate is an album, and an album is the release.
 */

import { type PocketBase, PocketBaseError, pbString } from "./pocketbase";
import { type YearRange, yearFilter } from "./year-filter";
import { deepHistoryFilter, deepHistoryMark } from "./deep-history";
import { resolveTags, type TagListOptions, tagListPaging } from "./tags";

type Base = { id: string; created: string; updated: string };
type TagRec = Base & { name: string; slug: string; usage_count: number };
type ArtistRec = Base & {
	name: string;
	play_count: number;
	tag_relations: string[];
	expand?: { tag_relations?: TagRec[] };
};
export type AlbumRec = Base & {
	title: string;
	artist: string;
	release_year: number;
	play_count: number;
	track_count: number;
	wiki_summary: string;
	tag_relations: string[];
	deep_history?: boolean;
	expand?: { artist?: ArtistRec; tag_relations?: TagRec[] };
};
type TrackRec = Base & {
	title: string;
	artist: string;
	album: string;
	duration_ms: number;
	play_count: number;
	first_played_at: string;
	last_played_at: string;
	deep_history?: boolean;
	expand?: { artist?: ArtistRec; album?: AlbumRec };
};

const clamp = (n: number | undefined, def: number, max: number) => Math.max(1, Math.min(n ?? def, max));

/**
 * Release years. albums.release_year is filled in by the sync service's
 * MusicBrainz enrichment, which takes hours to reach every album. Until then
 * a Last.fm year tag such as "1997" stands in, marked year_source "tag".
 */
const YEAR_TAG = /^(19|20)\d\d$/;
const YEAR_TAG_TTL_MS = 60 * 60 * 1000;
let yearTagCache: { at: number; byId: Map<string, number> } | null = null;

/** Year tags by id, one request per hour per isolate. */
async function yearTagsById(pb: PocketBase): Promise<Map<string, number>> {
	if (yearTagCache && Date.now() - yearTagCache.at < YEAR_TAG_TTL_MS) return yearTagCache.byId;
	const res = await pb.list<TagRec>("tags", {
		filter: 'name>="1900" && name<="2099"',
		fields: "id,name",
		perPage: 500,
		skipTotal: true,
	});
	const byId = new Map(res.items.filter((t) => YEAR_TAG.test(t.name)).map((t) => [t.id, Number(t.name)]));
	yearTagCache = { at: Date.now(), byId };
	return byId;
}

type YearSource = { release_year?: number; tag_relations?: string[]; expand?: { tag_relations?: TagRec[] } };

function albumYear(a: YearSource | undefined, byId?: Map<string, number>): { release_year: number | null; year_source?: "tag" } {
	if (a?.release_year) return { release_year: a.release_year };
	const fromNames = (a?.expand?.tag_relations ?? []).map((t) => t.name).find((n) => YEAR_TAG.test(n));
	if (fromNames) return { release_year: Number(fromNames), year_source: "tag" };
	const fromIds = byId ? (a?.tag_relations ?? []).map((id) => byId.get(id)).find((y) => y !== undefined) : undefined;
	return fromIds ? { release_year: fromIds, year_source: "tag" } : { release_year: null };
}

/** track(), plus the year of the track's release. */
async function tracksWithYears(pb: PocketBase): Promise<(t: TrackRec) => ReturnType<typeof track> & ReturnType<typeof albumYear>> {
	const byId = await yearTagsById(pb);
	return (t) => ({ ...track(t), ...albumYear(t.expand?.album, byId) });
}

export function release(a: AlbumRec) {
	return {
		id: a.id,
		title: a.title,
		artist: a.expand?.artist?.name ?? null,
		artist_id: a.artist || null,
		...albumYear(a),
		play_count: a.play_count ?? 0,
		track_count: a.track_count ?? 0,
		tags: (a.expand?.tag_relations ?? []).map((t) => t.name),
		...deepHistoryMark(a),
	};
}

function track(t: TrackRec) {
	return {
		id: t.id,
		title: t.title,
		artist: t.expand?.artist?.name ?? null,
		album: t.expand?.album?.title ?? null,
		album_id: t.album || null,
		duration_s: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
		play_count: t.play_count ?? 0,
		first_played: t.first_played_at ? t.first_played_at.slice(0, 10) : null,
		last_played: t.last_played_at ? t.last_played_at.slice(0, 10) : null,
		...deepHistoryMark(t),
	};
}

/** Matched artists/albums whose tracks a search also returns; keeps the filter short. */
const SEARCH_FAN_OUT = 10;

/**
 * Two steps, because a filter like `artist.name~"x"` on tracks makes
 * PocketBase join artists for every one of ~130k tracks, which took 10-25s.
 * First match the small artists/albums tables by name, then fetch albums and
 * tracks by those ids (indexed) or by their own title.
 */
export async function searchLibrary(pb: PocketBase, query: string, limit?: number) {
	const q = pbString(query.trim());
	const perPage = clamp(limit, 10, 50);
	const [artists, albumsByTitle] = await Promise.all([
		pb.list<ArtistRec>("artists", { filter: `name~${q}`, sort: "-play_count", perPage, skipTotal: true }),
		pb.list<AlbumRec>("albums", {
			filter: `title~${q}`,
			sort: "-play_count",
			expand: "artist,tag_relations",
			perPage,
			skipTotal: true,
		}),
	]);

	const anyOf = (field: string, ids: string[]) => ids.map((id) => `${field}=${pbString(id)}`);
	const artistIds = artists.items.slice(0, SEARCH_FAN_OUT).map((a) => a.id);
	const albumIds = albumsByTitle.items.slice(0, SEARCH_FAN_OUT).map((a) => a.id);
	const [albumsByArtist, tracks] = await Promise.all([
		artistIds.length
			? pb.list<AlbumRec>("albums", {
					filter: anyOf("artist", artistIds).join(" || "),
					sort: "-play_count",
					expand: "artist,tag_relations",
					perPage,
					skipTotal: true,
				})
			: Promise.resolve({ items: [] as AlbumRec[] }),
		pb.list<TrackRec>("tracks", {
			filter: [`title~${q}`, ...anyOf("artist", artistIds), ...anyOf("album", albumIds)].join(" || "),
			sort: "-play_count",
			expand: "artist,album",
			perPage,
			skipTotal: true,
		}),
	]);

	const releases = new Map([...albumsByTitle.items, ...albumsByArtist.items].map((a) => [a.id, a]));
	return {
		artists: artists.items.map((a) => ({ id: a.id, name: a.name, play_count: a.play_count ?? 0 })),
		releases: [...releases.values()]
			.sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))
			.slice(0, perPage)
			.map(release),
		tracks: tracks.items.map(await tracksWithYears(pb)),
	};
}

export async function listCrates(
	pb: PocketBase,
	opts: { limit?: number; page?: number; deep_history?: boolean } & YearRange = {},
) {
	const where = [await yearFilter(pb, opts), deepHistoryFilter(opts.deep_history)].filter((w) => w !== null);
	const res = await pb.list<AlbumRec>("albums", {
		...(where.length ? { filter: where.join(" && ") } : {}),
		sort: "-play_count",
		expand: "artist,tag_relations",
		perPage: clamp(opts.limit, 100, 200),
		page: Math.max(1, opts.page ?? 1),
	});
	return {
		page: res.page,
		total_pages: res.totalPages,
		total: res.totalItems,
		crates: res.items.map(release),
	};
}

export async function getCrate(pb: PocketBase, crateId: string) {
	let album: AlbumRec;
	try {
		album = await pb.getOne<AlbumRec>("albums", crateId, "artist,tag_relations");
	} catch (e) {
		if ((e as { status?: number }).status === 404) throw new PocketBaseError(`No crate with id ${crateId}`, 404);
		throw e;
	}
	// No track numbers are stored; creation order follows the imported tracklist.
	const tracks = await pb.list<TrackRec>("tracks", {
		filter: `album=${pbString(album.id)}`,
		sort: "created",
		expand: "artist,album",
		perPage: 200,
		skipTotal: true,
	});
	return {
		...release(album),
		wiki_summary: album.wiki_summary || null,
		tracks: tracks.items.map(await tracksWithYears(pb)),
	};
}

export async function releasesByTag(pb: PocketBase, tag: string, o: TagListOptions = {}) {
	const { found } = await resolveTags(pb, [tag]);
	if (!found[0]) return { tag, found: false, releases: [] };
	const deep = deepHistoryFilter(o.deep_history);
	const tagged = `tag_relations~${pbString(found[0].id)}`;
	const paging = tagListPaging(o, 50, 200);
	const albums = await pb.list<AlbumRec>("albums", {
		filter: deep ? `${tagged} && ${deep}` : tagged,
		expand: "artist,tag_relations",
		...paging.params,
	});
	return { tag: found[0].name, found: true, ...paging.meta(albums), releases: albums.items.map(release) };
}

export const TRACK_SORTS = {
	most_played: "-play_count,-last_played_at",
	least_played: "play_count,last_played_at",
	recently_played: "-last_played_at",
	first_played_newest: "-first_played_at",
	first_played_oldest: "first_played_at",
	longest: "-duration_ms",
	shortest: "duration_ms",
} as const;

export type FindTracksOptions = YearRange & {
	min_plays?: number;
	max_plays?: number;
	min_duration_s?: number;
	max_duration_s?: number;
	/** YYYY-MM-DD, inclusive */
	first_played_from?: string;
	first_played_to?: string;
	last_played_from?: string;
	last_played_to?: string;
	deep_history?: boolean;
	sort?: keyof typeof TRACK_SORTS;
	limit?: number;
	page?: number;
};

/**
 * Tracks filtered by play count, length and when they were first/last played,
 * all indexed columns. Play stats come from scrobbles, so "first played" is
 * the useful stand-in for "date added" (most tracks were bulk-imported).
 */
export async function findTracks(pb: PocketBase, o: FindTracksOptions) {
	const day = (d: string, end: boolean) => pbString(`${d} ${end ? "23:59:59.999Z" : "00:00:00.000Z"}`);
	const where: string[] = [];
	if (o.min_plays !== undefined) where.push(`play_count>=${o.min_plays}`);
	if (o.max_plays !== undefined) where.push(`play_count<=${o.max_plays}`);
	if (o.min_duration_s !== undefined || o.max_duration_s !== undefined) where.push("duration_ms>0");
	if (o.min_duration_s !== undefined) where.push(`duration_ms>=${o.min_duration_s * 1000}`);
	const years = await yearFilter(pb, o, "album.");
	if (years) where.push(years);
	if (o.max_duration_s !== undefined) where.push(`duration_ms<=${o.max_duration_s * 1000}`);
	const deep = deepHistoryFilter(o.deep_history);
	if (deep) where.push(deep);
	for (const [field, from, to] of [
		["first_played_at", o.first_played_from, o.first_played_to],
		["last_played_at", o.last_played_from, o.last_played_to],
	] as const) {
		if (from || to) where.push(`${field}!=""`);
		if (from) where.push(`${field}>=${day(from, false)}`);
		if (to) where.push(`${field}<=${day(to, true)}`);
	}
	const sort = o.sort ?? "most_played";
	// Sorting by a play date only makes sense among tracks that have been played.
	// Only the primary key counts: most_played breaks ties on last_played_at,
	// and must still return never-played tracks (max_plays: 0, deep history).
	if (/played_at/.test(TRACK_SORTS[sort].split(",")[0]) && !where.some((w) => w.startsWith("first_played_at") || w.startsWith("last_played_at"))) {
		where.push("last_played_at!=\"\"");
	}
	if (/duration_ms/.test(TRACK_SORTS[sort]) && !where.includes("duration_ms>0")) where.push("duration_ms>0");

	const res = await pb.list<TrackRec>("tracks", {
		filter: where.join(" && "),
		sort: TRACK_SORTS[sort] + ",id",
		expand: "artist,album",
		perPage: clamp(o.limit, 25, 100),
		page: Math.max(1, o.page ?? 1),
	});
	return { page: res.page, total_pages: res.totalPages, total: res.totalItems, sort, tracks: res.items.map(await tracksWithYears(pb)) };
}

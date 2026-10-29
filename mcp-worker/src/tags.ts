/**
 * Tags beyond albums: list them, and find artists and tracks by tag.
 *
 * Tags (Last.fm genre/mood/era tags) are attached to albums and artists via
 * tag_relations. A track has a tag when its album or its artist does.
 */

import { type PocketBase, pbString } from "./pocketbase";
import { deepHistoryFilter, deepHistoryMark } from "./deep-history";

type TagRec = { id: string; name: string; slug: string; usage_count: number };
type ArtistRec = {
	id: string;
	name: string;
	play_count: number;
	tag_relations: string[];
	deep_history?: boolean;
	expand?: { tag_relations?: TagRec[] };
};
type TrackRec = {
	id: string;
	title: string;
	album: string;
	duration_ms: number;
	play_count: number;
	first_played_at: string;
	last_played_at: string;
	deep_history?: boolean;
	expand?: {
		artist?: { name: string; tag_relations: string[] };
		album?: { title: string; release_year: number; tag_relations: string[] };
	};
};

const YEAR_TAG = /^(19|20)\d\d$/;
const clamp = (n: number | undefined, def: number, max: number) => Math.max(1, Math.min(n ?? def, max));

export async function listTags(pb: PocketBase, opts: { query?: string; include_years?: boolean; limit?: number }) {
	const where: string[] = [];
	if (opts.query?.trim()) where.push(`name~${pbString(opts.query.trim())}`);
	const res = await pb.list<TagRec>("tags", {
		filter: where.join(" && "),
		sort: "-usage_count,name",
		fields: "id,name,usage_count",
		perPage: 500,
	});
	const tags = res.items.filter((t) => opts.include_years || !YEAR_TAG.test(t.name));
	const limit = clamp(opts.limit, 200, 500);
	return {
		total: tags.length + (res.totalItems - res.items.length),
		tags: tags.slice(0, limit).map((t) => ({ name: t.name, usage_count: t.usage_count ?? 0 })),
		...(opts.include_years ? {} : { note: "Year tags (e.g. 1997) are left out; pass include_years=true to see them." }),
	};
}

/** Tag names (case-insensitive, or slugs) to records; unknown names are returned separately. */
export async function resolveTags(pb: PocketBase, names: string[]): Promise<{ found: TagRec[]; unknown: string[] }> {
	const found: TagRec[] = [];
	const unknown: string[] = [];
	for (const raw of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
		const slug = raw.toLowerCase().replace(/\s+/g, "-");
		const exact = await pb.list<TagRec>("tags", {
			filter: `(name=${pbString(raw)} || slug=${pbString(slug)})`,
			perPage: 1,
			skipTotal: true,
		});
		let tag = exact.items[0];
		if (!tag) {
			const loose = await pb.list<TagRec>("tags", { filter: `name~${pbString(raw)}`, sort: "-usage_count", perPage: 20, skipTotal: true });
			tag = loose.items.find((t) => t.name.toLowerCase() === raw.toLowerCase())!;
		}
		if (tag) found.push(tag);
		else unknown.push(raw);
	}
	return { found, unknown };
}

/**
 * Sorts for releases_by_tag and artists_by_tag. "Added" is the record's
 * creation: albums and artists after the first bulk import are created by the
 * sync service when they're first scrobbled, or by the deep history import.
 */
export const TAG_LIST_SORTS = {
	most_played: "-play_count",
	least_played: "play_count",
	recently_added: "-created",
	random: "@random",
} as const;
export type TagListSort = keyof typeof TAG_LIST_SORTS;

export type TagListOptions = { sort?: TagListSort; limit?: number; page?: number; deep_history?: boolean };

/** list() params and result fields shared by the tag listings. Random ignores the page: each call is a fresh sample. */
export function tagListPaging(o: TagListOptions, def: number, max: number) {
	const sort = o.sort ?? "most_played";
	const random = sort === "random";
	const page = random ? 1 : Math.max(1, o.page ?? 1);
	return {
		sort,
		params: { sort: random ? "@random" : `${TAG_LIST_SORTS[sort]},id`, perPage: clamp(o.limit, def, max), page },
		meta: (res: { page: number; totalPages: number; totalItems: number }) => ({
			sort,
			total: res.totalItems,
			...(random ? { note: "Random order: each call is a fresh sample, so page doesn't apply." } : { page: res.page, total_pages: res.totalPages }),
		}),
	};
}

export async function artistsByTag(pb: PocketBase, tag: string, o: TagListOptions = {}) {
	const { found } = await resolveTags(pb, [tag]);
	if (!found[0]) return { tag, found: false, artists: [] };
	const deep = deepHistoryFilter(o.deep_history);
	const tagged = `tag_relations~${pbString(found[0].id)}`;
	const paging = tagListPaging(o, 50, 200);
	const res = await pb.list<ArtistRec>("artists", {
		filter: deep ? `${tagged} && ${deep}` : tagged,
		expand: "tag_relations",
		...paging.params,
	});
	return {
		tag: found[0].name,
		found: true,
		...paging.meta(res),
		artists: res.items.map((a) => ({
			id: a.id,
			name: a.name,
			play_count: a.play_count ?? 0,
			tags: (a.expand?.tag_relations ?? []).map((t) => t.name),
			...deepHistoryMark(a),
		})),
	};
}

export const TAG_TRACK_SORTS = {
	most_played: "-play_count,-last_played_at",
	recently_played: "-last_played_at",
	least_played: "play_count,last_played_at",
	// Most tracks came from one bulk import, so the first play stands in for "added".
	recently_added: "-first_played_at",
	random: "@random",
} as const;

/** Sorts by a play date leave out tracks without one. */
const TAG_TRACK_SORT_NEEDS: Partial<Record<keyof typeof TAG_TRACK_SORTS, string>> = {
	recently_played: 'last_played_at!=""',
	recently_added: 'first_played_at!=""',
};

export async function tracksByTag(
	pb: PocketBase,
	opts: { tags: string[]; match_all?: boolean; deep_history?: boolean; sort?: keyof typeof TAG_TRACK_SORTS; limit?: number; page?: number },
) {
	const { found, unknown } = await resolveTags(pb, opts.tags);
	if (found.length === 0 || (opts.match_all && unknown.length)) {
		return { tags: found.map((t) => t.name), unknown_tags: unknown, has_more: false, tracks: [] };
	}
	// One condition per tag: on the track's album or its artist.
	const has = (t: TagRec) => `(album.tag_relations~${pbString(t.id)} || artist.tag_relations~${pbString(t.id)})`;
	const deep = deepHistoryFilter(opts.deep_history);
	const tagged = found.map(has).join(opts.match_all ? " && " : " || ");
	const filter = deep ? `(${tagged}) && ${deep}` : tagged;
	const sort = opts.sort ?? "most_played";
	const limit = clamp(opts.limit, 25, 100);
	const random = sort === "random";
	const page = random ? 1 : Math.max(1, opts.page ?? 1);
	const needs = TAG_TRACK_SORT_NEEDS[sort];
	// No total: counting means scanning every track through the joins (~4x slower).
	const res = await pb.list<TrackRec>("tracks", {
		filter: needs ? `(${filter}) && ${needs}` : filter,
		sort: random ? "@random" : `${TAG_TRACK_SORTS[sort]},id`,
		expand: "artist,album",
		perPage: limit,
		page,
		skipTotal: true,
	});

	const name = new Map(found.map((t) => [t.id, t.name]));
	return {
		tags: found.map((t) => t.name),
		...(unknown.length ? { unknown_tags: unknown } : {}),
		match_all: !!opts.match_all,
		sort,
		...(random
			? { note: "Random order: each call is a fresh sample, so page doesn't apply. random_tracks picks songs evenly (duplicate records counted once)." }
			: { page, has_more: res.items.length === limit }),
		tracks: res.items.map((t) => {
			const ids = new Set([...(t.expand?.album?.tag_relations ?? []), ...(t.expand?.artist?.tag_relations ?? [])]);
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
				matched_tags: found.filter((f) => ids.has(f.id)).map((f) => name.get(f.id)!),
				...deepHistoryMark(t),
			};
		}),
	};
}

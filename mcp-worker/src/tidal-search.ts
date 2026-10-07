/**
 * search_tidal: search TIDAL's catalogue, including music not in the library,
 * and say for each result whether the library already has it.
 *
 * "In the library" is decided by:
 *   tracks   a confident match saved in tidal_matches (exact), else the same
 *            normalised title by the same artist
 *   albums   the same normalised title by the same artist
 *   artists  the same normalised name
 */

import { fold } from "./matching";
import { type PocketBase, pbString } from "./pocketbase";
import { asList, type Resource, type Tidal } from "./tidal";

export const SEARCH_TYPES = ["tracks", "albums", "artists"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
/** TIDAL's filter[id] takes at most 20 ids. */
const LOOKUP_MAX = 20;

type InLibrary = { in_library: boolean; library_id?: string };

const linkOf = (r: Resource, kind: string) =>
	((r.attributes?.externalLinks ?? []) as { href?: string }[]).find((l) => l.href)?.href ?? `https://tidal.com/browse/${kind}/${r.id}`;

/** Albums with their artist names, 20 per request. */
async function albumDetails(tidal: Tidal, ids: string[]) {
	const out = new Map<string, { title: string; artists: string[]; year: number | null; type: string; tracks: number | null; url: string }>();
	for (let i = 0; i < ids.length; i += LOOKUP_MAX) {
		const batch = ids.slice(i, i + LOOKUP_MAX);
		const doc = await tidal.request("GET", "/albums", {
			query: [...batch.map((id): [string, string] => ["filter[id]", id]), ["include", "artists"]],
		});
		const names = new Map((doc.included ?? []).filter((r) => r.type === "artists").map((r) => [r.id, String(r.attributes?.name ?? "")]));
		for (const a of asList(doc.data)) {
			const at = a.attributes ?? {};
			const date = typeof at.releaseDate === "string" ? at.releaseDate : "";
			out.set(a.id, {
				title: String(at.title ?? "") + (typeof at.version === "string" && at.version ? ` (${at.version})` : ""),
				artists: asList(a.relationships?.artists?.data).map((x) => names.get(x.id) ?? "").filter(Boolean),
				year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
				type: String(at.albumType ?? at.type ?? ""),
				tracks: typeof at.numberOfItems === "number" ? at.numberOfItems : null,
				url: linkOf(a, "album"),
			});
		}
	}
	return out;
}

/** OR of `field~"value"` for the distinct values; PocketBase "~" is a case-insensitive contains. */
const anyLike = (field: string, values: string[]) =>
	[...new Set(values.filter(Boolean))].map((v) => `${field}~${pbString(v)}`).join(" || ");

async function libraryArtists(pb: PocketBase, names: string[]): Promise<Map<string, string>> {
	if (names.length === 0) return new Map();
	const res = await pb.list<{ id: string; name: string }>("artists", {
		filter: anyLike("name", names),
		fields: "id,name",
		perPage: 200,
		skipTotal: true,
	});
	return new Map(res.items.map((a) => [fold(a.name), a.id]));
}

export async function searchTidal(
	deps: { tidal: Tidal; pb: PocketBase },
	opts: { query: string; types?: SearchType[]; limit?: number },
) {
	const types = opts.types?.length ? [...new Set(opts.types)] : [...SEARCH_TYPES];
	const limit = Math.max(1, Math.min(opts.limit ?? 10, LOOKUP_MAX));
	const { tidal, pb } = deps;

	const found = await tidal.request("GET", "/searchResults", {
		query: [["filter[query]", opts.query.slice(0, 256)], ...types.map((t): [string, string] => ["include", t])],
	});
	const result = asList(found.data)[0];
	const included = new Map((found.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
	const ids = (t: SearchType) => asList(result?.relationships?.[t]?.data).map((x) => x.id).slice(0, limit);
	const didYouMean = result?.attributes?.didYouMean;

	const out: Record<string, unknown> = { query: opts.query };
	if (typeof didYouMean === "string" && didYouMean) out.did_you_mean = didYouMean;

	if (types.includes("artists")) {
		const artists = ids("artists").map((id) => included.get(`artists:${id}`)).filter((r): r is Resource => !!r);
		const lib = await libraryArtists(pb, artists.map((a) => String(a.attributes?.name ?? "")));
		out.artists = artists.map((a) => {
			const name = String(a.attributes?.name ?? "");
			const libId = lib.get(fold(name));
			return {
				tidal_id: a.id,
				name,
				popularity: typeof a.attributes?.popularity === "number" ? a.attributes.popularity : null,
				url: linkOf(a, "artist"),
				...(libId ? { in_library: true, library_id: libId } : { in_library: false }),
			} satisfies Record<string, unknown> & InLibrary;
		});
	}

	if (types.includes("albums")) {
		const albumIds = ids("albums");
		const details = await albumDetails(tidal, albumIds);
		const rows = albumIds.flatMap((id) => (details.has(id) ? [{ id, ...details.get(id)! }] : []));
		const owned = new Map<string, string>();
		if (rows.length) {
			const res = await pb.list<{ id: string; title: string; expand?: { artist?: { name: string } } }>("albums", {
				filter: anyLike("title", rows.map((r) => r.title.replace(/\s*[([].*$/, ""))),
				expand: "artist",
				fields: "id,title,expand.artist.name",
				perPage: 200,
				skipTotal: true,
			});
			for (const a of res.items) owned.set(`${fold(a.expand?.artist?.name)}|${fold(a.title)}`, a.id);
		}
		out.albums = rows.map((r) => {
			const key = (title: string) => r.artists.map((ar) => `${fold(ar)}|${fold(title)}`);
			const libId = [...key(r.title), ...key(r.title.replace(/\s*[([].*$/, ""))].map((k) => owned.get(k)).find(Boolean);
			return {
				tidal_id: r.id,
				title: r.title,
				artists: r.artists,
				year: r.year,
				type: r.type,
				tracks: r.tracks,
				url: r.url,
				...(libId ? { in_library: true, library_id: libId } : { in_library: false }),
			};
		});
	}

	if (types.includes("tracks")) {
		const trackIds = ids("tracks");
		const details = await tidal.trackDetails(trackIds);
		const rows = trackIds.flatMap((id) => (details.has(id) ? [details.get(id)!] : []));
		const owned = new Map<string, string>(); // tidal id -> library track id
		if (rows.length) {
			const [cached, byName] = await Promise.all([
				pb.list<{ library_track: string; tidal_id: string }>("tidal_matches", {
					filter: rows.map((r) => `tidal_id=${pbString(r.tidal_id)}`).join(" || "),
					fields: "library_track,tidal_id",
					perPage: 100,
					skipTotal: true,
				}),
				pb.list<{ id: string; title: string; expand?: { artist?: { name: string } } }>("tracks", {
					filter: anyLike("title", rows.map((r) => r.title)),
					expand: "artist",
					fields: "id,title,expand.artist.name",
					perPage: 500,
					skipTotal: true,
				}),
			]);
			for (const c of cached.items) owned.set(c.tidal_id, c.library_track);
			const names = new Map(byName.items.map((t) => [`${fold(t.expand?.artist?.name)}|${fold(t.title)}`, t.id]));
			for (const r of rows) {
				if (owned.has(r.tidal_id)) continue;
				const libId = r.artists.map((a) => names.get(`${fold(a)}|${fold(r.title)}`)).find(Boolean);
				if (libId) owned.set(r.tidal_id, libId);
			}
		}
		out.tracks = rows.map((r) => ({
			tidal_id: r.tidal_id,
			title: r.title + (r.version ? ` (${r.version})` : ""),
			artists: r.artists,
			album: r.album,
			duration_s: r.duration_s,
			available: r.available,
			...(owned.has(r.tidal_id) ? { in_library: true, library_id: owned.get(r.tidal_id) } : { in_library: false }),
		}));
	}
	return out;
}

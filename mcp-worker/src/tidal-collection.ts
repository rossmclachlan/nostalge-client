/**
 * The user's TIDAL favourites, TIDAL's recommendation mixes, and similar
 * artists. Endpoints and payloads follow TIDAL's v2 API (@tidal-music/api):
 *   /userCollection{Tracks,Albums,Artists}/me/relationships/items   GET POST DELETE
 *   /user{Daily,Discovery,NewRelease}Mixes/me/relationships/items    GET (mixes are playlists)
 *   /artists/{id}/relationships/similarArtists                      GET
 *
 * Favourites need collection.read/collection.write and mixes need
 * recommendations.read; connections made before the Worker asked for them
 * get a 403 until the user reconnects.
 */

import { fold } from "./matching";
import { type PocketBase, pbString } from "./pocketbase";
import { asList, type Doc, type Resource, type Tidal, TidalError } from "./tidal";

export const FAVOURITE_KINDS = ["tracks", "albums", "artists"] as const;
export type FavouriteKind = (typeof FAVOURITE_KINDS)[number];
const COLLECTION: Record<FavouriteKind, string> = {
	tracks: "/userCollectionTracks/me/relationships/items",
	albums: "/userCollectionAlbums/me/relationships/items",
	artists: "/userCollectionArtists/me/relationships/items",
};
const LOOKUP_MAX = 20;
const WRITE_BATCH = 50;
const TIDAL_ID = /^\d+$/;

/** A 403 here almost always means the connection lacks the newer permissions. */
async function call<T>(what: string, f: () => Promise<T>): Promise<T> {
	try {
		return await f();
	} catch (e) {
		if (e instanceof Error && /\(HTTP 403\)/.test(e.message)) {
			throw new TidalError(
				`TIDAL refused ${what} (HTTP 403). The TIDAL connection was probably made before this server asked for favourites and recommendations access: call connect_tidal, have the user open the link and approve, then try again.`,
			);
		}
		throw e;
	}
}

const nextCursor = (doc: Doc) => (doc.links?.next ? new URL(doc.links.next, "https://openapi.tidal.com/v2").searchParams.get("page[cursor]") : null);
const linkOf = (r: Resource, kind: string) =>
	((r.attributes?.externalLinks ?? []) as { href?: string }[]).find((l) => l.href)?.href ?? `https://tidal.com/browse/${kind}/${r.id}`;

async function lookup(tidal: Tidal, path: "/albums" | "/artists", ids: string[]) {
	const data: Resource[] = [];
	const included: Resource[] = [];
	for (let i = 0; i < ids.length; i += LOOKUP_MAX) {
		const doc = await tidal.request("GET", path, {
			query: [...ids.slice(i, i + LOOKUP_MAX).map((id): [string, string] => ["filter[id]", id]), ...(path === "/albums" ? [["include", "artists"] as [string, string]] : [])],
		});
		data.push(...asList(doc.data));
		included.push(...(doc.included ?? []));
	}
	return { byId: new Map(data.map((r) => [r.id, r])), included: new Map(included.map((r) => [`${r.type}:${r.id}`, r])) };
}

// -- favourites -----------------------------------------------------------------------

export async function listTidalFavourites(tidal: Tidal, kind: FavouriteKind, limit = 50) {
	const want = Math.max(1, Math.min(limit, 200));
	const items: { id: string; added_at: string | null }[] = [];
	let cursor: string | null = null;
	let more = false;
	do {
		const doc: Doc = await call(`reading favourite ${kind}`, () =>
			tidal.request("GET", COLLECTION[kind], {
				query: [["sort", "-addedAt"], ...(cursor ? [["page[cursor]", cursor] as [string, string]] : [])],
			}),
		);
		for (const r of asList(doc.data) as (Resource & { meta?: { addedAt?: string } })[]) {
			items.push({ id: r.id, added_at: r.meta?.addedAt?.slice(0, 10) ?? null });
		}
		cursor = nextCursor(doc);
		more = !!cursor;
	} while (cursor && items.length < want);
	const page = items.slice(0, want);
	const ids = page.map((x) => x.id);

	let rows: Record<string, unknown>[];
	if (kind === "tracks") {
		const d = await tidal.trackDetails(ids);
		rows = page.flatMap((x) => {
			const t = d.get(x.id);
			return t ? [{ tidal_id: t.tidal_id, title: t.title + (t.version ? ` (${t.version})` : ""), artists: t.artists, album: t.album, duration_s: t.duration_s, added_at: x.added_at }] : [];
		});
	} else if (kind === "albums") {
		const d = await lookup(tidal, "/albums", ids);
		rows = page.flatMap((x) => {
			const a = d.byId.get(x.id);
			if (!a) return [];
			const date = String(a.attributes?.releaseDate ?? "");
			return [{
				tidal_id: a.id,
				title: String(a.attributes?.title ?? ""),
				artists: asList(a.relationships?.artists?.data).map((r) => String(d.included.get(`artists:${r.id}`)?.attributes?.name ?? "")).filter(Boolean),
				year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
				url: linkOf(a, "album"),
				added_at: x.added_at,
			}];
		});
	} else {
		const d = await lookup(tidal, "/artists", ids);
		rows = page.flatMap((x) => {
			const a = d.byId.get(x.id);
			return a ? [{ tidal_id: a.id, name: String(a.attributes?.name ?? ""), url: linkOf(a, "artist"), added_at: x.added_at }] : [];
		});
	}
	return { kind, count: rows.length, more: more || items.length > want, favourites: rows };
}

export async function changeTidalFavourites(tidal: Tidal, kind: FavouriteKind, action: "add" | "remove", ids: string[]) {
	const unique = [...new Set(ids)];
	const bad = unique.filter((id) => !TIDAL_ID.test(id));
	if (bad.length) throw new TidalError(`Not TIDAL ${kind} ids: ${bad.join(", ")}`);
	for (let i = 0; i < unique.length; i += WRITE_BATCH) {
		const data = unique.slice(i, i + WRITE_BATCH).map((id) => ({ id, type: kind }));
		await call(`${action === "add" ? "adding" : "removing"} favourite ${kind}`, () =>
			tidal.request(action === "add" ? "POST" : "DELETE", COLLECTION[kind], { body: { data } }),
		);
	}
	return { kind, action, count: unique.length };
}

// -- recommendations ------------------------------------------------------------------

const MIXES = {
	daily: "/userDailyMixes/me/relationships/items",
	discovery: "/userDiscoveryMixes/me/relationships/items",
	new_releases: "/userNewReleaseMixes/me/relationships/items",
} as const;

export async function tidalRecommendations(tidal: Tidal) {
	const out: Record<string, unknown[]> = {};
	for (const [name, path] of Object.entries(MIXES)) {
		const doc = await call("reading recommendations", () => tidal.request("GET", path, { query: [["include", "items"]] }));
		const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
		out[name] = asList(doc.data).map((ref) => {
			const r = included.get(`${ref.type}:${ref.id}`);
			const a = r?.attributes ?? {};
			return {
				id: ref.id,
				type: ref.type,
				name: String(a.name ?? a.title ?? ""),
				description: String(a.description ?? a.subTitle ?? ""),
				tracks: typeof a.numberOfItems === "number" ? a.numberOfItems : null,
				url: r ? linkOf(r, ref.type === "playlists" ? "playlist" : "mix") : null,
			};
		});
	}
	return { ...out, note: "Mixes are TIDAL playlists: read one with get_tidal_playlist(id)." };
}

// -- similar artists ------------------------------------------------------------------

async function tidalArtist(tidal: Tidal, artist: string): Promise<{ id: string; name: string }> {
	if (TIDAL_ID.test(artist.trim())) return { id: artist.trim(), name: artist.trim() };
	const found = await tidal.request("GET", "/searchResults", { query: [["filter[query]", artist.slice(0, 256)], ["include", "artists"]] });
	const included = (found.included ?? []).filter((r) => r.type === "artists");
	const order = asList(asList(found.data)[0]?.relationships?.artists?.data).map((x) => x.id);
	const ranked = order.map((id) => included.find((r) => r.id === id)).filter((r): r is Resource => !!r);
	const hit = ranked.find((r) => fold(String(r.attributes?.name)) === fold(artist)) ?? ranked[0];
	if (!hit) throw new TidalError(`No artist called ${JSON.stringify(artist)} on TIDAL`);
	return { id: hit.id, name: String(hit.attributes?.name ?? artist) };
}

export async function similarTidalArtists(deps: { tidal: Tidal; pb: PocketBase }, artist: string, limit = 20) {
	const { tidal, pb } = deps;
	const seed = await tidalArtist(tidal, artist);
	const doc = await tidal.request("GET", `/artists/${encodeURIComponent(seed.id)}/relationships/similarArtists`, {
		query: [["include", "similarArtists"]],
	});
	const included = new Map((doc.included ?? []).map((r) => [r.id, r]));
	const similar = asList(doc.data)
		.slice(0, Math.max(1, Math.min(limit, 50)))
		.map((ref) => included.get(ref.id))
		.filter((r): r is Resource => !!r)
		.map((r) => ({ tidal_id: r.id, name: String(r.attributes?.name ?? ""), url: linkOf(r, "artist") }));

	// Which of them are already in the library (same normalised name).
	const owned = new Map<string, string>();
	if (similar.length) {
		const res = await pb.list<{ id: string; name: string }>("artists", {
			filter: [...new Set(similar.map((s) => s.name))].map((n) => `name~${pbString(n)}`).join(" || "),
			fields: "id,name",
			perPage: 200,
			skipTotal: true,
		});
		for (const a of res.items) owned.set(fold(a.name), a.id);
	}
	return {
		artist: seed.name,
		tidal_id: seed.id,
		similar: similar.map((s) => {
			const id = owned.get(fold(s.name));
			return { ...s, ...(id ? { in_library: true, library_id: id } : { in_library: false }) };
		}),
	};
}

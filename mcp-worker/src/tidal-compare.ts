/**
 * compare_artist_with_tidal: one artist's releases in the library against
 * their releases on TIDAL, in both directions.
 *
 * Releases are paired by title with edition decorations removed, so
 * "Spaces (Deluxe Edition)" or "OK Computer - Remastered" on TIDAL pairs with
 * "Spaces" / "OK Computer" in the library. Track-level gaps within a release
 * are what create_tidal_playlist's dry run reports.
 */

import { coreTitle, fold } from "./matching";
import { isRecordId, type PocketBase, PocketBaseError, pbString } from "./pocketbase";
import { asList, type Doc, type Resource, type Tidal, TidalError } from "./tidal";

const TIDAL_ID = /^\d+$/;
const MAX_PAGES = 20;

type LibAlbum = { id: string; title: string; release_year: number; play_count: number; track_count: number };

async function libraryArtist(pb: PocketBase, artist: string): Promise<{ id: string; name: string }> {
	const a = artist.trim();
	if (isRecordId(a)) {
		const rec = await pb.getOne<{ id: string; name: string }>("artists", a);
		return { id: rec.id, name: rec.name };
	}
	const res = await pb.list<{ id: string; name: string }>("artists", {
		filter: `name~${pbString(a)}`,
		fields: "id,name",
		sort: "-play_count",
		perPage: 10,
		skipTotal: true,
	});
	const hit = res.items.find((x) => fold(x.name) === fold(a)) ?? (res.items.length === 1 ? res.items[0] : undefined);
	if (hit) return hit;
	if (res.items.length === 0) throw new PocketBaseError(`No artist matching ${JSON.stringify(artist)} in the library`, 404);
	throw new PocketBaseError(`Several library artists match ${JSON.stringify(artist)}: ${res.items.map((x) => `${x.name} (${x.id})`).join(", ")}`, 400);
}

async function tidalArtistId(tidal: Tidal, name: string, explicit?: string): Promise<{ id: string; name: string }> {
	if (explicit) {
		if (!TIDAL_ID.test(explicit)) throw new TidalError(`Not a TIDAL artist id: ${explicit}`);
		return { id: explicit, name };
	}
	const found = await tidal.request("GET", "/searchResults", { query: [["filter[query]", name.slice(0, 256)], ["include", "artists"]] });
	const included = new Map((found.included ?? []).filter((r) => r.type === "artists").map((r) => [r.id, r]));
	const ranked = asList(asList(found.data)[0]?.relationships?.artists?.data)
		.map((x) => included.get(x.id))
		.filter((r): r is Resource => !!r);
	const hit = ranked.find((r) => fold(String(r.attributes?.name)) === fold(name));
	if (!hit) {
		const others = ranked.slice(0, 5).map((r) => `${r.attributes?.name} (${r.id})`).join(", ");
		throw new TidalError(`No artist named ${JSON.stringify(name)} on TIDAL${others ? `; closest: ${others}. Pass tidal_artist_id to choose one` : ""}`);
	}
	return { id: hit.id, name: String(hit.attributes?.name ?? name) };
}

const releaseKey = (title: string) => fold(coreTitle(title));

export async function compareArtistWithTidal(deps: { tidal: Tidal; pb: PocketBase }, args: { artist: string; tidal_artist_id?: string }) {
	const { tidal, pb } = deps;
	const lib = await libraryArtist(pb, args.artist);
	const [libAlbums, onTidal] = await Promise.all([
		pb.list<LibAlbum>("albums", {
			filter: `artist=${pbString(lib.id)}`,
			fields: "id,title,release_year,play_count,track_count",
			sort: "-play_count",
			perPage: 500,
			skipTotal: true,
		}),
		tidalArtistId(tidal, lib.name, args.tidal_artist_id),
	]);

	// Every release TIDAL lists for the artist, following page cursors.
	const tidalAlbums: Resource[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const doc: Doc = await tidal.request("GET", `/artists/${encodeURIComponent(onTidal.id)}/relationships/albums`, {
			query: [["include", "albums"], ...(cursor ? [["page[cursor]", cursor] as [string, string]] : [])],
		});
		const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
		for (const ref of asList(doc.data)) {
			const r = included.get(`${ref.type}:${ref.id}`);
			if (r) tidalAlbums.push(r);
		}
		cursor = doc.links?.next ? new URL(doc.links.next, "https://openapi.tidal.com/v2").searchParams.get("page[cursor]") : null;
	} while (cursor && ++pages < MAX_PAGES);

	const tidalRows = tidalAlbums.map((r) => {
		const a = r.attributes ?? {};
		const date = String(a.releaseDate ?? "");
		const version = typeof a.version === "string" && a.version ? ` (${a.version})` : "";
		return {
			tidal_id: r.id,
			title: String(a.title ?? "") + version,
			type: String(a.albumType ?? a.type ?? ""),
			year: /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null,
			tracks: typeof a.numberOfItems === "number" ? a.numberOfItems : null,
			url: ((a.externalLinks ?? []) as { href?: string }[]).find((l) => l.href)?.href ?? `https://tidal.com/browse/album/${r.id}`,
			key: releaseKey(String(a.title ?? "")),
		};
	});
	const byKey = new Map<string, typeof tidalRows>();
	for (const t of tidalRows) byKey.set(t.key, [...(byKey.get(t.key) ?? []), t]);

	const inBoth: unknown[] = [];
	const onlyInLibrary: unknown[] = [];
	const pairedKeys = new Set<string>();
	for (const a of libAlbums.items) {
		const key = releaseKey(a.title);
		const lib = { id: a.id, title: a.title, release_year: a.release_year || null, play_count: a.play_count ?? 0 };
		const editions = byKey.get(key);
		if (editions?.length) {
			pairedKeys.add(key);
			inBoth.push({ library: lib, tidal: editions.map(({ key: _k, ...t }) => t) });
		} else onlyInLibrary.push(lib);
	}
	const onlyOnTidal = tidalRows
		.filter((t) => !pairedKeys.has(t.key))
		.map(({ key: _k, ...t }) => t)
		.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

	return {
		artist: lib.name,
		library_artist_id: lib.id,
		tidal_artist: { id: onTidal.id, name: onTidal.name },
		summary: {
			library_releases: libAlbums.items.length,
			tidal_releases: tidalRows.length,
			in_both: inBoth.length,
			only_in_library: onlyInLibrary.length,
			only_on_tidal: onlyOnTidal.length,
		},
		only_in_library: onlyInLibrary,
		only_on_tidal: onlyOnTidal,
		in_both: inBoth,
		...(pages >= MAX_PAGES ? { warning: `Only the first ${MAX_PAGES} pages of TIDAL releases were read.` } : {}),
	};
}

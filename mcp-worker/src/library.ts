/**
 * Read-only library queries over the music-cms-mvp PocketBase schema
 * (see music-cms-mvp/pocketbase/pb_migrations):
 *
 *   artists  name, mbid, play_count, tags(json), tag_relations -> tags[]
 *   albums   title, artist -> artists, release_year, play_count, track_count,
 *            wiki_summary, tags(json), tag_relations -> tags[]
 *   tracks   title, artist -> artists, album -> albums, duration_ms, play_count
 *   tags     name (unique), slug (unique), usage_count
 *
 * There are no "crates" or "releases" collections. Matching the app's Crates
 * tab, a crate is an album, and an album is the release.
 */

import { type PocketBase, PocketBaseError, pbString } from "./pocketbase";

type Base = { id: string; created: string; updated: string };
type TagRec = Base & { name: string; slug: string; usage_count: number };
type ArtistRec = Base & {
	name: string;
	play_count: number;
	tag_relations: string[];
	expand?: { tag_relations?: TagRec[] };
};
type AlbumRec = Base & {
	title: string;
	artist: string;
	release_year: number;
	play_count: number;
	track_count: number;
	wiki_summary: string;
	tag_relations: string[];
	expand?: { artist?: ArtistRec; tag_relations?: TagRec[] };
};
type TrackRec = Base & {
	title: string;
	artist: string;
	album: string;
	duration_ms: number;
	play_count: number;
	expand?: { artist?: ArtistRec; album?: AlbumRec };
};

const clamp = (n: number | undefined, def: number, max: number) => Math.max(1, Math.min(n ?? def, max));

function release(a: AlbumRec) {
	return {
		id: a.id,
		title: a.title,
		artist: a.expand?.artist?.name ?? null,
		artist_id: a.artist || null,
		release_year: a.release_year || null,
		play_count: a.play_count ?? 0,
		track_count: a.track_count ?? 0,
		tags: (a.expand?.tag_relations ?? []).map((t) => t.name),
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
	};
}

export async function searchLibrary(pb: PocketBase, query: string, limit?: number) {
	const q = pbString(query.trim());
	const perPage = clamp(limit, 10, 50);
	const [artists, albums, tracks] = await Promise.all([
		pb.list<ArtistRec>("artists", { filter: `name~${q}`, sort: "-play_count", perPage, skipTotal: true }),
		pb.list<AlbumRec>("albums", {
			filter: `(title~${q} || artist.name~${q})`,
			sort: "-play_count",
			expand: "artist,tag_relations",
			perPage,
			skipTotal: true,
		}),
		pb.list<TrackRec>("tracks", {
			filter: `(title~${q} || artist.name~${q} || album.title~${q})`,
			sort: "-play_count",
			expand: "artist,album",
			perPage,
			skipTotal: true,
		}),
	]);
	return {
		artists: artists.items.map((a) => ({ id: a.id, name: a.name, play_count: a.play_count ?? 0 })),
		releases: albums.items.map(release),
		tracks: tracks.items.map(track),
	};
}

export async function listCrates(pb: PocketBase, opts: { limit?: number; page?: number } = {}) {
	const res = await pb.list<AlbumRec>("albums", {
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
		tracks: tracks.items.map(track),
	};
}

export async function releasesByTag(pb: PocketBase, tag: string, limit?: number) {
	const t = tag.trim();
	// "=" is case-sensitive in PocketBase; also accept the slug, then a case-insensitive "~" match.
	let tags = await pb.list<TagRec>("tags", {
		filter: `(name=${pbString(t)} || slug=${pbString(t.toLowerCase().replace(/\s+/g, "-"))})`,
		perPage: 1,
		skipTotal: true,
	});
	if (tags.items.length === 0) {
		const loose = await pb.list<TagRec>("tags", { filter: `name~${pbString(t)}`, sort: "-usage_count", perPage: 20 });
		tags = { ...loose, items: loose.items.filter((x) => x.name.toLowerCase() === t.toLowerCase()) };
	}
	const found = tags.items[0];
	if (!found) return { tag, found: false, releases: [] };

	const albums = await pb.list<AlbumRec>("albums", {
		filter: `tag_relations~${pbString(found.id)}`,
		sort: "-play_count",
		expand: "artist,tag_relations",
		perPage: clamp(limit, 50, 200),
	});
	return { tag: found.name, found: true, total: albums.totalItems, releases: albums.items.map(release) };
}

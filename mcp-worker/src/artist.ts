/**
 * get_artist: one artist's whole catalogue, every release and every track,
 * with play stats.
 *
 * The library holds many tracks twice: the album import's copy (with a
 * duration) and a copy created later from scrobbles (no duration), which is
 * often the one the plays are counted on. Tracks are merged by release and
 * normalised title, summing plays, so each song appears once and picking "a
 * random song by X" from the result is fair.
 */

import { fold } from "./matching";
import { isRecordId, type PocketBase, PocketBaseError, pbString } from "./pocketbase";

/** PocketBase 0.22 serves at most 500 records per page. */
const PAGE = 500;
const MAX_TRACK_PAGES = 6; // 3,000 track records

type TagRec = { id: string; name: string };
type ArtistRec = { id: string; name: string; tag_relations: string[]; expand?: { tag_relations?: TagRec[] } };
type AlbumRec = {
	id: string;
	title: string;
	release_year: number;
	play_count: number;
	tag_relations: string[];
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
};

type Song = {
	id: string;
	title: string;
	duration_s: number | null;
	play_count: number;
	first_played: string | null;
	last_played: string | null;
	/** Other library ids for the same song (duplicates merged into this one). */
	duplicate_ids?: string[];
};

const YEAR_TAG = /^(19|20)\d\d$/;
const day = (d: string) => (d ? d.slice(0, 10) : null);

/** The album's release year, or failing that a Last.fm year tag such as "1997". */
function year(a: AlbumRec): { release_year: number | null; year_source?: "tag" } {
	if (a.release_year) return { release_year: a.release_year };
	const tag = (a.expand?.tag_relations ?? []).map((t) => t.name).find((n) => YEAR_TAG.test(n));
	return tag ? { release_year: Number(tag), year_source: "tag" } : { release_year: null };
}

async function findArtist(pb: PocketBase, artist: string): Promise<ArtistRec | { candidates: { id: string; name: string }[] }> {
	const a = artist.trim();
	if (isRecordId(a)) {
		try {
			return await pb.getOne<ArtistRec>("artists", a, "tag_relations");
		} catch (e) {
			if ((e as { status?: number }).status !== 404) throw e;
		}
	}
	// "=" is exact and indexed; then a case-insensitive "~" match.
	const exact = await pb.list<ArtistRec>("artists", { filter: `name=${pbString(a)}`, expand: "tag_relations", perPage: 1, skipTotal: true });
	if (exact.items[0]) return exact.items[0];
	const loose = await pb.list<ArtistRec>("artists", {
		filter: `name~${pbString(a)}`,
		expand: "tag_relations",
		sort: "-play_count",
		perPage: 10,
		skipTotal: true,
	});
	const same = loose.items.find((x) => x.name.toLowerCase() === a.toLowerCase());
	if (same) return same;
	if (loose.items.length === 1) return loose.items[0];
	return { candidates: loose.items.map((x) => ({ id: x.id, name: x.name })) };
}

/** Merges duplicate track records of one song; the copy with a duration supplies the id. */
function merge(records: TrackRec[]): Song {
	const best = [...records].sort((a, b) => Number(b.duration_ms > 0) - Number(a.duration_ms > 0) || b.play_count - a.play_count)[0];
	const firsts = records.map((r) => r.first_played_at).filter(Boolean).sort();
	const lasts = records.map((r) => r.last_played_at).filter(Boolean).sort();
	const song: Song = {
		id: best.id,
		title: best.title,
		duration_s: best.duration_ms ? Math.round(best.duration_ms / 1000) : null,
		play_count: records.reduce((n, r) => n + (r.play_count ?? 0), 0),
		first_played: day(firsts[0] ?? ""),
		last_played: day(lasts[lasts.length - 1] ?? ""),
	};
	if (records.length > 1) song.duplicate_ids = records.filter((r) => r !== best).map((r) => r.id);
	return song;
}

export async function getArtist(pb: PocketBase, artist: string, opts: { include_tracks?: boolean } = {}) {
	const found = await findArtist(pb, artist);
	if ("candidates" in found) {
		if (found.candidates.length === 0) throw new PocketBaseError(`No artist matching ${JSON.stringify(artist)} in the library`, 404);
		return { found: false, message: "Several artists match; call again with one of these ids.", candidates: found.candidates };
	}

	const [albums, records] = await Promise.all([
		pb.list<AlbumRec>("albums", {
			filter: `artist=${pbString(found.id)}`,
			expand: "tag_relations",
			sort: "-play_count",
			perPage: PAGE,
			skipTotal: true,
		}),
		(async () => {
			const out: TrackRec[] = [];
			for (let page = 1; page <= MAX_TRACK_PAGES; page++) {
				const res = await pb.list<TrackRec>("tracks", {
					filter: `artist=${pbString(found.id)}`,
					fields: "id,title,album,duration_ms,play_count,first_played_at,last_played_at",
					sort: "created,id",
					perPage: PAGE,
					page,
					skipTotal: true,
				});
				out.push(...res.items);
				if (res.items.length < PAGE) return { tracks: out, truncated: false };
			}
			return { tracks: out, truncated: true };
		})(),
	]);

	// Group by release, then by normalised title. Album-less copies join the
	// release that has the same song, if exactly one does.
	const byAlbum = new Map<string, Map<string, TrackRec[]>>();
	const albumless: TrackRec[] = [];
	for (const t of records.tracks) {
		if (!t.album) {
			albumless.push(t);
			continue;
		}
		const songs = byAlbum.get(t.album) ?? new Map<string, TrackRec[]>();
		byAlbum.set(t.album, songs);
		const key = fold(t.title);
		songs.set(key, [...(songs.get(key) ?? []), t]);
	}
	const loose = new Map<string, TrackRec[]>();
	for (const t of albumless) {
		const key = fold(t.title);
		const homes = [...byAlbum.values()].filter((songs) => songs.has(key));
		if (homes.length === 1) homes[0].get(key)!.push(t);
		else loose.set(key, [...(loose.get(key) ?? []), t]);
	}

	const releases = albums.items.map((a) => {
		const songs = [...(byAlbum.get(a.id)?.values() ?? [])].map(merge);
		return {
			id: a.id,
			title: a.title,
			...year(a),
			play_count: songs.reduce((n, s) => n + s.play_count, 0),
			track_count: songs.length,
			tags: (a.expand?.tag_relations ?? []).map((t) => t.name).filter((n) => !YEAR_TAG.test(n)),
			...(opts.include_tracks === false ? {} : { tracks: songs }),
		};
	});
	releases.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999) || a.title.localeCompare(b.title));
	const other = [...loose.values()].map(merge);
	const songs = releases.reduce((n, r) => n + r.track_count, 0) + other.length;

	return {
		found: true,
		artist: {
			id: found.id,
			name: found.name,
			tags: (found.expand?.tag_relations ?? []).map((t) => t.name),
			play_count: releases.reduce((n, r) => n + r.play_count, 0) + other.reduce((n, s) => n + s.play_count, 0),
		},
		release_count: releases.length,
		song_count: songs,
		track_records: records.tracks.length,
		releases,
		...(other.length ? { tracks_without_release: opts.include_tracks === false ? other.length : other } : {}),
		...(records.truncated ? { warning: `Only the first ${records.tracks.length} track records were read.` } : {}),
	};
}

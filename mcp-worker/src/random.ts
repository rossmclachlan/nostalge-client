/**
 * random_tracks: N random library tracks matching optional filters, in one call.
 *
 * Many songs exist as two track records (the album import's, with a
 * duration, and a scrobble-created copy). Sampling records would make those
 * songs twice as likely, so each sampled record is kept with probability
 * 1/(records for its song), which makes every song equally likely. The
 * returned song merges its records' play stats.
 */

import { fold } from "./matching";
import { isRecordId, type PocketBase, PocketBaseError, pbString } from "./pocketbase";

const YEAR_TAG = /^(19|20)\d\d$/;
const OVERSAMPLE = 3;
const MAX_SAMPLE = 150;
const ROUNDS = 5;

type TrackRec = {
	id: string;
	title: string;
	artist: string;
	album: string;
	duration_ms: number;
	play_count: number;
	first_played_at: string;
	last_played_at: string;
	expand?: { artist?: { name: string }; album?: { title: string; release_year: number } };
};

export type RandomOptions = {
	count?: number;
	artist?: string;
	tags?: string[];
	min_plays?: number;
	max_plays?: number;
	min_duration_s?: number;
	max_duration_s?: number;
	min_year?: number;
	max_year?: number;
};

async function artistId(pb: PocketBase, artist: string): Promise<{ id: string; name: string }> {
	const a = artist.trim();
	if (isRecordId(a)) return { id: a, name: a };
	const res = await pb.list<{ id: string; name: string }>("artists", {
		filter: `name~${pbString(a)}`,
		sort: "-play_count",
		fields: "id,name",
		perPage: 10,
		skipTotal: true,
	});
	const exact = res.items.find((x) => x.name.toLowerCase() === a.toLowerCase());
	if (exact) return exact;
	if (res.items.length === 1) return res.items[0];
	if (res.items.length === 0) throw new PocketBaseError(`No artist matching ${JSON.stringify(artist)} in the library`, 404);
	throw new PocketBaseError(`Several artists match ${JSON.stringify(artist)}: ${res.items.map((x) => `${x.name} (${x.id})`).join(", ")}`, 400);
}

async function tagIds(pb: PocketBase, names: string[]): Promise<{ ids: string[]; unknown: string[] }> {
	const ids: string[] = [];
	const unknown: string[] = [];
	for (const raw of names.map((n) => n.trim()).filter(Boolean)) {
		const res = await pb.list<{ id: string; name: string }>("tags", {
			filter: `(name~${pbString(raw)} || slug=${pbString(raw.toLowerCase().replace(/\s+/g, "-"))})`,
			fields: "id,name",
			perPage: 20,
			skipTotal: true,
		});
		const tag = res.items.find((t) => t.name.toLowerCase() === raw.toLowerCase()) ?? (res.items.length === 1 ? res.items[0] : undefined);
		if (tag) ids.push(tag.id);
		else unknown.push(raw);
	}
	return { ids, unknown };
}

async function yearCondition(pb: PocketBase, lo?: number, hi?: number): Promise<string | null> {
	if (lo === undefined && hi === undefined) return null;
	const from = lo ?? 1900;
	const to = hi ?? 2099;
	if (from > to) throw new PocketBaseError(`min_year (${from}) is after max_year (${to})`, 400);
	const byField = `(album.release_year>=${from} && album.release_year<=${to})`;
	// Albums MusicBrainz enrichment hasn't reached yet: use a Last.fm year tag.
	const tags = await pb.list<{ id: string; name: string }>("tags", {
		filter: `name>=${pbString(String(from))} && name<=${pbString(String(to))}`,
		fields: "id,name",
		perPage: 500,
		skipTotal: true,
	});
	const ids = tags.items.filter((t) => YEAR_TAG.test(t.name)).map((t) => `album.tag_relations~${pbString(t.id)}`);
	return ids.length ? `(${byField} || (album.release_year=0 && (${ids.join(" || ")})))` : byField;
}

const songKey = (t: TrackRec) => `${t.artist}|${t.album}|${fold(t.title)}`;

export async function randomTracks(pb: PocketBase, o: RandomOptions) {
	const count = Math.max(1, Math.min(o.count ?? 10, 50));
	const where: string[] = [];
	let artist: { id: string; name: string } | null = null;
	if (o.artist) {
		artist = await artistId(pb, o.artist);
		where.push(`artist=${pbString(artist.id)}`);
	}
	let unknown: string[] = [];
	if (o.tags?.length) {
		const t = await tagIds(pb, o.tags);
		unknown = t.unknown;
		if (t.ids.length === 0) return { count: 0, tracks: [], unknown_tags: unknown, message: "None of those tags exist." };
		where.push(`(${t.ids.map((id) => `album.tag_relations~${pbString(id)} || artist.tag_relations~${pbString(id)}`).join(" || ")})`);
	}
	if (o.min_plays !== undefined) where.push(`play_count>=${o.min_plays}`);
	if (o.max_plays !== undefined) where.push(`play_count<=${o.max_plays}`);
	if (o.min_duration_s !== undefined || o.max_duration_s !== undefined) where.push("duration_ms>0");
	if (o.min_duration_s !== undefined) where.push(`duration_ms>=${o.min_duration_s * 1000}`);
	if (o.max_duration_s !== undefined) where.push(`duration_ms<=${o.max_duration_s * 1000}`);
	const years = await yearCondition(pb, o.min_year, o.max_year);
	if (years) where.push(years);
	const filter = where.join(" && ");

	const picked = new Map<string, { song: TrackRec[]; first: TrackRec }>();
	// Songs sampled but not kept; used only if the rounds run out before `count` is reached.
	const spare = new Map<string, { song: TrackRec[]; first: TrackRec }>();
	let exhausted = false;
	for (let round = 0; round < ROUNDS && picked.size < count && !exhausted; round++) {
		const want = Math.min((count - picked.size) * OVERSAMPLE, MAX_SAMPLE);
		const sample = await pb.list<TrackRec>("tracks", {
			filter,
			sort: "@random",
			expand: "artist,album",
			perPage: want,
			skipTotal: true,
		});
		if (sample.items.length < want) exhausted = true; // the whole matching set fits in one sample
		const fresh = sample.items.filter((t) => !picked.has(songKey(t)));
		if (fresh.length === 0) continue;

		// Every record of each sampled song (same artist, release and title).
		const pairs = [...new Map(fresh.map((t) => [songKey(t), t])).values()];
		const siblings = await pb.list<TrackRec>("tracks", {
			filter: pairs.map((t) => `(artist=${pbString(t.artist)} && album=${pbString(t.album)} && title=${pbString(t.title)})`).join(" || "),
			fields: "id,title,artist,album,duration_ms,play_count,first_played_at,last_played_at",
			perPage: 500,
			skipTotal: true,
		});
		const bySong = new Map<string, TrackRec[]>();
		for (const s of siblings.items) bySong.set(songKey(s), [...(bySong.get(songKey(s)) ?? []), s]);

		for (const t of fresh) {
			const key = songKey(t);
			if (picked.has(key) || picked.size >= count) continue;
			const song = bySong.get(key) ?? [t];
			// When the sample already covers everything that matches, keep every song once.
			if (exhausted || Math.random() < 1 / song.length) {
				picked.set(key, { song, first: t });
				spare.delete(key);
			} else if (!spare.has(key)) spare.set(key, { song, first: t });
		}
	}
	for (const [key, s] of spare) {
		if (picked.size >= count) break;
		if (!picked.has(key)) picked.set(key, s);
	}

	const tracks = [...picked.values()].map(({ song, first }) => {
		const best = [...song].sort((a, b) => Number(b.duration_ms > 0) - Number(a.duration_ms > 0))[0];
		const firsts = song.map((s) => s.first_played_at).filter(Boolean).sort();
		const lasts = song.map((s) => s.last_played_at).filter(Boolean).sort();
		return {
			id: best.id,
			title: first.title,
			artist: first.expand?.artist?.name ?? null,
			album: first.expand?.album?.title ?? null,
			album_id: first.album || null,
			release_year: first.expand?.album?.release_year || null,
			duration_s: best.duration_ms ? Math.round(best.duration_ms / 1000) : null,
			play_count: song.reduce((n, s) => n + (s.play_count ?? 0), 0),
			first_played: firsts[0]?.slice(0, 10) ?? null,
			last_played: lasts[lasts.length - 1]?.slice(0, 10) ?? null,
		};
	});
	return {
		count: tracks.length,
		...(artist ? { artist: artist.name } : {}),
		...(unknown.length ? { unknown_tags: unknown } : {}),
		...(tracks.length < count ? { note: `Only ${tracks.length} distinct songs match these filters.` } : {}),
		tracks,
	};
}

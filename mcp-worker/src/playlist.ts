/**
 * create_tidal_playlist as a resumable job.
 *
 * Workers Free allows 50 subrequests per tool call, and matching a track costs
 * 2-6 TIDAL requests plus a cache write. So each call does as much as its
 * budget allows, saves progress in this Durable Object's storage, and returns
 * status "in_progress" until every track is matched (or missed) and, for a real
 * run, added to the playlist. Calling again with the same track ids resumes.
 *
 * Confident matches are also written to PocketBase's tidal_matches, which the
 * Python MCP server shares, so either server's earlier matches are reused.
 */

import { bestMatch, type LibraryTrack, type Score, searchQueries } from "./matching";
import { isRecordId, type PocketBase, pbString } from "./pocketbase";
import { ADD_BATCH, type Budget, OutOfBudget, type Tidal, TidalError } from "./tidal";

export const MIN_CONFIDENCE = 0.8;
export const JOB_PREFIX = "tidal-job:";
const JOB_TTL_MS = 3 * 24 * 3600 * 1000;
/** Record ids per PocketBase "a || b || ..." filter; keeps URLs short. */
const LOOKUP_CHUNK = 50;
/** Don't start a track with less than this left: one search is two requests. */
const MIN_FOR_TRACK = 2;

type Brief = { title: string; artist: string; album: string };
type Lib = Brief & { duration_s: number | null };
type CacheRow = { id: string; library_track: string; tidal_id: string; confidence: number; matched_title?: string; matched_artist?: string; matched_album?: string };

export type Matched = {
	track_id: string;
	matched: true;
	method: "cache" | "search";
	library: Brief;
	tidal_id: string;
	confidence: number;
	tidal: Brief;
	notes?: string[];
};
type Missed = {
	track_id: string;
	matched: false;
	reason: string;
	library?: Brief;
	best_candidate?: { tidal_id: string; confidence: number; tidal: Brief };
};
type Result = Matched | Missed;

export type PlaylistProgress = {
	id: string;
	url: string;
	added: number;
	batches_done: number;
	/** Per-run id for Idempotency-Keys, so resuming is safe but a later, separate add isn't swallowed. */
	run?: string;
};

export type Job = {
	created: number;
	ids: string[];
	/** Library details, null when the id isn't a library track. Filled in chunks. */
	library: Record<string, Lib | null>;
	/** tidal_matches record id per track, so a better match updates rather than duplicates. */
	cache_rows: Record<string, string>;
	results: Record<string, Result>;
	/** Keyed by playlist name: the same tracks can go into differently named playlists. */
	playlists: Record<string, PlaylistProgress>;
};

export type Deps = { pb: PocketBase; tidal: Tidal; budget: Budget; storage: DurableObjectStorage };

export async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const brief = (l: Lib): Brief => ({ title: l.title, artist: l.artist, album: l.album });
export const chunks = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const anyOf = (field: string, ids: string[]) => ids.map((id) => `${field}=${pbString(id)}`).join(" || ");

export async function loadJob(storage: DurableObjectStorage, key: string, ids: string[]): Promise<Job> {
	const existing = await storage.get<Job>(key);
	if (existing) return existing;
	// Starting a new job: drop ones nobody has touched for a few days.
	const old = await storage.list<Job>({ prefix: JOB_PREFIX });
	const stale = [...old].filter(([, j]) => Date.now() - j.created > JOB_TTL_MS).map(([k]) => k);
	if (stale.length) await storage.delete(stale);
	return { created: Date.now(), ids, library: {}, cache_rows: {}, results: {}, playlists: {} };
}

/** Library details and cached matches for tracks not looked up yet, 50 at a time (2 requests each). */
async function lookUp(job: Job, { pb }: Deps): Promise<void> {
	const todo = job.ids.filter((id) => !(id in job.library));
	for (const chunk of chunks(todo, LOOKUP_CHUNK)) {
		const valid = chunk.filter(isRecordId);
		const [tracks, cached] = valid.length
			? await Promise.all([
					pb.list<{ id: string; title: string; duration_ms: number; expand?: { artist?: { name: string }; album?: { title: string } } }>(
						"tracks",
						{ filter: anyOf("id", valid), expand: "artist,album", perPage: LOOKUP_CHUNK, skipTotal: true },
					),
					pb.list<CacheRow>("tidal_matches", { filter: anyOf("library_track", valid), perPage: LOOKUP_CHUNK, skipTotal: true }),
				])
			: [{ items: [] }, { items: [] }];

		const found = new Map(tracks.items.map((t) => [t.id, t]));
		const hits = new Map(cached.items.map((c) => [c.library_track, c]));
		for (const id of chunk) {
			const t = found.get(id);
			job.library[id] = t
				? {
						title: t.title,
						artist: t.expand?.artist?.name ?? "",
						album: t.expand?.album?.title ?? "",
						duration_s: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
					}
				: null;
			const lib = job.library[id];
			if (!lib) {
				job.results[id] = { track_id: id, matched: false, reason: "not a track in your library" };
				continue;
			}
			const hit = hits.get(id);
			if (hit) job.cache_rows[id] = hit.id;
			if (hit && Number(hit.confidence) >= MIN_CONFIDENCE) {
				job.results[id] = {
					track_id: id,
					matched: true,
					method: "cache",
					library: brief(lib),
					tidal_id: hit.tidal_id,
					confidence: Number(hit.confidence),
					tidal: { title: hit.matched_title ?? "", artist: hit.matched_artist ?? "", album: hit.matched_album ?? "" },
				};
			}
		}
	}
}

async function matchOne(id: string, lib: Lib, { tidal }: Deps): Promise<{ result: Result; best: Score | null }> {
	const track: LibraryTrack = { id, ...lib };
	const pool = [];
	let best: Score | null = null;
	for (const query of searchQueries(track)) {
		pool.push(...(await tidal.searchTracks(query, 10)));
		const s = bestMatch(track, pool);
		if (s && (!best || s.confidence > best.confidence)) best = s;
		if (best && best.confidence >= MIN_CONFIDENCE) break;
	}
	if (!best) return { result: { track_id: id, matched: false, reason: "no results on TIDAL", library: brief(lib) }, best };

	const c = best.candidate;
	const found = {
		tidal_id: c.tidal_id,
		confidence: best.confidence,
		tidal: { title: c.title + (c.version ? ` (${c.version})` : ""), artist: c.artists.join(", "), album: c.album ?? "" },
	};
	if (best.confidence < MIN_CONFIDENCE) {
		const why = best.notes.join("; ") || "names only partly match";
		return {
			result: {
				track_id: id,
				matched: false,
				reason: `no confident match (best ${best.confidence.toFixed(2)}: ${why})`,
				library: brief(lib),
				best_candidate: found,
			},
			best,
		};
	}
	return {
		result: { track_id: id, matched: true, method: "search", library: brief(lib), ...found, ...(best.notes.length ? { notes: best.notes } : {}) },
		best,
	};
}

/** Best effort: the cache saves work next time but is never worth failing a match over. */
async function remember(job: Job, r: Matched, { pb }: Deps): Promise<void> {
	const record = {
		library_track: r.track_id,
		tidal_id: r.tidal_id,
		confidence: r.confidence,
		method: "search",
		matched_title: r.tidal.title,
		matched_artist: r.tidal.artist,
		matched_album: r.tidal.album,
		matched_at: new Date().toISOString().replace("T", " "),
	};
	try {
		const row = job.cache_rows[r.track_id];
		if (row) await pb.update("tidal_matches", row, record);
		else job.cache_rows[r.track_id] = (await pb.create<{ id: string }>("tidal_matches", record)).id;
	} catch (e) {
		if (e instanceof OutOfBudget) throw e;
		console.log(JSON.stringify({ event: "tidal_cache_write_failed", track: r.track_id, error: String(e) }));
	}
}

/** Matches every track in the job that isn't matched yet. Throws OutOfBudget when the call's allowance runs out. */
export async function matchAll(job: Job, deps: Deps): Promise<void> {
	await lookUp(job, deps);
	for (const id of job.ids) {
		if (job.results[id]) continue;
		const lib = job.library[id];
		if (!lib) continue;
		if (deps.budget.remaining < MIN_FOR_TRACK) throw new OutOfBudget();
		const { result } = await matchOne(id, lib, deps);
		job.results[id] = result;
		if (result.matched) await remember(job, result, deps);
	}
}

export function summary(job: Job) {
	const results = job.ids.map((id) => job.results[id]).filter((r): r is Result => !!r);
	const matches = results.filter((r): r is Matched => r.matched);
	const misses = results.filter((r): r is Missed => !r.matched);
	return { matched_count: matches.length, miss_count: misses.length, matches, misses };
}

export function inProgress(job: Job, step: "matching" | "adding", detail: string, tool = "create_tidal_playlist") {
	const done = job.ids.filter((id) => job.results[id]).length;
	return {
		status: "in_progress",
		step,
		matched_so_far: done,
		total: job.ids.length,
		message: `${detail} Call ${tool} again with exactly the same arguments to continue; progress is saved.`,
	};
}

export async function createTidalPlaylist(
	args: { name: string; description: string; track_ids: string[]; dry_run: boolean },
	deps: Deps,
) {
	const ids = [...new Set(args.track_ids)];
	const key = JOB_PREFIX + (await sha256(ids.join(",")));
	const job = await loadJob(deps.storage, key, ids);

	try {
		// Fail fast (and cheaply) if TIDAL isn't connected, before any matching.
		await deps.tidal.connect();

		// 1. Match every track, as far as this call's budget goes.
		try {
			await matchAll(job, deps);
		} catch (e) {
			if (!(e instanceof OutOfBudget)) throw e;
			return inProgress(job, "matching", "Matched as many tracks as one call allows (Cloudflare caps requests per call).");
		}

		const result = summary(job);
		if (args.dry_run) {
			return {
				status: "preview",
				dry_run: true,
				name: args.name,
				...result,
				message: "Nothing was changed on TIDAL. Show the user the matches and misses, then call again with dry_run=false to create the playlist.",
			};
		}

		// 2. Create the playlist once, then add tracks in batches of 50.
		const tidalIds = [...new Set(result.matches.map((m) => m.tidal_id))];
		if (tidalIds.length === 0) throw new TidalError("None of the tracks matched on TIDAL, so no playlist was created");
		const nameKey = await sha256(`${key}|${args.name}`);
		let progress = job.playlists[args.name];
		try {
			if (!progress) {
				const p = await deps.tidal.createPlaylist(args.name, args.description, `create-${nameKey}`);
				progress = job.playlists[args.name] = { ...p, added: 0, batches_done: 0 };
			}
			const batches = chunks(tidalIds, ADD_BATCH);
			for (let i = progress.batches_done; i < batches.length; i++) {
				progress.added += await deps.tidal.addTracks(progress.id, batches[i], `add-${nameKey}-${i}`);
				progress.batches_done = i + 1;
			}
		} catch (e) {
			if (!(e instanceof OutOfBudget)) throw e;
			return {
				...inProgress(job, "adding", "The playlist exists but not every track has been added yet."),
				playlist: progress ? { id: progress.id, name: args.name, url: progress.url } : null,
			};
		}

		return {
			status: "created",
			dry_run: false,
			playlist: { id: progress.id, name: args.name, url: progress.url, tracks_added: progress.added },
			...result,
		};
	} finally {
		await deps.storage.put(key, job);
	}
}

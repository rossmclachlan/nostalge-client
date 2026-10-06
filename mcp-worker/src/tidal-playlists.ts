/**
 * Reading and editing the user's own TIDAL playlists: list, view, add, remove,
 * move, rename/describe and delete.
 *
 * Tools speak in 1-based positions. Each call re-reads the playlist, so
 * positions are always those of the current order. TIDAL addresses each
 * occurrence by an itemId, which keeps a track that appears twice unambiguous.
 */

import { chunks, type Deps, inProgress, JOB_PREFIX, loadJob, matchAll, sha256, summary } from "./playlist";
import { ADD_BATCH, OutOfBudget, type PlaylistItem, type Tidal, TidalError, type TrackInfo } from "./tidal";

/** Track details looked up per get_tidal_playlist call (20 per request). */
const DETAIL_WINDOW = 100;
const TIDAL_ID = /^\d+$/;

type Row = {
	position: number;
	tidal_id: string;
	title: string;
	artists: string[];
	album: string;
	duration_s: number | null;
	type?: string;
};

function row(position: number, item: PlaylistItem, info?: TrackInfo): Row {
	if (!info) return { position, tidal_id: item.id, title: "", artists: [], album: "", duration_s: null, ...(item.type !== "tracks" ? { type: item.type } : {}) };
	return {
		position,
		tidal_id: item.id,
		title: info.title + (info.version ? ` (${info.version})` : ""),
		artists: info.artists,
		album: info.album,
		duration_s: info.duration_s,
	};
}

/** Details for the given items' tracks (videos are left without names). */
async function details(tidal: Tidal, items: PlaylistItem[]): Promise<Map<string, TrackInfo>> {
	return tidal.trackDetails(items.filter((i) => i.type === "tracks").map((i) => i.id));
}

function checkPositions(positions: number[], length: number): number[] {
	const unique = [...new Set(positions)].sort((a, b) => a - b);
	const bad = unique.filter((p) => !Number.isInteger(p) || p < 1 || p > length);
	if (bad.length) throw new TidalError(`Position(s) ${bad.join(", ")} are outside the playlist (it has ${length} items)`);
	return unique;
}

// -- read ---------------------------------------------------------------------------

export async function listTidalPlaylists(tidal: Tidal, limit = 50) {
	const { playlists, more } = await tidal.myPlaylists(Math.max(1, Math.ceil(limit / 20)));
	return { playlists: playlists.slice(0, limit), more: more || playlists.length > limit };
}

export async function getTidalPlaylist(tidal: Tidal, playlistId: string, offset = 0, limit = DETAIL_WINDOW) {
	const [info, items] = await Promise.all([tidal.playlist(playlistId), tidal.playlistItems(playlistId)]);
	const window = items.slice(offset, offset + Math.min(limit, DETAIL_WINDOW));
	const names = await details(tidal, window);
	const shownTo = offset + window.length;
	return {
		...info,
		tracks: items.length,
		items: window.map((it, i) => row(offset + i + 1, it, names.get(it.id))),
		...(shownTo < items.length
			? { more: `Showing positions ${offset + 1}-${shownTo} of ${items.length}; call again with offset=${shownTo} for the rest.` }
			: {}),
	};
}

// -- add ------------------------------------------------------------------------------

/**
 * Adds library tracks (matched on TIDAL first, like create_tidal_playlist, and
 * sharing its saved matches) or TIDAL track ids directly. Inserts before
 * `position` if given, otherwise appends. Tracks already in the playlist are skipped.
 */
export async function addToTidalPlaylist(
	args: { playlist_id: string; track_ids?: string[]; tidal_track_ids?: string[]; position?: number; dry_run: boolean },
	deps: Deps,
) {
	const { tidal } = deps;
	const lib = [...new Set(args.track_ids ?? [])];
	const direct = [...new Set(args.tidal_track_ids ?? [])];
	if (lib.length === 0 && direct.length === 0) throw new TidalError("Give track_ids (library tracks) or tidal_track_ids");
	if (lib.length && direct.length) throw new TidalError("Give either track_ids or tidal_track_ids, not both");
	const badIds = direct.filter((id) => !TIDAL_ID.test(id));
	if (badIds.length) throw new TidalError(`Not TIDAL track ids: ${badIds.join(", ")}`);

	const info = await tidal.playlist(args.playlist_id);

	// Library tracks: match them (resumable, shared with create_tidal_playlist's jobs).
	const key = lib.length ? JOB_PREFIX + (await sha256(lib.join(","))) : null;
	const job = key ? await loadJob(deps.storage, key, lib) : null;
	try {
		let toAdd = direct;
		let matchSummary: ReturnType<typeof summary> | null = null;
		if (job) {
			try {
				await matchAll(job, deps);
			} catch (e) {
				if (!(e instanceof OutOfBudget)) throw e;
				return inProgress(job, "matching", "Matched as many tracks as one call allows.", "add_to_tidal_playlist");
			}
			matchSummary = summary(job);
			toAdd = [...new Set(matchSummary.matches.map((m) => m.tidal_id))];
		}

		if (args.dry_run) {
			return {
				status: "preview",
				dry_run: true,
				playlist: { id: info.id, name: info.name, tracks: info.tracks },
				would_add: toAdd.length,
				position: args.position ?? "end",
				...(matchSummary ?? {}),
				message: "Nothing was changed on TIDAL. Show the user what would be added, then call again with dry_run=false.",
			};
		}
		if (toAdd.length === 0) throw new TidalError("None of the tracks matched on TIDAL, so nothing was added");

		// Resolve the insert point against the current order.
		let before: string | undefined;
		if (args.position !== undefined) {
			const items = await tidal.playlistItems(args.playlist_id);
			if (args.position < 1) throw new TidalError("position starts at 1");
			before = args.position <= items.length ? items[args.position - 1].itemId : undefined;
		}

		// Progress is kept only while a run is unfinished (to resume it); once done it's
		// dropped, so asking again later really adds again (duplicates are skipped anyway).
		const progressKey = `existing:${args.playlist_id}:${args.position ?? "end"}`;
		const progress = job?.playlists[progressKey] ?? { id: info.id, url: info.url, added: 0, batches_done: 0 };
		progress.run ??= crypto.randomUUID();
		if (job) job.playlists[progressKey] = progress;
		const batches = chunks(toAdd, ADD_BATCH);
		try {
			for (let i = progress.batches_done; i < batches.length; i++) {
				progress.added += await tidal.addTracks(args.playlist_id, batches[i], `add-${progress.run}-${i}`, before);
				progress.batches_done = i + 1;
			}
		} catch (e) {
			if (!(e instanceof OutOfBudget) || !job) throw e;
			return inProgress(job, "adding", "Some tracks have been added; not all yet.", "add_to_tidal_playlist");
		}
		if (job) delete job.playlists[progressKey];

		return {
			status: "added",
			dry_run: false,
			playlist: { id: info.id, name: info.name, url: info.url },
			added: progress.added,
			skipped_already_present: toAdd.length - progress.added,
			...(matchSummary ? { miss_count: matchSummary.miss_count, misses: matchSummary.misses } : {}),
		};
	} finally {
		if (job && key) await deps.storage.put(key, job);
	}
}

// -- remove ---------------------------------------------------------------------------

export async function removeFromTidalPlaylist(
	tidal: Tidal,
	args: { playlist_id: string; positions?: number[]; tidal_track_ids?: string[] },
) {
	const items = await tidal.playlistItems(args.playlist_id);
	const picked = new Map<number, PlaylistItem>(); // position -> item
	for (const p of checkPositions(args.positions ?? [], items.length)) picked.set(p, items[p - 1]);
	const byTrack = new Set(args.tidal_track_ids ?? []);
	items.forEach((it, i) => {
		if (byTrack.has(it.id)) picked.set(i + 1, it);
	});
	if (picked.size === 0) {
		throw new TidalError(
			byTrack.size ? "None of those TIDAL track ids are in the playlist" : "Give positions or tidal_track_ids to remove",
		);
	}

	const chosen = [...picked.entries()].sort(([a], [b]) => a - b);
	const names = await details(tidal, chosen.slice(0, DETAIL_WINDOW).map(([, it]) => it));
	await tidal.removeItems(args.playlist_id, chosen.map(([, it]) => it));
	return {
		removed: chosen.map(([p, it]) => row(p, it, names.get(it.id))),
		tracks_left: items.length - chosen.length,
	};
}

// -- move -----------------------------------------------------------------------------

/** Each chunk lands just before the same anchor, after the previous chunk, so order is kept. */
async function moveInChunks(tidal: Tidal, playlistId: string, items: PlaylistItem[], before: string): Promise<void> {
	for (const part of chunks(items, ADD_BATCH)) await tidal.moveItems(playlistId, part, before);
}

/**
 * Moves the items at from_positions (keeping their relative order) so they sit
 * just before the item currently at to_position; to_position = length + 1
 * moves them to the end. Re-reads the playlist afterwards to confirm.
 */
export async function moveInTidalPlaylist(
	tidal: Tidal,
	args: { playlist_id: string; from_positions: number[]; to_position: number },
) {
	const items = await tidal.playlistItems(args.playlist_id);
	const from = checkPositions(args.from_positions, items.length);
	if (from.length === 0) throw new TidalError("Give at least one position to move");
	if (!Number.isInteger(args.to_position) || args.to_position < 1 || args.to_position > items.length + 1) {
		throw new TidalError(`to_position must be between 1 and ${items.length + 1}`);
	}
	const moving = new Set(from.map((p) => items[p - 1].itemId));
	const block = items.filter((it) => moving.has(it.itemId));
	const rest = items.filter((it) => !moving.has(it.itemId));

	// The anchor is the first unmoved item at or after to_position.
	const anchor = items.slice(args.to_position - 1).find((it) => !moving.has(it.itemId));
	let expected: PlaylistItem[];
	if (anchor) {
		const at = rest.indexOf(anchor);
		expected = [...rest.slice(0, at), ...block, ...rest.slice(at)];
		await moveInChunks(tidal, args.playlist_id, block, anchor.itemId);
	} else {
		// Moving to the end: TIDAL only inserts *before* an item, so instead move
		// every unmoved item that follows the first moved one to just before it.
		expected = [...rest, ...block];
		const firstMoved = items.findIndex((it) => moving.has(it.itemId));
		const after = items.slice(firstMoved).filter((it) => !moving.has(it.itemId));
		if (after.length) await moveInChunks(tidal, args.playlist_id, after, items[firstMoved].itemId);
	}

	const now = await tidal.playlistItems(args.playlist_id);
	const sameOrder = now.length === expected.length && now.every((it, i) => it.itemId === expected[i].itemId);
	const names = await details(tidal, block.slice(0, DETAIL_WINDOW));
	const newPos = new Map(now.map((it, i) => [it.itemId, i + 1]));
	return {
		moved: block.map((it) => ({
			...row(items.indexOf(it) + 1, it, names.get(it.id)),
			from: items.indexOf(it) + 1,
			to: newPos.get(it.itemId) ?? null,
		})),
		order_confirmed: sameOrder,
		...(sameOrder
			? {}
			: { warning: "TIDAL's resulting order differs from what was asked. Call get_tidal_playlist to see the current order." }),
	};
}

// -- details and delete -----------------------------------------------------------------

export async function updateTidalPlaylist(
	tidal: Tidal,
	args: { playlist_id: string; name?: string; description?: string; visibility?: "PUBLIC" | "UNLISTED" },
) {
	const attributes = {
		...(args.name !== undefined ? { name: args.name } : {}),
		...(args.description !== undefined ? { description: args.description } : {}),
		...(args.visibility !== undefined ? { accessType: args.visibility } : {}),
	};
	if (Object.keys(attributes).length === 0) throw new TidalError("Give a new name, description or visibility");
	await tidal.updatePlaylist(args.playlist_id, attributes);
	return { updated: Object.keys(attributes), playlist: await tidal.playlist(args.playlist_id) };
}

export async function deleteTidalPlaylist(tidal: Tidal, args: { playlist_id: string; confirm_name: string }) {
	const info = await tidal.playlist(args.playlist_id);
	if (info.name.trim() !== args.confirm_name.trim()) {
		throw new TidalError(`Not deleted: confirm_name must be the playlist's exact name, "${info.name}"`);
	}
	await tidal.deletePlaylist(args.playlist_id);
	return { deleted: true, id: info.id, name: info.name, tracks: info.tracks };
}

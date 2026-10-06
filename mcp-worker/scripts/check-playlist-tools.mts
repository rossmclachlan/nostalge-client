// Run: npx tsx scripts/check-playlist-tools.mts
// Exercises tidal-playlists.ts against an in-memory mock of TIDAL's v2 API
// (semantics from @tidal-music/api's OpenAPI types) and a mock PocketBase.
import assert from "node:assert/strict";
import { Budget, Tidal } from "../src/tidal.ts";
import { PocketBase } from "../src/pocketbase.ts";
import {
	addToTidalPlaylist, deleteTidalPlaylist, getTidalPlaylist, listTidalPlaylists,
	moveInTidalPlaylist, removeFromTidalPlaylist, updateTidalPlaylist,
} from "../src/tidal-playlists.ts";

const API = "https://openapi.tidal.com/v2";
const PB = "https://pb.test";
const PAGE = 3;

// ---- mock TIDAL state ----
const catalogue: Record<string, { title: string; artist: string; album: string; secs: number }> = {};
for (let i = 1; i <= 12; i++) catalogue[String(100 + i)] = { title: `Song ${i}`, artist: `Artist ${i % 3}`, album: `Album ${i % 4}`, secs: 180 + i };
type Item = { id: string; type: string; itemId: string };
const playlists: Record<string, { name: string; description: string; accessType: string; items: Item[]; owner: string; modified: number }> = {
	"pl-a": { name: "Test run 1", description: "", accessType: "UNLISTED", items: [], owner: "me", modified: 1 },
	"pl-b": { name: "Road trip", description: "old", accessType: "UNLISTED", items: [], owner: "me", modified: 2 },
	"pl-x": { name: "Someone else's", description: "", accessType: "PUBLIC", items: [], owner: "other", modified: 3 },
};
let nextItem = 1;
const idem = new Map<string, { status: number; body: unknown }>();
const calls: string[] = [];
const items = (pid: string) => playlists[pid].items.map((x) => x.id);
const seed = (pid: string, ids: string[]) => { playlists[pid].items = ids.map((id) => ({ id, type: "tracks", itemId: `it${nextItem++}` })); };

function pRes(id: string) {
	const p = playlists[id];
	return { id, type: "playlists", attributes: { name: p.name, description: p.description, accessType: p.accessType, numberOfItems: p.items.length, createdAt: "2026-10-01T00:00:00Z", lastModifiedAt: `2026-10-0${p.modified}T00:00:00Z`, externalLinks: [{ href: `https://tidal.com/playlist/${id}` }], playlistType: "USER" } };
}
const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/vnd.api+json" } });

function tidalHandler(method: string, url: URL, body: any): Response {
	const path = url.pathname.replace("/v2", "");
	let m: RegExpMatchArray | null;
	if (method === "GET" && path === "/playlists") {
		assert.equal(url.searchParams.get("filter[owners.id]"), "me");
		const mine = Object.keys(playlists).filter((k) => playlists[k].owner === "me").sort((a, b) => playlists[b].modified - playlists[a].modified);
		return json(200, { data: mine.map(pRes), links: { self: path } });
	}
	if ((m = path.match(/^\/playlists\/([^/]+)$/))) {
		const p = playlists[m[1]];
		if (!p) return json(404, { errors: [{ detail: "Playlist not found" }] });
		if (method === "GET") return json(200, { data: pRes(m[1]) });
		if (p.owner !== "me") return json(403, { errors: [{ detail: "Not the owner" }] });
		if (method === "PATCH") {
			assert.equal(body.data.id, m[1]); assert.equal(body.data.type, "playlists");
			Object.assign(p, body.data.attributes); p.modified = 9;
			return json(200, { data: pRes(m[1]) });
		}
		if (method === "DELETE") { delete playlists[m[1]]; return json(204, null); }
	}
	if ((m = path.match(/^\/playlists\/([^/]+)\/relationships\/items$/))) {
		const p = playlists[m[1]];
		if (!p) return json(404, { errors: [{ detail: "Playlist not found" }] });
		if (method === "GET") {
			const start = Number(url.searchParams.get("page[cursor]") ?? 0);
			const page = p.items.slice(start, start + PAGE);
			const next = start + PAGE < p.items.length ? `/playlists/${m[1]}/relationships/items?page[cursor]=${start + PAGE}` : undefined;
			return json(200, { data: page.map((x) => ({ id: x.id, type: x.type, meta: { itemId: x.itemId, addedAt: "2026-10-01T00:00:00Z" } })), links: { self: path, ...(next ? { next } : {}) } });
		}
		if (p.owner !== "me") return json(403, { errors: [{ detail: "Not the owner" }] });
		if (method === "POST") {
			assert.ok(body.data.length <= 50, "add batch over 50");
			const skipped: unknown[] = [];
			const fresh: Item[] = [];
			for (const d of body.data) {
				assert.equal(d.type, "tracks");
				if (body.meta?.onDuplicates === "SKIP" && p.items.some((x) => x.id === d.id)) { skipped.push({ id: d.id, reason: "ALREADY_PRESENT" }); continue; }
				fresh.push({ id: d.id, type: "tracks", itemId: `it${nextItem++}` });
			}
			const at = body.meta?.positionBefore ? p.items.findIndex((x) => x.itemId === body.meta.positionBefore) : -1;
			if (body.meta?.positionBefore && at < 0) return json(400, { errors: [{ detail: "positionBefore not found" }] });
			p.items.splice(at < 0 ? p.items.length : at, 0, ...fresh);
			return json(201, { data: fresh.map((x) => ({ id: x.id, type: x.type, meta: { itemId: x.itemId } })), meta: { skipped } });
		}
		if (method === "DELETE") {
			const gone = new Set(body.data.map((d: any) => { assert.ok(d.meta?.itemId, "remove needs meta.itemId"); return d.meta.itemId; }));
			p.items = p.items.filter((x) => !gone.has(x.itemId));
			return json(200, { meta: {} });
		}
		if (method === "PATCH") {
			assert.ok(body.meta?.positionBefore, "move needs meta.positionBefore");
			assert.ok(body.data.length <= 50, "move batch over 50");
			const moving = body.data.map((d: any) => p.items.find((x) => x.itemId === d.meta.itemId)!);
			const ids = new Set(moving.map((x: Item) => x.itemId));
			assert.ok(!ids.has(body.meta.positionBefore), "anchor is among moved items");
			const rest = p.items.filter((x) => !ids.has(x.itemId));
			const at = rest.findIndex((x) => x.itemId === body.meta.positionBefore);
			rest.splice(at, 0, ...moving);
			p.items = rest;
			return json(200, { meta: {} });
		}
	}
	if (method === "GET" && path === "/tracks") {
		const ids = url.searchParams.getAll("filter[id]");
		assert.ok(ids.length <= 20, "track lookup over 20");
		const data = ids.filter((id) => catalogue[id]).map((id) => ({ id, type: "tracks", attributes: { title: catalogue[id].title, duration: `PT3M${catalogue[id].secs - 180}S`, availability: ["STREAM"] }, relationships: { artists: { data: [{ id: `a-${id}`, type: "artists" }] }, albums: { data: [{ id: `b-${id}`, type: "albums" }] } } }));
		const included = ids.flatMap((id) => catalogue[id] ? [{ id: `a-${id}`, type: "artists", attributes: { name: catalogue[id].artist } }, { id: `b-${id}`, type: "albums", attributes: { title: catalogue[id].album } }] : []);
		return json(200, { data, included });
	}
	return json(404, { errors: [{ detail: `mock: no route ${method} ${path}` }] });
}

function pbHandler(url: URL): Response {
	if (url.pathname.endsWith("auth-with-password")) return new Response(JSON.stringify({ token: "pbtok" }), { status: 200 });
	const filter = url.searchParams.get("filter") ?? "";
	const ids = [...filter.matchAll(/"([a-z0-9]{15})"/g)].map((x) => x[1]);
	if (url.pathname.includes("/tracks/records")) {
		return new Response(JSON.stringify({ items: ids.map((id, i) => ({ id, title: `Song ${i + 1}`, duration_ms: (181 + i) * 1000, expand: { artist: { name: `Artist ${(i + 1) % 3}` }, album: { title: `Album ${(i + 1) % 4}` } } })) }));
	}
	if (url.pathname.includes("/tidal_matches/records")) {
		// Cached matches: library track N -> TIDAL 100+N
		return new Response(JSON.stringify({ items: ids.map((id, i) => ({ id: `cache${String(i).padStart(10, "0")}`, library_track: id, tidal_id: String(101 + i), confidence: 0.97, matched_title: `Song ${i + 1}` })) }));
	}
	return new Response("{}", { status: 404 });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any = {}) => {
	const url = new URL(String(input instanceof URL ? input : input.url ?? input));
	const method = init.method ?? "GET";
	if (url.origin === PB) return pbHandler(url);
	if (url.href.startsWith(API)) {
		calls.push(`${method} ${url.pathname.replace("/v2", "")}`);
		const body = init.body ? JSON.parse(init.body) : undefined;
		const key = init.headers?.["Idempotency-Key"];
		if (key && idem.has(key)) { const r = idem.get(key)!; return json(r.status, r.body); }
		const res = tidalHandler(method, url, body);
		if (key) idem.set(key, { status: res.status, body: await res.clone().json().catch(() => null) });
		return res;
	}
	return realFetch(input, init);
}) as typeof fetch;

// ---- session in a fake KV, sealed like tidal.ts does ----
const SECRET = "test-secret";
const kv = new Map<string, string>();
async function seal(obj: unknown) {
	const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SECRET}:tidal-session`));
	const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
	const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
	return `${b64(iv)}.${b64(sealed)}`;
}
kv.set("tidal:session", await seal({ access_token: "tok", refresh_token: "r", expires_at: Date.now() + 3600e3, country: "US", user_id: "me" }));
const env: any = { OAUTH_KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k) }, COOKIE_ENCRYPTION_KEY: SECRET, TIDAL_CLIENT_ID: "cid", PUBLIC_URL: "https://w.test" };
const store = new Map<string, unknown>();
const storage: any = { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => void store.set(k, structuredClone(v)), delete: async (k: any) => { for (const x of [k].flat()) store.delete(x); }, list: async ({ prefix }: any) => new Map([...store].filter(([k]) => k.startsWith(prefix))) };
const mk = (limit = 49) => new Tidal(env, new Budget(limit));
const deps = (limit = 49) => { const budget = new Budget(limit); return { pb: new PocketBase(PB, "e", "p", budget.fetch), tidal: new Tidal(env, budget), budget, storage }; };

let n = 0;
const step = (name: string) => console.log(`ok ${++n} - ${name}`);

// 1. list: only mine, newest first
const listed = await listTidalPlaylists(mk());
assert.deepEqual(listed.playlists.map((p) => p.name), ["Road trip", "Test run 1"]);
assert.equal(listed.playlists[0].url, "https://tidal.com/playlist/pl-b");
step("list_tidal_playlists returns only own playlists, newest first");

// 2. add direct tidal ids, preview then real; dupes skipped
const ten = Array.from({ length: 10 }, (_, i) => String(101 + i));
const prev = await addToTidalPlaylist({ playlist_id: "pl-a", tidal_track_ids: ten, dry_run: true }, deps());
assert.equal(prev.status, "preview"); assert.deepEqual(items("pl-a"), []);
const added = await addToTidalPlaylist({ playlist_id: "pl-a", tidal_track_ids: [...ten, "101"], dry_run: false }, deps());
assert.equal((added as any).added, 10); assert.deepEqual(items("pl-a"), ten);
step("add_to_tidal_playlist: dry run changes nothing; real run appends in order");

// 3. get with paging across cursor pages (page size 3), positions + names
const got = await getTidalPlaylist(mk(), "pl-a");
assert.equal(got.tracks, 10); assert.equal(got.items.length, 10);
assert.deepEqual(got.items.slice(0, 2).map((r) => [r.position, r.tidal_id, r.title, r.artists[0], r.album, r.duration_s]), [[1, "101", "Song 1", "Artist 1", "Album 1", 181], [2, "102", "Song 2", "Artist 2", "Album 2", 182]]);
const page2 = await getTidalPlaylist(mk(), "pl-a", 8);
assert.deepEqual(page2.items.map((r) => r.position), [9, 10]); assert.equal((page2 as any).more, undefined);
step("get_tidal_playlist reads every cursor page, numbers from 1, supports offset");

// 4. insert at a position
await addToTidalPlaylist({ playlist_id: "pl-a", tidal_track_ids: ["111", "112"], position: 2, dry_run: false }, deps());
assert.deepEqual(items("pl-a").slice(0, 4), ["101", "111", "112", "102"]);
step("add_to_tidal_playlist position=2 inserts before the current 2nd track");

// 5. remove by positions and by id (with a duplicate occurrence)
playlists["pl-a"].items.push({ id: "105", type: "tracks", itemId: `it${nextItem++}` }); // 105 now twice
const rm = await removeFromTidalPlaylist(mk(), { playlist_id: "pl-a", positions: [2, 3], tidal_track_ids: ["105"] });
assert.deepEqual(rm.removed.map((r) => r.tidal_id), ["111", "112", "105", "105"]);
assert.deepEqual(items("pl-a"), ["101", "102", "103", "104", "106", "107", "108", "109", "110"]);
assert.equal(rm.tracks_left, 9);
step("remove_from_tidal_playlist removes by position and every occurrence of an id");

// 6. remove: bad positions refused, nothing changed
await assert.rejects(removeFromTidalPlaylist(mk(), { playlist_id: "pl-a", positions: [0, 99] }), /outside the playlist/);
assert.equal(items("pl-a").length, 9);
step("remove refuses out-of-range positions without changing anything");

// 7. move forward, backward, to the end; confirmed by re-read
let mv = await moveInTidalPlaylist(mk(), { playlist_id: "pl-a", from_positions: [8, 9], to_position: 1 });
assert.deepEqual(items("pl-a"), ["109", "110", "101", "102", "103", "104", "106", "107", "108"]);
assert.equal(mv.order_confirmed, true); assert.deepEqual(mv.moved.map((m) => [m.from, m.to]), [[8, 1], [9, 2]]);
mv = await moveInTidalPlaylist(mk(), { playlist_id: "pl-a", from_positions: [1, 3], to_position: 10 });
assert.deepEqual(items("pl-a"), ["110", "102", "103", "104", "106", "107", "108", "109", "101"]);
assert.equal(mv.order_confirmed, true);
mv = await moveInTidalPlaylist(mk(), { playlist_id: "pl-a", from_positions: [2], to_position: 5 });
assert.deepEqual(items("pl-a"), ["110", "103", "104", "102", "106", "107", "108", "109", "101"]);
mv = await moveInTidalPlaylist(mk(), { playlist_id: "pl-a", from_positions: [4, 5], to_position: 5 }); // anchor inside the moved block
assert.deepEqual(items("pl-a"), ["110", "103", "104", "102", "106", "107", "108", "109", "101"]);
assert.equal(mv.order_confirmed, true);
step("move_tidal_playlist_tracks: to front, to end, forward, and anchor-inside-block no-op");

// 8. rename + visibility, then delete with name check
const up = await updateTidalPlaylist(mk(), { playlist_id: "pl-b", name: "Road trip 2026", visibility: "PUBLIC" });
assert.equal(up.playlist.name, "Road trip 2026"); assert.equal(up.playlist.visibility, "PUBLIC");
await assert.rejects(updateTidalPlaylist(mk(), { playlist_id: "pl-b" }), /Give a new name/);
await assert.rejects(deleteTidalPlaylist(mk(), { playlist_id: "pl-a", confirm_name: "Test run" }), /exact name, "Test run 1"/);
assert.ok(playlists["pl-a"]);
const del = await deleteTidalPlaylist(mk(), { playlist_id: "pl-a", confirm_name: "Test run 1" });
assert.equal(del.deleted, true); assert.equal(playlists["pl-a"], undefined);
step("update renames/changes visibility; delete needs the exact name");

// 9. someone else's playlist: TIDAL's 403 surfaces as an error, nothing changes
await assert.rejects(removeFromTidalPlaylist(mk(), { playlist_id: "pl-x", positions: [1] }), /outside|403/);
seed("pl-x", ["101"]);
await assert.rejects(removeFromTidalPlaylist(mk(), { playlist_id: "pl-x", positions: [1] }), /HTTP 403/);
await assert.rejects(deleteTidalPlaylist(mk(), { playlist_id: "pl-x", confirm_name: "Someone else's" }), /HTTP 403/);
assert.deepEqual(items("pl-x"), ["101"]);
step("editing a playlist you don't own fails with TIDAL's 403 and changes nothing");

// 10. library track ids: matched via cached matches (no search), then added; re-add after removal really re-adds
seed("pl-b", []);
const libIds = ["aaaaaaaaaaaaaa1", "aaaaaaaaaaaaaa2", "aaaaaaaaaaaaaa3"];
const libPrev = await addToTidalPlaylist({ playlist_id: "pl-b", track_ids: libIds, dry_run: true }, deps());
assert.equal((libPrev as any).matched_count, 3); assert.deepEqual(items("pl-b"), []);
await addToTidalPlaylist({ playlist_id: "pl-b", track_ids: libIds, dry_run: false }, deps());
assert.deepEqual(items("pl-b"), ["101", "102", "103"]);
await removeFromTidalPlaylist(mk(), { playlist_id: "pl-b", tidal_track_ids: ["102"] });
const again = await addToTidalPlaylist({ playlist_id: "pl-b", track_ids: libIds, dry_run: false }, deps());
assert.equal((again as any).added, 1, "re-adding after a removal must not be swallowed by idempotency replay");
assert.deepEqual(items("pl-b"), ["101", "103", "102"]);
step("library ids: matched from cache, added; a later identical add really adds (no stale replay)");

// 11. big playlist: adds batched by 50, moves chunked by 50, reads within budget
seed("pl-b", []);
for (let i = 200; i < 330; i++) catalogue[String(i)] = { title: `T${i}`, artist: "X", album: "Y", secs: 200 };
const many = Array.from({ length: 130 }, (_, i) => String(200 + i));
calls.length = 0;
await addToTidalPlaylist({ playlist_id: "pl-b", tidal_track_ids: many, dry_run: false }, deps());
assert.equal(calls.filter((c) => c.startsWith("POST")).length, 3);
assert.deepEqual(items("pl-b"), many);
await assert.rejects(getTidalPlaylist(mk(), "pl-b"), /too long|subrequest/);
step("adds batch by 50; an over-long playlist read fails clearly instead of silently truncating");

console.log(`\nall ${n} checks passed`);

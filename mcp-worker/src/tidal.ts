/**
 * TIDAL's official API (openapi.tidal.com/v2) for the owner's own account.
 *
 * Login is a one-time OAuth authorization code + PKCE flow: the connect_tidal
 * tool returns a link, TIDAL redirects to /tidal/callback, and the session
 * (refresh token included) is stored in KV, encrypted with a key derived from
 * COOKIE_ENCRYPTION_KEY. Access tokens are refreshed on demand.
 *
 * Every outbound request goes through a Budget, because Workers Free allows
 * only 50 subrequests per incoming request (one tool call).
 */

import type { Candidate } from "./matching";

const API = "https://openapi.tidal.com/v2";
const AUTHORIZE_URL = "https://login.tidal.com/authorize";
const TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";
// collection.* (favourites) and recommendations.read were added after the first
// release; sessions from before then lack them until the user reconnects.
const SCOPES = "playlists.read playlists.write search.read user.read collection.read collection.write recommendations.read";
const SESSION_KEY = "tidal:session";
const PKCE_PREFIX = "tidal:pkce:";
const PKCE_TTL_S = 600;
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
/** TIDAL caps filter[id] at 20 and playlist item adds at 50. */
export const TRACK_LOOKUP_MAX = 20;
export const ADD_BATCH = 50;

export class OutOfBudget extends Error {
	constructor() {
		super("This call has used its Cloudflare subrequest allowance");
	}
}

/** Counts outbound requests for one tool call and refuses to go past the limit. */
export class Budget {
	private used = 0;
	constructor(readonly limit: number) {}
	get remaining(): number {
		return this.limit - this.used;
	}
	take(n = 1): void {
		if (this.used + n > this.limit) throw new OutOfBudget();
		this.used += n;
	}
	fetch: typeof fetch = (input, init) => {
		this.take();
		return fetch(input, init);
	};
}

export class TidalNotConnected extends Error {
	constructor(detail = "") {
		super(`TIDAL isn't connected${detail ? ` (${detail})` : ""}. Call connect_tidal and open the link it returns.`);
	}
}

export class TidalError extends Error {}

type Session = {
	/** Space-separated scopes TIDAL granted, when it said (sessions from before this was recorded don't have it). */
	scope?: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
	country: string;
	user_id: string;
};

type TidalEnv = Pick<Env, "OAUTH_KV" | "COOKIE_ENCRYPTION_KEY" | "TIDAL_CLIENT_ID" | "PUBLIC_URL">;

// -- storage ---------------------------------------------------------------------

async function sessionKey(secret: string): Promise<CryptoKey> {
	const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:tidal-session`));
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (bytes: Uint8Array) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function saveSession(env: TidalEnv, s: Session): Promise<void> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sessionKey(env.COOKIE_ENCRYPTION_KEY), new TextEncoder().encode(JSON.stringify(s))),
	);
	await env.OAUTH_KV.put(SESSION_KEY, `${b64(iv)}.${b64(sealed)}`);
}

async function loadSession(env: TidalEnv): Promise<Session | null> {
	const stored = await env.OAUTH_KV.get(SESSION_KEY);
	if (!stored) return null;
	try {
		const [iv, sealed] = stored.split(".").map(unb64);
		const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await sessionKey(env.COOKIE_ENCRYPTION_KEY), sealed);
		return JSON.parse(new TextDecoder().decode(plain)) as Session;
	} catch {
		return null; // COOKIE_ENCRYPTION_KEY changed: treat as not connected
	}
}

function redirectUri(env: TidalEnv): string {
	if (!env.PUBLIC_URL) throw new TidalError("PUBLIC_URL is not set in wrangler.jsonc");
	return new URL("/tidal/callback", env.PUBLIC_URL).href;
}

function requireClientId(env: TidalEnv): string {
	if (!env.TIDAL_CLIENT_ID) throw new TidalError("TIDAL_CLIENT_ID is not set; add it as a Worker secret");
	return env.TIDAL_CLIENT_ID;
}

// -- one-time login -----------------------------------------------------------------

/** A single-use TIDAL authorize link, valid for 10 minutes. */
export async function startLogin(env: TidalEnv): Promise<string> {
	const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
	const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
	const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
	await env.OAUTH_KV.put(PKCE_PREFIX + state, verifier, { expirationTtl: PKCE_TTL_S });

	const url = new URL(AUTHORIZE_URL);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: requireClientId(env),
		redirect_uri: redirectUri(env),
		scope: SCOPES,
		code_challenge_method: "S256",
		code_challenge: challenge,
		state,
	}).toString();
	return url.href;
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; user_id?: number | string; scope?: string };

async function tokenRequest(
	form: Record<string, string>,
	f: typeof fetch = (input, init) => fetch(input, init),
): Promise<TokenResponse> {
	const res = await f(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(form),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
	if (!res.ok || !body.access_token) {
		const why = body.error_description || body.error || `HTTP ${res.status}`;
		if (res.status === 400 || res.status === 401) throw new TidalNotConnected(why);
		throw new TidalError(`TIDAL token request failed: ${why}`);
	}
	return body;
}

/** Handles /tidal/callback: swaps the code for tokens and stores the session. */
export async function finishLogin(env: TidalEnv, url: URL): Promise<Session> {
	const state = url.searchParams.get("state") ?? "";
	const code = url.searchParams.get("code") ?? "";
	const denied = url.searchParams.get("error_description") || url.searchParams.get("error");
	if (denied) throw new TidalError(`TIDAL login was not completed: ${denied}`);
	const verifier = state ? await env.OAUTH_KV.get(PKCE_PREFIX + state) : null;
	if (!verifier || !code) throw new TidalError("This login link has expired or was already used. Ask Claude to call connect_tidal again.");
	await env.OAUTH_KV.delete(PKCE_PREFIX + state);

	const tok = await tokenRequest({
		grant_type: "authorization_code",
		client_id: requireClientId(env),
		code,
		redirect_uri: redirectUri(env),
		code_verifier: verifier,
	});
	const session: Session = {
		access_token: tok.access_token!,
		refresh_token: tok.refresh_token ?? "",
		expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000,
		country: "",
		user_id: String(tok.user_id ?? ""),
		scope: tok.scope ?? SCOPES,
	};
	if (!session.refresh_token) throw new TidalError("TIDAL returned no refresh token");

	// Search results depend on the account's country.
	const me = await fetch(`${API}/users/me`, {
		headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/vnd.api+json" },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (me.ok) {
		const body = (await me.json()) as { data?: { id?: string; attributes?: { country?: string } } };
		session.country = body.data?.attributes?.country ?? "";
		session.user_id = body.data?.id ?? session.user_id;
	}
	await saveSession(env, session);
	return session;
}

export async function connectionStatus(
	env: TidalEnv,
): Promise<{ connected: boolean; country?: string; missing_permissions?: string[] }> {
	const s = await loadSession(env);
	if (!s) return { connected: false };
	// Sessions saved before scopes were recorded may predate favourites/recommendations access.
	const granted = new Set((s.scope ?? "playlists.read playlists.write search.read user.read").split(/\s+/));
	const missing = SCOPES.split(" ").filter((x) => !granted.has(x));
	return { connected: true, country: s.country || undefined, ...(missing.length ? { missing_permissions: missing } : {}) };
}

// -- API client --------------------------------------------------------------------

export type Resource = {
	id: string;
	type: string;
	attributes?: Record<string, unknown>;
	relationships?: Record<string, { data?: { id: string; type: string }[] | { id: string; type: string } | null }>;
};
export type Doc = {
	data?: Resource | Resource[];
	included?: Resource[];
	meta?: Record<string, unknown>;
	links?: { next?: string; self?: string };
};

/** A track with the names needed to show or match it. */
export type TrackInfo = {
	tidal_id: string;
	title: string;
	version: string | null;
	duration_s: number | null;
	isrc: string | null;
	artists: string[];
	album: string;
	available: boolean;
};

/** One occurrence of a track (or video) in a playlist. itemId tells duplicates apart. */
export type PlaylistItem = { id: string; type: string; itemId: string };

export type PlaylistInfo = {
	id: string;
	name: string;
	description: string;
	visibility: string;
	tracks: number | null;
	created_at: string | null;
	modified_at: string | null;
	url: string;
};

function playlistInfo(p: Resource): PlaylistInfo {
	const a = p.attributes ?? {};
	const links = (a.externalLinks ?? []) as { href?: string }[];
	const count = a.numberOfItems ?? a.numberOfTrackItems;
	return {
		id: p.id,
		name: String(a.name ?? ""),
		description: String(a.description ?? ""),
		visibility: String(a.accessType ?? ""),
		tracks: typeof count === "number" ? count : null,
		created_at: typeof a.createdAt === "string" ? a.createdAt : null,
		modified_at: typeof a.lastModifiedAt === "string" ? a.lastModifiedAt : null,
		url: links.find((l) => l.href)?.href ?? `https://tidal.com/playlist/${p.id}`,
	};
}

/** The cursor from a JSON:API `links.next` (absolute or relative), if there is a next page. */
function nextCursor(doc: Doc): string | null {
	if (!doc.links?.next) return null;
	return new URL(doc.links.next, API).searchParams.get("page[cursor]");
}

/** "PT3M58S" -> 238 */
export function isoSeconds(d: unknown): number | null {
	const m = typeof d === "string" ? d.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/) : null;
	if (!m) return null;
	return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

export const asList = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

export class Tidal {
	private session: Session | null = null;

	constructor(
		private readonly env: TidalEnv,
		private readonly budget: Budget,
	) {}

	/** Loads the session and refreshes the access token if it's about to expire. */
	async connect(): Promise<void> {
		this.session ??= await loadSession(this.env);
		if (!this.session) throw new TidalNotConnected();
		if (this.session.expires_at - 60_000 < Date.now()) await this.refresh();
	}

	private async refresh(): Promise<void> {
		const s = this.session!;
		const tok = await tokenRequest(
			{ grant_type: "refresh_token", refresh_token: s.refresh_token, client_id: requireClientId(this.env) },
			this.budget.fetch,
		);
		this.session = {
			...s,
			access_token: tok.access_token!,
			refresh_token: tok.refresh_token || s.refresh_token,
			expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000,
		};
		await saveSession(this.env, this.session);
	}

	/** One API call with token refresh and retries; also used by the tidal-*.ts tool modules. */
	async request(
		method: "GET" | "POST" | "PATCH" | "DELETE",
		path: string,
		opts: { query?: [string, string][]; body?: unknown; idempotencyKey?: string } = {},
	): Promise<Doc> {
		await this.connect();
		const url = new URL(API + path);
		for (const [k, v] of opts.query ?? []) url.searchParams.append(k, v);
		if (this.session!.country) url.searchParams.set("countryCode", this.session!.country);

		let refreshed = false;
		for (let attempt = 1; ; attempt++) {
			const headers: Record<string, string> = {
				Authorization: `Bearer ${this.session!.access_token}`,
				Accept: "application/vnd.api+json",
			};
			if (opts.body !== undefined) headers["Content-Type"] = "application/vnd.api+json";
			if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

			const res = await this.budget.fetch(url, {
				method,
				headers,
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (res.ok) return (await res.json().catch(() => ({}))) as Doc;

			const detail = await res
				.json()
				.then((b) => ((b as { errors?: { detail?: string }[] }).errors ?? []).map((e) => e.detail).filter(Boolean).join("; "))
				.catch(() => "");
			if (res.status === 401 && !refreshed) {
				refreshed = true;
				await this.refresh();
				continue;
			}
			if (res.status === 401) throw new TidalNotConnected(detail || "TIDAL rejected the token");
			const retryable = res.status === 429 || res.status >= 500;
			if (!retryable || attempt >= MAX_ATTEMPTS || this.budget.remaining < 1) {
				throw new TidalError(`TIDAL ${method} ${path} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
			}
			const retryAfter = Number(res.headers.get("Retry-After"));
			const wait = Math.min(retryAfter > 0 ? retryAfter : 2 ** attempt, 10);
			await new Promise((r) => setTimeout(r, wait * 1000 + Math.random() * 300));
		}
	}

	/** Top search hits for a query, with artist and album names. Two requests. */
	async searchTracks(query: string, limit = 10): Promise<Candidate[]> {
		const found = await this.request("GET", "/searchResults", {
			query: [
				["filter[query]", query.slice(0, 256)],
				["include", "tracks"],
			],
		});
		const ids = asList(found.data)
			.flatMap((r) => asList(r.relationships?.tracks?.data))
			.map((t) => t.id)
			.slice(0, Math.min(limit, TRACK_LOOKUP_MAX));
		if (ids.length === 0) return [];

		const details = await this.trackDetails(ids);
		return ids.flatMap((id) => details.get(id) ?? []);
	}

	/** Names, duration and availability for tracks, 20 per request. */
	async trackDetails(ids: string[]): Promise<Map<string, TrackInfo>> {
		const out = new Map<string, TrackInfo>();
		const unique = [...new Set(ids)];
		for (let i = 0; i < unique.length; i += TRACK_LOOKUP_MAX) {
			const batch = unique.slice(i, i + TRACK_LOOKUP_MAX);
			const doc = await this.request("GET", "/tracks", {
				query: [...batch.map((id): [string, string] => ["filter[id]", id]), ["include", "artists"], ["include", "albums"]],
			});
			const included = new Map((doc.included ?? []).map((r) => [`${r.type}:${r.id}`, r]));
			for (const t of asList(doc.data)) {
				const a = t.attributes ?? {};
				const names = (type: string, rel: string, field: string) =>
					asList(t.relationships?.[rel]?.data)
						.map((x) => included.get(`${type}:${x.id}`)?.attributes?.[field])
						.filter((x): x is string => typeof x === "string" && x !== "");
				const availability = a.availability;
				out.set(t.id, {
					tidal_id: t.id,
					title: String(a.title ?? ""),
					version: typeof a.version === "string" && a.version ? a.version : null,
					duration_s: isoSeconds(a.duration),
					isrc: typeof a.isrc === "string" ? a.isrc : null,
					artists: names("artists", "artists", "name"),
					album: names("albums", "albums", "title")[0] ?? "",
					available: Array.isArray(availability) ? availability.includes("STREAM") : true,
				});
			}
		}
		return out;
	}

	async createPlaylist(name: string, description: string, idempotencyKey: string): Promise<{ id: string; url: string }> {
		const doc = await this.request("POST", "/playlists", {
			body: { data: { type: "playlists", attributes: { name, description, accessType: "UNLISTED" } } },
			idempotencyKey,
		});
		const p = asList(doc.data)[0];
		if (!p?.id) throw new TidalError("TIDAL created the playlist but returned no id");
		const links = (p.attributes?.externalLinks ?? []) as { href?: string }[];
		return { id: p.id, url: links.find((l) => l.href)?.href ?? `https://tidal.com/playlist/${p.id}` };
	}

	/**
	 * Adds up to 50 tracks, skipping any already in the playlist. Appends unless
	 * positionBefore (an itemId) is given. Returns how many were added.
	 */
	async addTracks(playlistId: string, trackIds: string[], idempotencyKey: string, positionBefore?: string): Promise<number> {
		const doc = await this.request("POST", `/playlists/${encodeURIComponent(playlistId)}/relationships/items`, {
			body: {
				data: trackIds.map((id) => ({ id, type: "tracks" })),
				meta: { onDuplicates: "SKIP", ...(positionBefore ? { positionBefore } : {}) },
			},
			idempotencyKey,
		});
		const skipped = asList((doc.meta as { skipped?: unknown[] } | undefined)?.skipped).length;
		return trackIds.length - skipped;
	}

	/** Playlists the signed-in user owns, most recently changed first. */
	async myPlaylists(maxPages = 5): Promise<{ playlists: PlaylistInfo[]; more: boolean }> {
		const playlists: PlaylistInfo[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < maxPages; page++) {
			const doc = await this.request("GET", "/playlists", {
				query: [["filter[owners.id]", "me"], ["sort", "-lastModifiedAt"], ...(cursor ? [["page[cursor]", cursor] as [string, string]] : [])],
			});
			playlists.push(...asList(doc.data).map(playlistInfo));
			cursor = nextCursor(doc);
			if (!cursor) return { playlists, more: false };
		}
		return { playlists, more: true };
	}

	async playlist(playlistId: string): Promise<PlaylistInfo> {
		const doc = await this.request("GET", `/playlists/${encodeURIComponent(playlistId)}`);
		const p = asList(doc.data)[0];
		if (!p) throw new TidalError(`No TIDAL playlist with id ${playlistId}`);
		return playlistInfo(p);
	}

	/** Every item in playlist order, following page cursors. One request per page. */
	async playlistItems(playlistId: string, maxPages = 30): Promise<PlaylistItem[]> {
		const items: PlaylistItem[] = [];
		let cursor: string | null = null;
		for (let page = 0; page < maxPages; page++) {
			const doc = await this.request("GET", `/playlists/${encodeURIComponent(playlistId)}/relationships/items`, {
				query: cursor ? [["page[cursor]", cursor]] : [],
			});
			for (const r of asList(doc.data) as (Resource & { meta?: { itemId?: string } })[]) {
				items.push({ id: r.id, type: r.type, itemId: r.meta?.itemId ?? "" });
			}
			cursor = nextCursor(doc);
			if (!cursor) return items;
		}
		throw new TidalError(`Playlist ${playlistId} is too long to read in one call (over ${maxPages} pages)`);
	}

	/** Removes specific occurrences (by itemId), 50 per request. */
	async removeItems(playlistId: string, items: PlaylistItem[]): Promise<void> {
		for (let i = 0; i < items.length; i += ADD_BATCH) {
			await this.request("DELETE", `/playlists/${encodeURIComponent(playlistId)}/relationships/items`, {
				body: { data: items.slice(i, i + ADD_BATCH).map((x) => ({ id: x.id, type: x.type, meta: { itemId: x.itemId } })) },
			});
		}
	}

	/** Moves items, keeping their relative order, to just before the item with itemId positionBefore. */
	async moveItems(playlistId: string, items: PlaylistItem[], positionBefore: string): Promise<void> {
		await this.request("PATCH", `/playlists/${encodeURIComponent(playlistId)}/relationships/items`, {
			body: {
				data: items.map((x) => ({ id: x.id, type: x.type, meta: { itemId: x.itemId } })),
				meta: { positionBefore },
			},
		});
	}

	async updatePlaylist(
		playlistId: string,
		attributes: { name?: string; description?: string; accessType?: "PUBLIC" | "UNLISTED" },
	): Promise<void> {
		await this.request("PATCH", `/playlists/${encodeURIComponent(playlistId)}`, {
			body: { data: { id: playlistId, type: "playlists", attributes } },
		});
	}

	async deletePlaylist(playlistId: string): Promise<void> {
		await this.request("DELETE", `/playlists/${encodeURIComponent(playlistId)}`);
	}
}

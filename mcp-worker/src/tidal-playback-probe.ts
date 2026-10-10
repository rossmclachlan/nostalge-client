/**
 * Read-only probe: can this TIDAL app see (and so maybe control) playback?
 *
 * TIDAL's v2 spec (@tidal-music/api 0.52) has remote-control endpoints that
 * aren't in the public docs yet:
 *   /userPlaybackStates/me        playbackStatus IDLE|PLAYING|PAUSED, activePlayer,
 *                                 availablePlayers (installations), playQueue
 *   /playQueues?filter[owners.id] the user's queues (current, future, past)
 *   /scopes                       every OAuth scope with its requiredAccessTier
 * Whether a third-party app may use them is the open question, so this
 * changes nothing and reports TIDAL's raw answers, errors included.
 */

import { asList, type Doc, type Resource, type Tidal } from "./tidal";

type Probe = { ok: true; data: unknown } | { ok: false; error: string };

async function attempt(f: () => Promise<Doc>, shape: (d: Doc) => unknown): Promise<Probe> {
	try {
		return { ok: true, data: shape(await f()) };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

const brief = (r: Resource) => ({ type: r.type, id: r.id, ...(r.attributes ?? {}) });
const linkage = (r: Resource, rel: string) => {
	const d = r.relationships?.[rel]?.data;
	return d === undefined ? undefined : asList(d).map((x) => `${x.type}:${x.id}`);
};

// "playlists" is deliberately not a match.
const PLAYBACK_WORDS = /\bplay(back|er|ers|ing)?\b|queue|install|device|stream|remote|control/i;

const TIERS = ["THIRD_PARTY", "THIRD_PARTY_PROD", "PARTNER", "INTERNAL"] as const;
const STATE_INCLUDES: [string, string][] = [["include", "activePlayer"], ["include", "availablePlayers"], ["include", "playQueue"]];

/**
 * Calls each endpoint with `me` and, if that isn't found or comes back empty,
 * again with the numeric TIDAL user id. Verdicts only count real data: an
 * empty queue list could mean nothing is queued or that the app can't see it.
 */
export async function probeTidalPlayback(tidal: Tidal, granted?: string) {
	// countryCode is added to every request by default; these endpoints may not accept it.
	const get = (path: string, query: [string, string][] = []) => () => tidal.request("GET", path, { query, country: false });

	// filter[requiredAccessTier] is required; one request per tier shows which tiers are readable.
	const byTier: Record<string, Probe> = {};
	const all: { name: unknown; tier: unknown; description: unknown }[] = [];
	for (const tier of TIERS) {
		byTier[tier] = await attempt(get("/scopes", [["filter[requiredAccessTier]", tier]]), (d) => {
			const found = asList(d.data).map((r) => ({ name: r.attributes?.name, tier: r.attributes?.requiredAccessTier ?? tier, description: r.attributes?.description }));
			all.push(...found);
			return { count: found.length, more_pages: Boolean(d.links?.next) };
		});
	}
	const grantedSet = new Set((granted ?? "").split(/\s+/).filter(Boolean));
	const scopes = {
		requests: byTier,
		playback_related: all
			.filter((x) => PLAYBACK_WORDS.test(`${x.name} ${x.description}`))
			.map((x) => ({ ...x, granted_to_this_connection: grantedSet.has(String(x.name)) })),
		third_party: all.filter((x) => String(x.tier).startsWith("THIRD_PARTY")).map((x) => x.name),
		this_connection_granted: granted ?? null,
	};

	// The numeric id, for retries; fetched only if a `me` call needs one.
	let userId: string | null | undefined;
	const numericId = async () => {
		if (userId === undefined) {
			const me = await attempt(get("/users/me"), (d) => asList(d.data)[0]?.id ?? null);
			userId = me.ok ? (me.data as string | null) : null;
		}
		return userId;
	};

	const readState = (id: string) =>
		attempt(get(`/userPlaybackStates/${id}`, STATE_INCLUDES), (d) => {
			const st = asList(d.data)[0];
			return {
				playback_status: st?.attributes?.playbackStatus ?? null,
				active_player: st ? linkage(st, "activePlayer") : undefined,
				available_players: st ? linkage(st, "availablePlayers") : undefined,
				play_queue: st ? linkage(st, "playQueue") : undefined,
				included: (d.included ?? []).map(brief),
			};
		});
	const state: Record<string, Probe> = { me: await readState("me") };
	if (!state.me.ok && /HTTP 404/.test(state.me.error)) {
		const id = await numericId();
		if (id) state[`user ${id}`] = await readState(id);
	}

	const readQueues = (owner: string) =>
		attempt(get("/playQueues", [["filter[owners.id]", owner], ["include", "current"]]), (d) => ({
			queues: asList(d.data).map((q) => ({ ...brief(q), current: linkage(q, "current") })),
			included: (d.included ?? []).map(brief),
		}));
	const queues: Record<string, Probe> = { me: await readQueues("me") };
	const emptyOrMissing = (p: Probe) => !p.ok || (p.data as { queues: unknown[] }).queues.length === 0;
	if (emptyOrMissing(queues.me)) {
		const id = await numericId();
		if (id) queues[`user ${id}`] = await readQueues(id);
	}

	const sawState = Object.values(state).some((p) => p.ok);
	const sawQueue = Object.values(queues).some((p) => !emptyOrMissing(p));
	const refused = [...Object.values(state), ...Object.values(queues)].filter((p) => !p.ok && /HTTP 40[13]/.test(p.error)).length;
	return {
		verdict: sawState || sawQueue
			? "Confirmed: TIDAL returned real playback data to this app, so remote control looks possible."
			: refused
				? "Refused: TIDAL denied access to playback. Check scopes.playback_related for a THIRD_PARTY permission to request via connect_tidal extra_scopes."
				: "Inconclusive: no permission errors, but no playback data either (no playback state, empty queues). Re-run while TIDAL is actively playing on a device.",
		scopes,
		user_playback_state: state,
		play_queues: queues,
	};
}

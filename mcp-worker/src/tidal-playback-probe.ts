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

export async function probeTidalPlayback(tidal: Tidal) {
	// countryCode is added to every request by default; these endpoints may not accept it.
	const get = (path: string, query: [string, string][] = []) => () => tidal.request("GET", path, { query, country: false });

	const scopes = await attempt(get("/scopes"), (d) => {
		const all = asList(d.data).map((r) => ({
			name: r.attributes?.name,
			tier: r.attributes?.requiredAccessTier,
			description: r.attributes?.description,
		}));
		return {
			playback_related: all.filter((s) => PLAYBACK_WORDS.test(`${s.name} ${s.description}`)),
			third_party: all.filter((s) => String(s.tier).startsWith("THIRD_PARTY")).map((s) => s.name),
			total: all.length,
			more_pages: Boolean(d.links?.next),
		};
	});

	const state = await attempt(get("/userPlaybackStates/me", [["include", "activePlayer"], ["include", "availablePlayers"], ["include", "playQueue"]]), (d) => {
		const me = asList(d.data)[0];
		return {
			playback_status: me?.attributes?.playbackStatus ?? null,
			active_player: me ? linkage(me, "activePlayer") : undefined,
			available_players: me ? linkage(me, "availablePlayers") : undefined,
			play_queue: me ? linkage(me, "playQueue") : undefined,
			included: (d.included ?? []).map(brief),
		};
	});

	const queues = await attempt(get("/playQueues", [["filter[owners.id]", "me"], ["include", "current"]]), (d) => ({
		queues: asList(d.data).map((q) => ({ ...brief(q), current: linkage(q, "current") })),
		included: (d.included ?? []).map(brief),
	}));

	const playbackOk = state.ok || queues.ok;
	return {
		verdict: playbackOk
			? "TIDAL answered at least one playback endpoint: remote control looks possible for this app."
			: "TIDAL refused both playback endpoints. If a playback scope with a THIRD_PARTY tier is listed under scopes, reconnect with it (connect_tidal extra_scopes) and probe again; otherwise this app can't control playback.",
		scopes,
		user_playback_state: state,
		play_queues: queues,
	};
}

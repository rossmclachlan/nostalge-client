import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { findTracks, getCrate, listCrates, releasesByTag, searchLibrary, TRACK_SORTS } from "./library";
import { createTidalPlaylist } from "./playlist";
import { randomTracks } from "./random";
import { PocketBase } from "./pocketbase";
import { Budget, connectionStatus, startLogin, Tidal } from "./tidal";
import {
	addToTidalPlaylist,
	deleteTidalPlaylist,
	getTidalPlaylist,
	listTidalPlaylists,
	moveInTidalPlaylist,
	removeFromTidalPlaylist,
	updateTidalPlaylist,
} from "./tidal-playlists";
import type { Props } from "./utils";

// GitHub logins allowed to use this server (compared case-insensitively).
// Anyone else can complete the GitHub sign-in but gets no tools.
const ALLOWED_USERNAMES = new Set<string>(
	[
		"rossmclachlan",
	].map((u: string) => u.toLowerCase()),
);

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export class NostalgeMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Nostalge music library",
		version: "0.1.0",
	});

	private pb(fetcher?: typeof fetch): PocketBase {
		return new PocketBase(this.env.PB_URL, this.env.PB_EMAIL, this.env.PB_PASSWORD, fetcher);
	}

	/** Outbound requests one tool call may make (Workers Free: 50), less one for headroom. */
	private budget(): Budget {
		const limit = Number(this.env.SUBREQUEST_LIMIT) || 50;
		return new Budget(Math.max(10, limit - 1));
	}

	/** Log the call (never secrets), and turn failures into a readable tool error. */
	private async run(tool: string, args: unknown, fn: () => Promise<unknown>): Promise<ToolResult> {
		const started = Date.now();
		try {
			const data = await fn();
			console.log(JSON.stringify({ tool, user: this.props?.login, args, ok: true, ms: Date.now() - started }));
			return ok(data);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.log(JSON.stringify({ tool, user: this.props?.login, args, ok: false, error: message }));
			return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
		}
	}

	async init() {
		const login = this.props?.login?.toLowerCase();
		if (!login || !ALLOWED_USERNAMES.has(login)) {
			console.log(JSON.stringify({ event: "no_tools", user: this.props?.login ?? null }));
			return;
		}

		this.server.tool(
			"search_library",
			"Search the music library by artist, album (release) or track name. Returns matching artists, releases and tracks, most played first.",
			{
				query: z.string().min(1).max(200).describe("Text to match against artist, album or track names"),
				limit: z.number().int().min(1).max(50).optional().describe("Max results per type (default 10)"),
			},
			async ({ query, limit }) => this.run("search_library", { query, limit }, () => searchLibrary(this.pb(), query, limit)),
		);

		this.server.tool(
			"list_crates",
			"List crates (albums/releases) in the library, most played first, with artist, year and tags. Paginated.",
			{
				limit: z.number().int().min(1).max(200).optional().describe("Crates per page (default 100)"),
				page: z.number().int().min(1).optional().describe("Page number (default 1)"),
			},
			async ({ limit, page }) => this.run("list_crates", { limit, page }, () => listCrates(this.pb(), { limit, page })),
		);

		this.server.tool(
			"get_crate",
			"Get one crate (album/release) with its artist, tags, notes and tracklist.",
			{ crateId: z.string().min(1).describe("Crate id from list_crates or search_library") },
			async ({ crateId }) => this.run("get_crate", { crateId }, () => getCrate(this.pb(), crateId)),
		);

		this.server.tool(
			"releases_by_tag",
			"List releases (albums) carrying a genre/mood/era tag, e.g. 'shoegaze' or '90s'. Tag names are case-insensitive.",
			{
				tag: z.string().min(1).max(100).describe("Tag name"),
				limit: z.number().int().min(1).max(200).optional().describe("Max releases (default 50)"),
			},
			async ({ tag, limit }) => this.run("releases_by_tag", { tag, limit }, () => releasesByTag(this.pb(), tag, limit)),
		);

		const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
		this.server.tool(
			"find_tracks",
			[
				"Find library tracks by listening history and length: play count, when first and last played, and duration.",
				"Play counts and dates come from the user's full scrobble history (back to 2006).",
				"'First played' is the best stand-in for 'date added', since most tracks were bulk-imported on one day.",
				"Only ~73% of tracks have a duration; duration filters skip the rest. Paginated.",
			].join(" "),
			{
				min_plays: z.number().int().min(0).optional().describe("At least this many plays"),
				max_plays: z.number().int().min(0).optional().describe("At most this many plays (0 = never played)"),
				min_duration_s: z.number().int().min(0).optional().describe("Minimum length in seconds"),
				max_duration_s: z.number().int().min(1).optional().describe("Maximum length in seconds"),
				first_played_from: isoDate.optional().describe("First played on or after (YYYY-MM-DD)"),
				first_played_to: isoDate.optional().describe("First played on or before (YYYY-MM-DD)"),
				last_played_from: isoDate.optional().describe("Last played on or after (YYYY-MM-DD)"),
				last_played_to: isoDate.optional().describe("Last played on or before (YYYY-MM-DD)"),
				sort: z
					.enum(Object.keys(TRACK_SORTS) as [keyof typeof TRACK_SORTS, ...(keyof typeof TRACK_SORTS)[]])
					.optional()
					.describe("Default most_played"),
				limit: z.number().int().min(1).max(100).optional().describe("Tracks per page (default 25)"),
				page: z.number().int().min(1).optional().describe("Page number (default 1)"),
			},
			async (opts) => this.run("find_tracks", opts, () => findTracks(this.pb(), opts)),
		);

		this.server.tool(
			"random_tracks",
			"Pick N random songs from the library, optionally by artist, tags (any), play count, length or release year. Every matching song is equally likely (duplicate track records are accounted for). Use it instead of fetching everything and choosing.",
			{
				count: z.number().int().min(1).max(50).optional().describe("How many songs (default 10)"),
				artist: z.string().min(1).max(200).optional().describe("Artist name (case-insensitive) or id"),
				tags: z.array(z.string().min(1).max(100)).max(10).optional().describe("Songs whose release or artist has any of these tags"),
				min_plays: z.number().int().min(0).optional().describe("At least this many plays"),
				max_plays: z.number().int().min(0).optional().describe("At most this many plays (0 = never played)"),
				min_duration_s: z.number().int().min(0).optional().describe("Minimum length in seconds"),
				max_duration_s: z.number().int().min(1).optional().describe("Maximum length in seconds"),
				min_year: z.number().int().min(1900).max(2099).optional().describe("Released in or after this year"),
				max_year: z.number().int().min(1900).max(2099).optional().describe("Released in or before this year"),
			},
			async (opts) => this.run("random_tracks", opts, () => randomTracks(this.pb(), opts)),
		);

		this.server.tool(
			"connect_tidal",
			"Check whether TIDAL is connected, and get a one-time link (valid 10 minutes) for the user to open in a browser and sign in to TIDAL. Needed once before create_tidal_playlist, and again if TIDAL access is revoked.",
			{},
			async () =>
				this.run("connect_tidal", {}, async () => {
					const status = await connectionStatus(this.env);
					return {
						...status,
						login_link: await startLogin(this.env),
						message: status.connected
							? "TIDAL is already connected. Only open the link to switch accounts or reconnect."
							: "Ask the user to open login_link, sign in to TIDAL and approve access, then try again.",
					};
				}),
		);

		this.server.tool(
			"create_tidal_playlist",
			[
				"Create a private (unlisted) TIDAL playlist from library tracks, in the given order.",
				"Use track ids from get_crate or search_library.",
				"dry_run=true (the default) matches each track on TIDAL and reports matches and misses without changing anything:",
				"show those to the user and only call again with dry_run=false once they agree.",
				"Long lists are processed over several calls: while the result has status 'in_progress', call again with exactly the same arguments.",
			].join(" "),
			{
				name: z.string().min(1).max(200).describe("Playlist name"),
				description: z.string().max(500).optional().describe("Playlist description"),
				track_ids: z.array(z.string().min(1)).min(1).max(500).describe("Library track ids, in playlist order"),
				dry_run: z.boolean().optional().describe("true (default): preview matches only; false: create the playlist"),
			},
			async ({ name, description, track_ids, dry_run }) =>
				this.run("create_tidal_playlist", { name, tracks: track_ids.length, dry_run: dry_run ?? true }, () => {
					const budget = this.budget();
					return createTidalPlaylist(
						{ name, description: description ?? "", track_ids, dry_run: dry_run ?? true },
						{ pb: this.pb(budget.fetch), tidal: new Tidal(this.env, budget), budget, storage: this.ctx.storage },
					);
				}),
		);

		// -- Editing the user's own TIDAL playlists -------------------------------------
		const tidal = () => new Tidal(this.env, this.budget());
		const playlistId = z.string().min(1).max(100).describe("TIDAL playlist id (from list_tidal_playlists or create_tidal_playlist)");
		const positions = z.array(z.number().int().min(1)).max(500);

		this.server.tool(
			"list_tidal_playlists",
			"List the user's own TIDAL playlists, most recently changed first, with ids, track counts and links.",
			{ limit: z.number().int().min(1).max(200).optional().describe("Max playlists (default 50)") },
			async ({ limit }) => this.run("list_tidal_playlists", { limit }, () => listTidalPlaylists(tidal(), limit ?? 50)),
		);

		this.server.tool(
			"get_tidal_playlist",
			"Show a TIDAL playlist's details and its tracks with 1-based positions (100 per call; use offset for more). Positions are what the remove and move tools take.",
			{
				playlist_id: playlistId,
				offset: z.number().int().min(0).optional().describe("Skip this many tracks (default 0)"),
			},
			async ({ playlist_id, offset }) =>
				this.run("get_tidal_playlist", { playlist_id, offset }, () => getTidalPlaylist(tidal(), playlist_id, offset ?? 0)),
		);

		this.server.tool(
			"add_to_tidal_playlist",
			[
				"Add tracks to one of the user's TIDAL playlists, appended or inserted before a position.",
				"Pass library track ids (matched on TIDAL first, like create_tidal_playlist) or TIDAL track ids. Tracks already in the playlist are skipped.",
				"dry_run=true (default) previews; call again with dry_run=false once the user agrees.",
				"While the result has status 'in_progress', call again with exactly the same arguments.",
			].join(" "),
			{
				playlist_id: playlistId,
				track_ids: z.array(z.string().min(1)).min(1).max(500).optional().describe("Library track ids, in order"),
				tidal_track_ids: z.array(z.string().min(1)).min(1).max(500).optional().describe("TIDAL track ids, in order"),
				position: z.number().int().min(1).optional().describe("Insert before the track now at this 1-based position (default: append)"),
				dry_run: z.boolean().optional().describe("true (default): preview only; false: add the tracks"),
			},
			async ({ playlist_id, track_ids, tidal_track_ids, position, dry_run }) =>
				this.run(
					"add_to_tidal_playlist",
					{ playlist_id, tracks: track_ids?.length, tidal_tracks: tidal_track_ids?.length, position, dry_run: dry_run ?? true },
					() => {
						const budget = this.budget();
						return addToTidalPlaylist(
							{ playlist_id, track_ids, tidal_track_ids, position, dry_run: dry_run ?? true },
							{ pb: this.pb(budget.fetch), tidal: new Tidal(this.env, budget), budget, storage: this.ctx.storage },
						);
					},
				),
		);

		this.server.tool(
			"remove_from_tidal_playlist",
			"Remove tracks from one of the user's TIDAL playlists, by 1-based position (from get_tidal_playlist) and/or every occurrence of given TIDAL track ids. Takes effect immediately.",
			{
				playlist_id: playlistId,
				positions: positions.optional().describe("1-based positions to remove"),
				tidal_track_ids: z.array(z.string().min(1)).max(500).optional().describe("Remove every occurrence of these TIDAL track ids"),
			},
			async ({ playlist_id, positions, tidal_track_ids }) =>
				this.run("remove_from_tidal_playlist", { playlist_id, positions, tidal_track_ids }, () =>
					removeFromTidalPlaylist(tidal(), { playlist_id, positions, tidal_track_ids }),
				),
		);

		this.server.tool(
			"move_tidal_playlist_tracks",
			"Reorder one of the user's TIDAL playlists: move the tracks at from_positions (keeping their order) to just before the track now at to_position; use the track count + 1 to move them to the end. Confirms the new order.",
			{
				playlist_id: playlistId,
				from_positions: positions.min(1).describe("1-based positions of the tracks to move"),
				to_position: z.number().int().min(1).describe("1-based position to move them before (track count + 1 = end)"),
			},
			async ({ playlist_id, from_positions, to_position }) =>
				this.run("move_tidal_playlist_tracks", { playlist_id, from_positions, to_position }, () =>
					moveInTidalPlaylist(tidal(), { playlist_id, from_positions, to_position }),
				),
		);

		this.server.tool(
			"update_tidal_playlist",
			"Rename one of the user's TIDAL playlists, or change its description or visibility.",
			{
				playlist_id: playlistId,
				name: z.string().min(1).max(200).optional(),
				description: z.string().max(500).optional(),
				visibility: z.enum(["PUBLIC", "UNLISTED"]).optional().describe("PUBLIC (on your profile) or UNLISTED (link only)"),
			},
			async ({ playlist_id, name, description, visibility }) =>
				this.run("update_tidal_playlist", { playlist_id, name, visibility }, () =>
					updateTidalPlaylist(tidal(), { playlist_id, name, description, visibility }),
				),
		);

		this.server.tool(
			"delete_tidal_playlist",
			"Permanently delete one of the user's TIDAL playlists. Only do this when the user asked; confirm_name must be the playlist's exact current name.",
			{
				playlist_id: playlistId,
				confirm_name: z.string().min(1).max(200).describe("The playlist's exact name, as a safety check"),
			},
			async ({ playlist_id, confirm_name }) =>
				this.run("delete_tidal_playlist", { playlist_id, confirm_name }, () =>
					deleteTidalPlaylist(tidal(), { playlist_id, confirm_name }),
				),
		);
	}
}

export default new OAuthProvider({
	apiHandler: NostalgeMCP.serve("/mcp"),
	apiRoute: "/mcp",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GitHubHandler as any,
	tokenEndpoint: "/token",
});

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { getCrate, listCrates, releasesByTag, searchLibrary } from "./library";
import { PocketBase } from "./pocketbase";
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

	private pb(): PocketBase {
		return new PocketBase(this.env.PB_URL, this.env.PB_EMAIL, this.env.PB_PASSWORD);
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

		this.server.tool(
			"create_tidal_playlist",
			"Create a TIDAL playlist from a list of tracks. NOT IMPLEMENTED YET: currently returns status 'not_implemented' without contacting TIDAL.",
			{
				name: z.string().min(1).max(200).describe("Playlist name"),
				description: z.string().max(500).optional().describe("Playlist description"),
				tracks: z
					.array(z.object({ artist: z.string().min(1), title: z.string().min(1) }))
					.min(1)
					.max(500)
					.describe("Tracks in playlist order"),
			},
			async ({ name, description, tracks }) =>
				this.run("create_tidal_playlist", { name, tracks: tracks.length }, async () => {
					// TODO(tidal): implement playlist creation. Needed:
					//  1. TIDAL auth: register an app at developer.tidal.com and run the OAuth 2.1
					//     authorization-code + PKCE flow once (scopes: playlists.read playlists.write,
					//     search.read). Store the refresh token in KV (encrypted) or as a secret, and
					//     refresh the ~1h access token on demand. This is a second OAuth flow, separate
					//     from the GitHub one that protects this server; add a /tidal/callback route.
					//  2. Matching: for each {artist, title}, search the TIDAL catalogue (v2 API,
					//     openapi.tidal.com/v2/searchResults/{query}?include=tracks), score candidates on
					//     normalised title/artist similarity and duration, and skip live/karaoke/cover/
					//     sped-up versions. Return misses with reasons rather than guessing.
					//  3. Writes: POST /v2/playlists (name, description, accessType PRIVATE), then
					//     POST /v2/playlists/{id}/relationships/items in batches (<= 20 per request),
					//     retrying 429s with backoff (honour Retry-After).
					//  4. Add a dry_run flag (default true) so Claude previews matches before writing.
					//  The Python server in ../mcp-server/server/{matching,tidal}.py has tested scoring
					//  logic that can be ported.
					return {
						status: "not_implemented",
						message: "TIDAL playlist creation is not implemented yet; nothing was sent to TIDAL.",
						received: { name, description: description ?? null, track_count: tracks.length },
					};
				}),
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

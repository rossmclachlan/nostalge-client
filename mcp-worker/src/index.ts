import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { getCrate, listCrates, releasesByTag, searchLibrary } from "./library";
import { createTidalPlaylist } from "./playlist";
import { PocketBase } from "./pocketbase";
import { Budget, connectionStatus, startLogin, Tidal } from "./tidal";
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

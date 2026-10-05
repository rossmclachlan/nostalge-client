// Secrets set with `wrangler secret put` (or .dev.vars locally). `wrangler types`
// only knows about bindings in wrangler.jsonc, so they are declared here.
interface NostalgeSecrets {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	COOKIE_ENCRYPTION_KEY: string;
	/** PocketBase base URL, e.g. https://nas.tailnet.ts.net (Tailscale Funnel) */
	PB_URL: string;
	PB_EMAIL: string;
	PB_PASSWORD: string;
	/** Client id of the app registered at developer.tidal.com */
	TIDAL_CLIENT_ID: string;
}

interface Env extends NostalgeSecrets {}

declare namespace Cloudflare {
	interface Env extends NostalgeSecrets {}
}

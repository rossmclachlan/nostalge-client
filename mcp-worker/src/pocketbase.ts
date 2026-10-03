/**
 * Minimal PocketBase REST client for the Worker.
 *
 * Authenticates as a superuser. PocketBase >= 0.23 exposes that as the
 * `_superusers` auth collection; 0.22 (what music-cms-mvp currently pins)
 * uses `/api/admins`. We try the former and fall back on 404, then remember
 * which one worked. The token is cached for 30 minutes per isolate.
 */

const TOKEN_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 10_000;

const AUTH_PATHS = [
	"/api/collections/_superusers/auth-with-password", // PocketBase >= 0.23
	"/api/admins/auth-with-password", // PocketBase <= 0.22
] as const;

export class PocketBaseError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

/** Quote a value for use inside a PocketBase filter expression. */
export function pbString(value: string): string {
	// Filter strings are double-quoted; escape backslashes first, then quotes.
	// Control characters have no place in a search term, so drop them.
	const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ");
	return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** PocketBase record ids are 15 lowercase alphanumerics by default. */
export function isRecordId(id: string): boolean {
	return /^[a-z0-9]{15}$/.test(id);
}

type CachedToken = { key: string; token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;
let workingAuthPath: string | null = null;
let inflightLogin: Promise<string> | null = null;

export type ListParams = {
	filter?: string;
	sort?: string;
	expand?: string;
	fields?: string;
	page?: number;
	perPage?: number;
	skipTotal?: boolean;
};

export type ListResult<T> = {
	page: number;
	perPage: number;
	totalItems: number;
	totalPages: number;
	items: T[];
};

export class PocketBase {
	private readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly email: string,
		private readonly password: string,
	) {
		if (!baseUrl || !email || !password) {
			throw new PocketBaseError("PocketBase is not configured: set the PB_URL, PB_EMAIL and PB_PASSWORD secrets");
		}
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	private get cacheKey(): string {
		return `${this.baseUrl}|${this.email}`;
	}

	private async authenticate(): Promise<string> {
		const paths = workingAuthPath ? [workingAuthPath] : AUTH_PATHS;
		for (const path of paths) {
			const res = await fetch(this.baseUrl + path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ identity: this.email, password: this.password }),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (res.status === 404 && !workingAuthPath) continue; // endpoint from another PocketBase version
			if (!res.ok) {
				throw new PocketBaseError(
					`PocketBase superuser login failed (HTTP ${res.status}); check PB_EMAIL / PB_PASSWORD`,
					res.status,
				);
			}
			const body = (await res.json()) as { token?: string };
			if (!body.token) throw new PocketBaseError("PocketBase login returned no token");
			workingAuthPath = path;
			cachedToken = { key: this.cacheKey, token: body.token, expiresAt: Date.now() + TOKEN_TTL_MS };
			return body.token;
		}
		throw new PocketBaseError("PocketBase has no superuser login endpoint; is PB_URL pointing at PocketBase?");
	}

	private async token(): Promise<string> {
		if (cachedToken && cachedToken.key === this.cacheKey && cachedToken.expiresAt > Date.now()) {
			return cachedToken.token;
		}
		// Parallel tool queries share one login instead of each starting their own.
		inflightLogin ??= this.authenticate().finally(() => {
			inflightLogin = null;
		});
		return inflightLogin;
	}

	private async get<T>(path: string, params: Record<string, string>): Promise<T> {
		const url = new URL(this.baseUrl + path);
		for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

		for (let attempt = 0; attempt < 2; attempt++) {
			const res = await fetch(url, {
				headers: { Authorization: await this.token() },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if ((res.status === 401 || res.status === 403) && attempt === 0) {
				cachedToken = null; // token revoked or expired early: log in again once
				continue;
			}
			if (!res.ok) {
				let detail = "";
				try {
					detail = ((await res.json()) as { message?: string }).message ?? "";
				} catch {
					// non-JSON error body
				}
				throw new PocketBaseError(`PocketBase request failed (HTTP ${res.status}) ${detail}`.trim(), res.status);
			}
			return (await res.json()) as T;
		}
		throw new PocketBaseError("PocketBase rejected the superuser token");
	}

	list<T>(collection: string, p: ListParams = {}): Promise<ListResult<T>> {
		const params: Record<string, string> = {
			page: String(p.page ?? 1),
			perPage: String(p.perPage ?? 50),
		};
		if (p.filter) params.filter = p.filter;
		if (p.sort) params.sort = p.sort;
		if (p.expand) params.expand = p.expand;
		if (p.fields) params.fields = p.fields;
		if (p.skipTotal) params.skipTotal = "1";
		return this.get(`/api/collections/${encodeURIComponent(collection)}/records`, params);
	}

	getOne<T>(collection: string, id: string, expand?: string): Promise<T> {
		if (!isRecordId(id)) throw new PocketBaseError(`Not a valid record id: ${JSON.stringify(id)}`, 400);
		return this.get(
			`/api/collections/${encodeURIComponent(collection)}/records/${id}`,
			expand ? { expand } : {},
		);
	}
}

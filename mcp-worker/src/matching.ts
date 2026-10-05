/**
 * Pure scoring of TIDAL candidates against a library track. No I/O here.
 *
 * A port of ../../mcp-server/server/matching.py, kept score-for-score
 * identical so both servers agree on what counts as a match (they share the
 * tidal_matches cache). scripts/check-matching-parity.mjs checks that.
 *
 * confidence = weighted similarity (title, artist, album, duration ±5s)
 *              - penalties for unwanted versions (live, remaster, karaoke, cover,
 *                sped up, ...) that the library track is *not* itself.
 */

export type LibraryTrack = {
	id: string;
	title: string;
	artist: string;
	album?: string;
	duration_s?: number | null;
};

export type Candidate = {
	tidal_id: string;
	title: string;
	artists: string[];
	album?: string;
	duration_s?: number | null;
	version?: string | null;
	isrc?: string | null;
	available?: boolean;
	via_isrc?: boolean;
};

export type Score = { candidate: Candidate; confidence: number; notes: string[] };

const DURATION_TOLERANCE_S = 5;

// Python's \w and \b are Unicode-aware; JavaScript's \b is ASCII-only even
// with the u flag, so spell the word boundary out.
const W = "[\\p{L}\\p{N}_]";
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const re = (src: string, flags = "") => new RegExp(src.replaceAll("\\b", B), `u${flags}`);

// flag -> [pattern, penalty when only the candidate has it]
const VERSION_FLAGS: Record<string, [RegExp, number]> = {
	karaoke: [re("karaoke|originally performed|in the style of|backing track"), 0.6],
	sped_up: [re("sped[\\s-]*up|speed[\\s-]*up|slowed|nightcore|\\breverb\\b|\\b8d\\b"), 0.6],
	cover: [re("\\bcover\\b|\\btribute\\b|made famous by"), 0.5],
	live: [re("\\blive\\b|\\bin concert\\b|\\bunplugged\\b|\\bbbc session"), 0.3],
	instrumental: [re("\\binstrumental\\b"), 0.3],
	remix: [re("\\bremix\\b|\\brmx\\b|\\bmix\\)|\\bdub\\b"), 0.25],
	acoustic: [re("\\bacoustic\\b"), 0.2],
	demo: [re("\\bdemo\\b|\\bearly version\\b|\\balternate\\b|\\bouttake\\b"), 0.2],
	remaster: [re("\\bremaster(ed)?\\b|\\bremastering\\b"), 0.05],
};
const LIVE_ALBUM = re("\\blive (at|in|from|on)\\b|\\bin concert\\b|\\bunplugged\\b|^live$");

// Decorations: "(...)", "[...]", and " - suffix" parts of a title.
const BRACKETS = () => /[([]([^)\]]*)[)\]]/gu;
const DASH_SUFFIX = /\s+[-–—]\s+(.+)$/u;
const FEAT = re("\\b(feat|ft|featuring)\\b.+$");
const NON_WORD = /[^\p{L}\p{N}_\s]/gu;
const SPACES = /\s+/gu;

/** Lowercase, strip accents, unify '&'/'and' and punctuation. */
export function fold(s: string | null | undefined): string {
	let t = (s ?? "").normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();
	t = t.replaceAll("&", " and ").replaceAll("’", "'");
	t = t.replace(NON_WORD, " ");
	return t.replace(SPACES, " ").trim();
}

/** The bracketed / dash-suffixed parts of a title, e.g. ['live', '2011 remaster']. */
export function decorations(title: string | null | undefined): string[] {
	const t = title ?? "";
	const parts = [...t.matchAll(BRACKETS())].map((m) => m[1]);
	const m = t.replace(BRACKETS(), "").match(DASH_SUFFIX);
	if (m) parts.push(m[1]);
	return parts;
}

/** Title without decorations or featured-artist credits, folded. */
export function coreTitle(title: string | null | undefined): string {
	let t = (title ?? "").replace(BRACKETS(), " ");
	t = t.replace(DASH_SUFFIX, "");
	t = fold(t);
	t = t.replace(FEAT, "").trim();
	return t || fold(title);
}

/**
 * Which special versions a track is, judged only from decorations, the version
 * field and (for 'live') the album title -- never the bare title, so a song
 * called "Live Forever" is not a live recording.
 */
export function versionFlags(title: string, version?: string | null, album = ""): Set<string> {
	const text = [...decorations(title), version ?? ""]
		.filter((p) => p)
		.map(fold)
		.join(" | ");
	const flags = new Set(Object.keys(VERSION_FLAGS).filter((name) => VERSION_FLAGS[name][0].test(text)));
	if (LIVE_ALBUM.test(fold(album)) || decorations(album).some((d) => VERSION_FLAGS.live[0].test(fold(d)))) {
		flags.add("live");
	}
	return flags;
}

/** difflib.SequenceMatcher(None, a, b).ratio(), including its autojunk rule. */
export function sequenceRatio(aStr: string, bStr: string): number {
	const a = Array.from(aStr);
	const b = Array.from(bStr);
	if (a.length + b.length === 0) return 1;

	const b2j = new Map<string, number[]>();
	b.forEach((elt, i) => {
		const idxs = b2j.get(elt);
		if (idxs) idxs.push(i);
		else b2j.set(elt, [i]);
	});
	if (b.length >= 200) {
		const ntest = Math.floor(b.length / 100) + 1;
		for (const [elt, idxs] of [...b2j]) if (idxs.length > ntest) b2j.delete(elt);
	}

	const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
		let [besti, bestj, bestsize] = [alo, blo, 0];
		let j2len = new Map<number, number>();
		for (let i = alo; i < ahi; i++) {
			const next = new Map<number, number>();
			for (const j of b2j.get(a[i]) ?? []) {
				if (j < blo) continue;
				if (j >= bhi) break;
				const k = (j2len.get(j - 1) ?? 0) + 1;
				next.set(j, k);
				if (k > bestsize) [besti, bestj, bestsize] = [i - k + 1, j - k + 1, k];
			}
			j2len = next;
		}
		// No junk function, so only the non-junk extensions apply.
		while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
			besti--;
			bestj--;
			bestsize++;
		}
		while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
			bestsize++;
		}
		return [besti, bestj, bestsize];
	};

	let matches = 0;
	const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
	while (queue.length) {
		const [alo, ahi, blo, bhi] = queue.pop()!;
		const [i, j, k] = longest(alo, ahi, blo, bhi);
		if (k) {
			matches += k;
			if (alo < i && blo < j) queue.push([alo, i, blo, j]);
			if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
		}
	}
	return (2 * matches) / (a.length + b.length);
}

const sortTokens = (s: string) =>
	s
		.split(" ")
		.filter((x) => x)
		.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
		.join(" ");

/** Max of character ratio and token-sort ratio, on folded strings. */
export function similarity(aIn: string, bIn: string): number {
	const a = fold(aIn);
	const b = fold(bIn);
	if (!a || !b) return 0;
	if (a === b) return 1;
	return Math.max(sequenceRatio(a, b), sequenceRatio(sortTokens(a), sortTokens(b)));
}

function stripThe(s: string): string {
	const t = fold(s);
	return t.startsWith("the ") ? t.slice(4) : t;
}

export function artistSimilarity(libraryArtist: string, candidateArtists: string[]): number {
	if (candidateArtists.length === 0) return 0;
	const lib = stripThe(libraryArtist);
	const joined = stripThe(candidateArtists.join(" and "));
	let best = Math.max(...candidateArtists.map((a) => similarity(lib, stripThe(a))));
	best = Math.max(best, similarity(lib, joined));
	// "Artist A & Artist B" in the library vs a primary artist on TIDAL
	const libParts = lib.split(" and ");
	if (candidateArtists.some((a) => stripThe(a) && libParts.includes(stripThe(a)))) best = Math.max(best, 0.9);
	return best;
}

export function durationScore(libS?: number | null, candS?: number | null): number | null {
	if (!libS || !candS) return null;
	const diff = Math.abs(libS - candS);
	if (diff <= DURATION_TOLERANCE_S) return 1;
	return Math.max(0, 1 - (diff - DURATION_TOLERANCE_S) / 25); // 0 at 30s off
}

export function score(track: LibraryTrack, cand: Candidate): Score {
	const notes: string[] = [];
	const titleSim = similarity(coreTitle(track.title), coreTitle(cand.title));
	const artSim = artistSimilarity(track.artist, cand.artists);

	const parts: [number, number][] = [
		[0.45, titleSim],
		[0.35, artSim],
	];
	if (track.album && cand.album) parts.push([0.1, similarity(coreTitle(track.album), coreTitle(cand.album))]);
	const dur = durationScore(track.duration_s, cand.duration_s);
	if (dur !== null) {
		parts.push([0.1, dur]);
		if (dur < 1) notes.push(`duration differs by ${Math.abs(track.duration_s! - cand.duration_s!)}s`);
	}
	const totalW = parts.reduce((s, [w]) => s + w, 0);
	let conf = parts.reduce((s, [w, v]) => s + w * v, 0) / totalW;
	// Outside ±5s is usually a different edit or version: weigh it beyond its share.
	if (dur !== null) conf -= 0.25 * (1 - dur);

	if (titleSim < 0.6) {
		notes.push(`title differs ('${cand.title}')`);
		conf = Math.min(conf, 0.5);
	}
	if (artSim < 0.5) {
		notes.push(`artist differs (${cand.artists.join(", ")})`);
		conf = Math.min(conf, 0.5);
	}

	// An ISRC hit is the same recording; trust it once the names agree.
	if (cand.via_isrc && titleSim >= 0.6 && artSim >= 0.5) {
		conf = Math.max(conf, 0.97);
		notes.push("matched by ISRC");
	}

	const libFlags = versionFlags(track.title, null, track.album ?? "");
	const candFlags = versionFlags(cand.title, cand.version, cand.album ?? "");
	for (const flag of [...candFlags].filter((f) => !libFlags.has(f)).sort()) {
		conf -= VERSION_FLAGS[flag][1];
		notes.push(`${flag.replace("_", " ")} version`);
	}
	for (const flag of [...libFlags].filter((f) => !candFlags.has(f)).sort()) {
		if (flag !== "remaster") {
			// library says "Remastered", TIDAL has the plain original: fine
			conf -= VERSION_FLAGS[flag][1] / 2;
			notes.push(`library track is ${flag.replace("_", " ")}, candidate is not`);
		}
	}

	if (cand.available === false) {
		conf -= 0.5;
		notes.push("not streamable in your region");
	}

	return { candidate: cand, confidence: Math.round(Math.max(0, Math.min(1, conf)) * 1000) / 1000, notes };
}

/** Highest-confidence candidate (ties: ISRC hit, then shorter duration gap). */
export function bestMatch(track: LibraryTrack, candidates: Candidate[]): Score | null {
	const seen = new Set<string>();
	let best: Score | null = null;
	let bestKey: [number, number, number] | null = null;
	for (const c of candidates) {
		if (seen.has(c.tidal_id)) continue;
		seen.add(c.tidal_id);
		const s = score(track, c);
		const gap =
			track.duration_s && c.duration_s ? Math.abs(track.duration_s - c.duration_s) : 999;
		const key: [number, number, number] = [s.confidence, c.via_isrc ? 1 : 0, -gap];
		// First maximal element wins, as with Python's max().
		if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
			best = s;
			bestKey = key;
		}
	}
	return best;
}

/** TIDAL search strings to try, most specific first. */
export function searchQueries(track: LibraryTrack): string[] {
	const title = coreTitle(track.title);
	const artist = fold(track.artist);
	const queries = [`${artist} ${title}`];
	if (track.album) queries.push(`${title} ${coreTitle(track.album)}`);
	queries.push(title);
	return [...new Set(queries.filter((q) => q.trim()))];
}

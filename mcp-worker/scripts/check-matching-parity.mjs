// Checks that src/matching.ts scores exactly like ../mcp-server/server/matching.py.
// Both servers share the tidal_matches cache, so they must agree on what a
// match is. Needs python3 (stdlib only) and the Worker's dev dependencies.
//
//   node scripts/check-matching-parity.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const worker = join(here, "..");
const pyServer = join(worker, "..", "mcp-server");

const libs = [
	["t1", "Live Forever", "Oasis", "Definitely Maybe", 276],
	["t2", "Champagne Supernova (Live)", "Oasis", "Familiar to Millions", 480],
	["t3", "Myth (Sped Up)", "Beach House", "", 210],
	["t4", "Just Like Honey", "The Jesus and Mary Chain", "Psychocandy", 182],
	["t5", "Under Pressure", "Queen & David Bowie", "Hot Space", 248],
	["t6", "Alison", "Slowdive", "", null],
	["t7", "Wonderwall - Remastered", "Oasis", "(What's the Story) Morning Glory?", 258],
	["t8", "Get Lucky (feat. Pharrell Williams)", "Daft Punk", "Random Access Memories", 369],
	["t9", "Café del Mar [Live]", "Energy 52", "Café del Mar", 400],
	["t10", "Sigur Rós – Hoppípolla", "Sigur Rós", "Takk...", 268],
	["t11", "The Bench", "Like Roses", "", 201],
	["t12", "Стрелы", "Кино", "Группа крови", 230],
];
const cands = [
	["c1", "Live Forever", ["Oasis"], "Definitely Maybe", 277, null, null, true, false],
	["c2", "Live Forever (Live at Knebworth)", ["Oasis"], "Knebworth 1996", 290, null, null, true, false],
	["c3", "Live Forever (Karaoke Version)", ["Oasis Karaoke Band"], "Hits", 276, null, null, true, false],
	["c4", "Live Forever", ["Oasis"], "Live Forever", 230, "Sped Up", null, true, false],
	["c5", "Live Forever", ["Oasis"], "Definitely Maybe (Remastered)", 277, "Remastered", null, true, false],
	["c6", "Champagne Supernova", ["Oasis"], "Familiar to Millions", 482, "Live", null, true, false],
	["c7", "Myth", ["Beach House"], "Myth (Sped Up)", 211, "Sped Up", null, true, false],
	["c8", "Just Like Honey", ["Jesus & Mary Chain"], "Psychocandy", 182, null, null, true, false],
	["c9", "Under Pressure", ["Queen", "David Bowie"], "Hot Space", 248, null, null, true, false],
	["c10", "Machine Gun", ["Slowdive"], "Souvlaki", 270, null, "GBAAA9300001", true, true],
	["c11", "Wonderwall", ["Oasis"], "(What's The Story) Morning Glory? [Remastered]", 259, "Remastered", null, true, false],
	["c12", "Get Lucky", ["Daft Punk", "Pharrell Williams", "Nile Rodgers"], "Random Access Memories", 369, null, null, true, false],
	["c13", "Live Forever (Oasis Cover)", ["Some Band"], "Covers", 276, null, null, true, false],
	["c14", "Live Forever", ["Oasis"], "Definitely Maybe", 276, null, null, false, false],
	["c15", "Hoppípolla", ["Sigur Rós"], "Takk...", 268, null, null, true, false],
	["c16", "The Bench", ["Like Roses"], "The Bench - Single", 203, null, null, true, false],
	["c17", "Стрелы", ["Кино"], "Группа крови", 229, null, null, true, false],
	["c18", "Café Del Mar - Three 'N One Remix", ["Energy 52"], "Café del Mar", 560, null, null, true, false],
];
const strings = [
	"Wonderwall - Remastered 2014",
	"Get Lucky (feat. Pharrell Williams)",
	"Stay With Me",
	"Café del Mar [Live]",
	"Live Forever (Live at Knebworth)",
	"Live and Let Die",
	"Alison (Acoustic Cover)",
	"Myth - Karaoke Version",
	"Rock & Roll Star (BBC Session)",
	"Ænima — Instrumental",
	"Señor (Tales of Yankee Power) [Demo]",
	"Hey Jude [Remix] (2015 Mix)",
	"8D Audio - Blinding Lights (Slowed + Reverb)",
	"Жить в твоей голове (Live)",
];
const pairs = [
	["abcdefghij", "abcxyzghij"],
	["the quick brown fox", "quick brown the fox"],
	["a".repeat(250) + "b", "b" + "a".repeat(240)],
	["oasis live forever", "live forever oasis"],
	["", "abc"],
];

const cases = { libs, cands, strings, pairs };

const py = `
import json, sys
from difflib import SequenceMatcher
from server.matching import *
c = json.load(sys.stdin)
libs = [LibraryTrack(*l) for l in c["libs"]]
cands = [Candidate(x[0], x[1], tuple(x[2]), x[3], x[4], x[5], x[6], x[7], x[8]) for x in c["cands"]]
out = {
  "scores": [[score(l, k).confidence for k in cands] for l in libs],
  "notes": [[score(l, k).notes for k in cands] for l in libs],
  "best": [(lambda s: s and [s.candidate.tidal_id, s.confidence])(best_match(l, cands)) for l in libs],
  "queries": [search_queries(l) for l in libs],
  "fold": [fold(s) for s in c["strings"]],
  "core": [core_title(s) for s in c["strings"]],
  "flags": [sorted(version_flags(s, None, s)) for s in c["strings"]],
  "ratio": [SequenceMatcher(None, a, b).ratio() for a, b in c["pairs"]],
}
print(json.dumps(out))
`;
const expected = JSON.parse(
	execFileSync("python3", ["-c", py], { cwd: pyServer, input: JSON.stringify(cases), encoding: "utf8" }),
);

const out = mkdtempSync(join(tmpdir(), "matching-"));
try {
	execFileSync(
		join(worker, "node_modules", ".bin", "tsc"),
		["--ignoreConfig", "--outDir", out, "--target", "es2021", "--lib", "es2021", "--module", "es2022", "--skipLibCheck", join(worker, "src", "matching.ts")],
		{ stdio: "inherit" },
	);
	writeFileSync(join(out, "package.json"), '{"type":"module"}');
	const m = await import(join(out, "matching.js"));

	const L = libs.map(([id, title, artist, album, duration_s]) => ({ id, title, artist, album, duration_s }));
	const C = cands.map(([tidal_id, title, artists, album, duration_s, version, isrc, available, via_isrc]) => ({
		tidal_id, title, artists, album, duration_s, version, isrc, available, via_isrc,
	}));
	const actual = {
		scores: L.map((l) => C.map((k) => m.score(l, k).confidence)),
		notes: L.map((l) => C.map((k) => m.score(l, k).notes)),
		best: L.map((l) => {
			const s = m.bestMatch(l, C);
			return s && [s.candidate.tidal_id, s.confidence];
		}),
		queries: L.map((l) => m.searchQueries(l)),
		fold: strings.map(m.fold),
		core: strings.map(m.coreTitle),
		flags: strings.map((s) => [...m.versionFlags(s, null, s)].sort()),
		ratio: pairs.map(([a, b]) => m.sequenceRatio(a, b)),
	};

	// Python's repr() quotes titles with ' or " depending on content; compare notes loosely.
	const norm = (n) => n.replace(/\(['"](.*)['"]\)$/, "($1)");
	let failures = 0;
	const check = (what, a, e) => {
		const same =
			typeof e === "number" ? Math.abs(a - e) < 1e-9 : JSON.stringify(a) === JSON.stringify(e);
		if (!same) {
			failures++;
			console.log(`MISMATCH ${what}\n  python: ${JSON.stringify(e)}\n  ts:     ${JSON.stringify(a)}`);
		}
	};
	expected.scores.forEach((row, i) => row.forEach((e, j) => check(`score ${libs[i][0]}/${cands[j][0]}`, actual.scores[i][j], e)));
	expected.notes.forEach((row, i) =>
		row.forEach((e, j) => check(`notes ${libs[i][0]}/${cands[j][0]}`, actual.notes[i][j].map(norm), e.map(norm))),
	);
	for (const key of ["best", "queries", "fold", "core", "flags"]) {
		expected[key].forEach((e, i) => check(`${key} #${i}`, actual[key][i], e));
	}
	expected.ratio.forEach((e, i) => check(`ratio #${i}`, actual.ratio[i], e));

	const total = libs.length * cands.length * 2 + libs.length * 2 + strings.length * 3 + pairs.length;
	console.log(failures ? `${failures} of ${total} checks differ` : `All ${total} checks match the Python scorer`);
	process.exitCode = failures ? 1 : 0;
} finally {
	rmSync(out, { recursive: true, force: true });
}

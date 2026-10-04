"""Pure scoring of TIDAL candidates against a library track. No I/O here.

confidence = weighted similarity (title, artist, album, duration ±5s)
             - penalties for unwanted versions (live, remaster, karaoke, cover,
               sped up, ...) that the library track is *not* itself.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher


@dataclass(frozen=True)
class LibraryTrack:
    id: str
    title: str
    artist: str
    album: str = ""
    duration_s: int | None = None
    mbid: str | None = None


@dataclass(frozen=True)
class Candidate:
    tidal_id: str
    title: str
    artists: tuple[str, ...]
    album: str = ""
    duration_s: int | None = None
    version: str | None = None
    isrc: str | None = None
    available: bool = True
    via_isrc: bool = False


@dataclass
class Score:
    candidate: Candidate
    confidence: float
    notes: list[str] = field(default_factory=list)


DURATION_TOLERANCE_S = 5

# flag -> (pattern, penalty when only the candidate has it)
VERSION_FLAGS: dict[str, tuple[re.Pattern[str], float]] = {
    "karaoke": (re.compile(r"karaoke|originally performed|in the style of|backing track"), 0.60),
    "sped_up": (re.compile(r"sped[\s-]*up|speed[\s-]*up|slowed|nightcore|\breverb\b|\b8d\b"), 0.60),
    "cover": (re.compile(r"\bcover\b|\btribute\b|made famous by"), 0.50),
    "live": (re.compile(r"\blive\b|\bin concert\b|\bunplugged\b|\bbbc session"), 0.30),
    "instrumental": (re.compile(r"\binstrumental\b"), 0.30),
    "remix": (re.compile(r"\bremix\b|\brmx\b|\bmix\)|\bdub\b"), 0.25),
    "acoustic": (re.compile(r"\bacoustic\b"), 0.20),
    "demo": (re.compile(r"\bdemo\b|\bearly version\b|\balternate\b|\bouttake\b"), 0.20),
    "remaster": (re.compile(r"\bremaster(ed)?\b|\bremastering\b"), 0.05),
}

# Decorations: "(...)", "[...]", and " - suffix" parts of a title.
_BRACKETS = re.compile(r"[\(\[]([^\)\]]*)[\)\]]")
_DASH_SUFFIX = re.compile(r"\s+[-–—]\s+(.+)$")
_FEAT = re.compile(r"\b(feat|ft|featuring)\b.+$")
_NON_WORD = re.compile(r"[^\w\s]")
_SPACES = re.compile(r"\s+")


def fold(s: str) -> str:
    """Lowercase, strip accents, unify '&'/'and' and punctuation."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ").replace("’", "'")
    s = _NON_WORD.sub(" ", s)
    return _SPACES.sub(" ", s).strip()


def decorations(title: str) -> list[str]:
    """The bracketed / dash-suffixed parts of a title, e.g. ['live', '2011 remaster']."""
    parts = [m.group(1) for m in _BRACKETS.finditer(title or "")]
    m = _DASH_SUFFIX.search(_BRACKETS.sub("", title or ""))
    if m:
        parts.append(m.group(1))
    return parts


def core_title(title: str) -> str:
    """Title without decorations or featured-artist credits, folded."""
    t = _BRACKETS.sub(" ", title or "")
    t = _DASH_SUFFIX.sub("", t)
    t = fold(t)
    t = _FEAT.sub("", t).strip()
    return t or fold(title)


def version_flags(title: str, version: str | None = None, album: str = "") -> set[str]:
    """Which special versions a track is, judged only from decorations, the
    version field and (for 'live') the album title -- never the bare title, so
    a song called "Live Forever" is not a live recording."""
    text = " | ".join(fold(p) for p in [*decorations(title), version or ""] if p)
    flags = {name for name, (pat, _) in VERSION_FLAGS.items() if pat.search(text)}
    alb = fold(album)
    if re.search(r"\blive (at|in|from|on)\b|\bin concert\b|\bunplugged\b|^live$", alb) or any(
        VERSION_FLAGS["live"][0].search(fold(d)) for d in decorations(album)
    ):
        flags.add("live")
    return flags


def similarity(a: str, b: str) -> float:
    """Max of character ratio and token-sort ratio, on folded strings."""
    a, b = fold(a), fold(b)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    direct = SequenceMatcher(None, a, b).ratio()
    tokens = SequenceMatcher(None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))).ratio()
    return max(direct, tokens)


def _strip_the(s: str) -> str:
    s = fold(s)
    return s[4:] if s.startswith("the ") else s


def artist_similarity(library_artist: str, candidate_artists: tuple[str, ...]) -> float:
    if not candidate_artists:
        return 0.0
    lib = _strip_the(library_artist)
    joined = _strip_the(" and ".join(candidate_artists))
    best = max(similarity(lib, _strip_the(a)) for a in candidate_artists)
    best = max(best, similarity(lib, joined))
    # "Artist A & Artist B" in the library vs a primary artist on TIDAL
    if any(_strip_the(a) and _strip_the(a) in lib.split(" and ") for a in candidate_artists):
        best = max(best, 0.9)
    return best


def duration_score(lib_s: int | None, cand_s: int | None) -> float | None:
    if not lib_s or not cand_s:
        return None
    diff = abs(lib_s - cand_s)
    if diff <= DURATION_TOLERANCE_S:
        return 1.0
    return max(0.0, 1.0 - (diff - DURATION_TOLERANCE_S) / 25.0)  # 0 at 30s off


def score(track: LibraryTrack, cand: Candidate) -> Score:
    notes: list[str] = []
    title_sim = similarity(core_title(track.title), core_title(cand.title))
    art_sim = artist_similarity(track.artist, cand.artists)

    parts: list[tuple[float, float]] = [(0.45, title_sim), (0.35, art_sim)]
    if track.album and cand.album:
        parts.append((0.10, similarity(core_title(track.album), core_title(cand.album))))
    dur = duration_score(track.duration_s, cand.duration_s)
    if dur is not None:
        parts.append((0.10, dur))
        if dur < 1.0:
            notes.append(f"duration differs by {abs(track.duration_s - cand.duration_s)}s")  # type: ignore[operator]
    total_w = sum(w for w, _ in parts)
    conf = sum(w * v for w, v in parts) / total_w
    if dur is not None:
        # Outside ±5s is usually a different edit or version: weigh it beyond its share.
        conf -= 0.25 * (1.0 - dur)

    if title_sim < 0.6:
        notes.append(f"title differs ({cand.title!r})")
        conf = min(conf, 0.5)
    if art_sim < 0.5:
        notes.append(f"artist differs ({', '.join(cand.artists)})")
        conf = min(conf, 0.5)

    # An ISRC hit is the same recording; trust it once the names agree.
    if cand.via_isrc and title_sim >= 0.6 and art_sim >= 0.5:
        conf = max(conf, 0.97)
        notes.append("matched by ISRC")

    lib_flags = version_flags(track.title, None, track.album)
    cand_flags = version_flags(cand.title, cand.version, cand.album)
    for flag in sorted(cand_flags - lib_flags):
        conf -= VERSION_FLAGS[flag][1]
        notes.append(f"{flag.replace('_', ' ')} version")
    for flag in sorted(lib_flags - cand_flags):
        if flag != "remaster":  # library says "Remastered", TIDAL has the plain original: fine
            conf -= VERSION_FLAGS[flag][1] / 2
            notes.append(f"library track is {flag.replace('_', ' ')}, candidate is not")

    if not cand.available:
        conf -= 0.5
        notes.append("not streamable in your region")

    return Score(candidate=cand, confidence=round(max(0.0, min(1.0, conf)), 3), notes=notes)


def best_match(track: LibraryTrack, candidates: list[Candidate]) -> Score | None:
    """Highest-confidence candidate (ties: ISRC hit, then shorter duration gap)."""
    seen: set[str] = set()
    scored: list[Score] = []
    for c in candidates:
        if c.tidal_id in seen:
            continue
        seen.add(c.tidal_id)
        scored.append(score(track, c))
    if not scored:
        return None

    def key(s: Score) -> tuple[float, int, int]:
        gap = (
            abs(track.duration_s - s.candidate.duration_s)
            if track.duration_s and s.candidate.duration_s
            else 999
        )
        return (s.confidence, int(s.candidate.via_isrc), -gap)

    return max(scored, key=key)


def search_queries(track: LibraryTrack) -> list[str]:
    """TIDAL search strings to try, most specific first."""
    title = core_title(track.title)
    artist = fold(track.artist)
    queries = [f"{artist} {title}"]
    if track.album:
        queries.append(f"{title} {core_title(track.album)}")
    queries.append(title)
    return list(dict.fromkeys(q for q in queries if q.strip()))

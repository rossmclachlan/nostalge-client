"""Match pipeline: cache -> ISRC -> search, with mocked TIDAL."""

import pytest

from server.matcher import Matcher, summarize
from tests.fakes import FakeMusicBrainz, FakeStore, FakeTidal, cand, record

LF = record("t1", "Live Forever", "Oasis", "Definitely Maybe", 276, mbid="mb-lf")
SS = record("t2", "Supersonic", "Oasis", "Definitely Maybe", 283)
OBSCURE = record("t3", "Unreleased Demo 4", "Nobody", "", 100)
RECORDS = {r["id"]: r for r in (LF, SS, OBSCURE)}


def make(tidal: FakeTidal, store: FakeStore | None = None, mb: FakeMusicBrainz | None = None) -> Matcher:
    return Matcher(tidal, store or FakeStore(), mb, min_confidence=0.8)


async def test_isrc_path_used_when_mbid_has_isrcs():
    tidal = FakeTidal(isrc={"GBAAA9400001": [cand("111", "Live Forever", "Oasis", "Definitely Maybe", 276)]})
    store = FakeStore()
    m = make(tidal, store, FakeMusicBrainz({"mb-lf": ["GBAAA9400001"]}))
    [r] = await m.match_records(["t1"], RECORDS)
    assert r["matched"] and r["tidal_id"] == "111" and r["method"] == "isrc"
    assert tidal.queries == []  # no text search needed
    assert store.writes[0]["library_track"] == "t1" and store.writes[0]["method"] == "isrc"


async def test_falls_back_to_search_and_skips_live_version():
    tidal = FakeTidal(search={"supersonic": [
        cand("live", "Supersonic (Live at Maine Road)", "Oasis", "Live at Maine Road", 300),
        cand("studio", "Supersonic", "Oasis", "Definitely Maybe (Remastered)", 284, version="Remastered"),
    ]})
    [r] = await make(tidal).match_records(["t2"], RECORDS)
    assert r["matched"] and r["tidal_id"] == "studio" and r["method"] == "search"
    assert r["tidal"] == {"title": "Supersonic (Remastered)", "artist": "Oasis", "album": "Definitely Maybe (Remastered)"}


async def test_stops_searching_once_confident():
    tidal = FakeTidal(search={"oasis supersonic": [cand("s", "Supersonic", "Oasis", "Definitely Maybe", 283)]})
    await make(tidal).match_records(["t2"], RECORDS)
    assert tidal.queries == ["oasis supersonic"]


async def test_cache_hit_skips_tidal_entirely():
    store = FakeStore({"t2": {"library_track": "t2", "tidal_id": "999", "confidence": 0.93,
                              "matched_title": "Supersonic", "matched_artist": "Oasis", "matched_album": "DM"}})
    tidal = FakeTidal()
    [r] = await make(tidal, store).match_records(["t2"], RECORDS)
    assert r["matched"] and r["tidal_id"] == "999" and r["method"] == "cache"
    assert tidal.queries == [] and store.writes == []


async def test_low_confidence_cache_row_is_rematched():
    store = FakeStore({"t2": {"library_track": "t2", "tidal_id": "old", "confidence": 0.5}})
    tidal = FakeTidal(search={"supersonic": [cand("new", "Supersonic", "Oasis", "Definitely Maybe", 283)]})
    [r] = await make(tidal, store).match_records(["t2"], RECORDS)
    assert r["tidal_id"] == "new"


async def test_miss_reports_reason_and_best_candidate_and_is_not_cached():
    tidal = FakeTidal(search={"supersonic": [cand("kar", "Supersonic (Karaoke)", "Karaoke Kings", "Hits", 283)]})
    store = FakeStore()
    [r] = await make(tidal, store).match_records(["t2"], RECORDS)
    assert not r["matched"]
    assert r["reason"].startswith("no confident match")
    assert "karaoke" in r["reason"]
    assert r["best_candidate"]["tidal_id"] == "kar"
    assert store.writes == []


async def test_no_results_and_unknown_ids():
    [a, b] = await make(FakeTidal()).match_records(["t3", "nope"], RECORDS)
    assert a == {"track_id": "t3", "library": {"title": "Unreleased Demo 4", "artist": "Nobody", "album": ""},
                 "matched": False, "reason": "no results on TIDAL"}
    assert b == {"track_id": "nope", "matched": False, "reason": "not in your library"}


async def test_order_kept_and_duplicates_dropped():
    tidal = FakeTidal(search={"supersonic": [cand("s", "Supersonic", "Oasis", "Definitely Maybe", 283)],
                              "live forever": [cand("l", "Live Forever", "Oasis", "Definitely Maybe", 276)]})
    res = await make(tidal).match_records(["t2", "t1", "t2"], RECORDS)
    assert [r["track_id"] for r in res] == ["t2", "t1"]
    s = summarize(res)
    assert s["matched_count"] == 2 and s["miss_count"] == 0


async def test_cache_outage_does_not_block_matching():
    class Broken(FakeStore):
        async def get_matches(self, ids):
            raise RuntimeError("pocketbase down")

        async def upsert_match(self, record):
            raise RuntimeError("pocketbase down")

    tidal = FakeTidal(search={"supersonic": [cand("s", "Supersonic", "Oasis", "Definitely Maybe", 283)]})
    [r] = await make(tidal, Broken()).match_records(["t2"], RECORDS)
    assert r["matched"]


async def test_too_many_tracks_rejected():
    with pytest.raises(ValueError, match="At most 500"):
        await make(FakeTidal()).match_records([f"t{i}" for i in range(501)], {})

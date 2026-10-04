"""Library tools + match cache against a real PocketBase seeded by
tests/dev/seed_pocketbase.py. Skipped unless NOSTALGE_TEST_PB_URL is set:

    NOSTALGE_TEST_PB_URL=http://127.0.0.1:8090 pytest tests/test_live_pocketbase.py
"""

import os

import pytest

from server.library import Library
from server.matcher import Matcher
from server.pb import PocketBase
from tests.dev.seed_pocketbase import SERVICE_EMAIL, SERVICE_PASSWORD
from tests.fakes import FakeTidal, cand

URL = os.environ.get("NOSTALGE_TEST_PB_URL")
pytestmark = pytest.mark.skipif(not URL, reason="set NOSTALGE_TEST_PB_URL to run against a seeded PocketBase")


@pytest.fixture
async def pb():
    client = PocketBase(URL, SERVICE_EMAIL, SERVICE_PASSWORD)
    yield client
    await client.aclose()


async def test_crates(pb):
    lib = Library(pb)
    res = await lib.list_crates(None, "most_played", 10, 0)
    assert [c["title"] for c in res["crates"]][:2] == ["Definitely Maybe", "Souvlaki"]
    assert res["crates"][0]["artist"] == "Oasis" and res["crates"][0]["release_year"] == 1994
    by_artist = await lib.list_crates("slowdive", "title", 10, 0)
    assert [c["title"] for c in by_artist["crates"]] == ["Souvlaki"]

    crate = await lib.get_crate_tracks(res["crates"][0]["id"])
    assert [t["title"] for t in crate["tracks"]] == ["Live Forever", "Supersonic", "Slide Away"]
    assert crate["tracks"][0]["duration_s"] == 276
    assert sorted(crate["crate"]["tags"]) == ["90s", "britpop"]


async def test_tags(pb):
    lib = Library(pb)
    assert [t["name"] for t in await lib.list_tags(2)] == ["90s", "britpop"]

    any_ = await lib.get_tagged_tracks(["Shoegaze", "dream pop"], match_all=False, limit=50)
    assert {t["title"] for t in any_["tracks"]} == {"Alison", "When the Sun Hits", "Myth"}

    both = await lib.get_tagged_tracks(["90s", "shoegaze"], match_all=True, limit=50)
    assert {t["title"] for t in both["tracks"]} == {"Alison", "When the Sun Hits"}

    unknown = await lib.get_tagged_tracks(["90s", "polka"], match_all=True, limit=50)
    assert unknown["tracks"] == [] and unknown["unknown_tags"] == ["polka"]


async def test_search_matches_title_artist_and_album(pb):
    lib = Library(pb)
    assert {t["title"] for t in await lib.search("slide", 10)} == {"Slide Away"}
    assert {t["title"] for t in await lib.search("beach house", 10)} == {"Myth"}
    assert len(await lib.search("definitely", 10)) == 3
    assert await lib.search('quote " injection', 10) == []


async def test_recent_discoveries(pb):
    res = await Library(pb).recent_discoveries(days=30, limit=10)
    # Myth first played 3 days ago; Alison 10 days ago; Live Forever was heard 900 days ago.
    assert [t["title"] for t in res["tracks"]] == ["Myth", "Alison"]
    assert "first_played" in res["tracks"][0]


async def test_match_cache_round_trip(pb):
    lib = Library(pb)
    [track] = await lib.search("supersonic", 1)
    tid = track["id"]
    recs = await lib.tracks_by_ids([tid])

    # Seed (or overwrite) the cache row, so the test doesn't depend on earlier runs.
    await pb.upsert_match({"library_track": track["id"], "tidal_id": "t-555", "confidence": 0.95, "method": "search",
                           "matched_title": "Supersonic", "matched_artist": "Oasis"})
    tidal = FakeTidal()
    [hit] = await Matcher(tidal, pb, None).match_records([track["id"]], recs)
    assert hit["method"] == "cache" and hit["tidal_id"] == "t-555" and tidal.queries == []

    # A re-match updates the same row instead of adding another.
    await pb.upsert_match({"library_track": track["id"], "tidal_id": "t-556", "confidence": 0.9, "method": "search"})
    rows = await pb.get_all("tidal_matches", filter=f'library_track="{tid}"')
    assert len(rows) == 1 and rows[0]["tidal_id"] == "t-556"


async def test_confident_search_result_is_written_to_cache(pb):
    lib = Library(pb)
    [track] = await lib.search("when the sun hits", 1)
    tid = track["id"]
    recs = await lib.tracks_by_ids([tid])
    tidal = FakeTidal(search={"when the sun hits": [cand("t-777", "When the Sun Hits", "Slowdive", "Souvlaki", 286)]})
    [res] = await Matcher(tidal, pb, None).match_records([track["id"]], recs)
    assert res["matched"]
    rows = await pb.get_all("tidal_matches", filter=f'library_track="{tid}"')
    assert len(rows) == 1 and rows[0]["tidal_id"] == res["tidal_id"]


async def test_anonymous_cannot_write_cache(pb):
    import httpx

    async with httpx.AsyncClient(base_url=URL) as anon:
        r = await anon.post("/api/collections/tidal_matches/records",
                            json={"library_track": "x", "tidal_id": "y"})
        assert r.status_code in (400, 403)

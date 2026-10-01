"""The tidalapi adapter: parsing real-shaped TIDAL JSON, backoff, dead sessions."""

import pytest
import requests
import tidalapi
from tidalapi.exceptions import TooManyRequests

from server.tidal import TidalapiBackend, TidalAuthError, TidalError, to_candidate, with_backoff

# Shape of a track object from TIDAL's v1 API (trimmed).
TRACK_JSON = {
    "id": 77646169,
    "title": "Live Forever",
    "duration": 277,
    "version": "Remastered",
    "isrc": "GBBQY1400027",
    "streamReady": True,
    "adSupportedStreamReady": True,
    "stemReady": False,
    "djReady": True,
    "type": "Track",
    "allowStreaming": True,
    "explicit": False,
    "audioQuality": "LOSSLESS",
    "audioModes": ["STEREO"],
    "mediaMetadata": {"tags": []},
    "trackNumber": 3,
    "volumeNumber": 1,
    "popularity": 60,
    "copyright": "",
    "url": "http://www.tidal.com/track/77646169",
    "artist": {"id": 109, "name": "Oasis", "type": "MAIN", "picture": None},
    "artists": [{"id": 109, "name": "Oasis", "type": "MAIN", "picture": None}],
    "album": {"id": 77646166, "title": "Definitely Maybe (Remastered)", "cover": None, "videoCover": None},
    "peak": 0.98,
    "replayGain": -9.1,
}


def test_to_candidate_from_tidal_json():
    track = tidalapi.Session().parse_track(TRACK_JSON)
    c = to_candidate(track)
    assert c.tidal_id == "77646169"
    assert c.title == "Live Forever" and c.version == "Remastered"
    assert c.artists == ("Oasis",)
    assert c.album == "Definitely Maybe (Remastered)"
    assert c.duration_s == 277 and c.isrc == "GBBQY1400027" and c.available


def test_backoff_retries_rate_limits_then_succeeds():
    calls, sleeps = [], []

    def fn():
        calls.append(1)
        if len(calls) < 3:
            raise TooManyRequests(retry_after=4)
        return "ok"

    assert with_backoff(fn, what="search", sleep=sleeps.append) == "ok"
    assert len(calls) == 3
    assert all(4 <= s <= 4.5 for s in sleeps)  # honours Retry-After (+ jitter)


def test_backoff_gives_up_with_clear_error():
    def fn():
        raise TooManyRequests()

    with pytest.raises(TidalError, match="still rate-limited"):
        with_backoff(fn, what="add tracks", sleep=lambda s: None)


def _http_error(status: int) -> requests.HTTPError:
    resp = requests.Response()
    resp.status_code = status
    return requests.HTTPError(response=resp)


def test_backoff_retries_5xx_but_not_4xx():
    attempts = []

    def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise _http_error(503)
        return 1

    assert with_backoff(flaky, what="search", sleep=lambda s: None) == 1

    def missing():
        raise _http_error(404)

    with pytest.raises(TidalError, match="HTTP 404"):
        with_backoff(missing, what="search", sleep=lambda s: None)


def test_401_means_relogin():
    def dead():
        raise _http_error(401)

    with pytest.raises(TidalAuthError, match="re-run the one-time login|Re-run the one-time login"):
        with_backoff(dead, what="search", sleep=lambda s: None)


async def test_missing_session_file_tells_you_to_login(tmp_path):
    backend = TidalapiBackend(tmp_path / "nope.json")
    with pytest.raises(TidalAuthError, match="python -m server login"):
        await backend.search_tracks("oasis")

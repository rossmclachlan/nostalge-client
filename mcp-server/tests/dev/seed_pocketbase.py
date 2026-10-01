"""Seed a throwaway local PocketBase (with the music-cms-mvp migrations applied)
with a tiny library plus the MCP service user. For local testing only.

    python tests/dev/seed_pocketbase.py http://127.0.0.1:8090 admin@example.test 'admin-pass'
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

import httpx

SERVICE_EMAIL = "mcp@example.test"
SERVICE_PASSWORD = "service-pass-123456"


def main(base: str, admin_email: str, admin_password: str) -> None:
    http = httpx.Client(base_url=base, timeout=10)
    tok = http.post("/api/admins/auth-with-password", json={"identity": admin_email, "password": admin_password})
    tok.raise_for_status()
    http.headers["Authorization"] = tok.json()["token"]

    def create(col: str, data: dict) -> dict:
        r = http.post(f"/api/collections/{col}/records", json=data)
        r.raise_for_status()
        return r.json()

    create("users", {"email": SERVICE_EMAIL, "password": SERVICE_PASSWORD, "passwordConfirm": SERVICE_PASSWORD,
                     "verified": True})

    tags = {n: create("tags", {"name": n, "slug": n.replace(" ", "-"), "usage_count": c})
            for n, c in [("britpop", 40), ("shoegaze", 25), ("90s", 60), ("dream pop", 12)]}

    oasis = create("artists", {"name": "Oasis", "play_count": 900, "tag_relations": [tags["britpop"]["id"], tags["90s"]["id"]]})
    slowdive = create("artists", {"name": "Slowdive", "play_count": 400, "tag_relations": [tags["shoegaze"]["id"]]})
    beach = create("artists", {"name": "Beach House", "play_count": 300, "tag_relations": [tags["dream pop"]["id"]]})

    dm = create("albums", {"title": "Definitely Maybe", "artist": oasis["id"], "release_year": 1994, "play_count": 500,
                           "track_count": 3, "tag_relations": [tags["britpop"]["id"], tags["90s"]["id"]]})
    souv = create("albums", {"title": "Souvlaki", "artist": slowdive["id"], "release_year": 1993, "play_count": 300,
                             "track_count": 2, "tag_relations": [tags["shoegaze"]["id"], tags["90s"]["id"]]})
    bloom = create("albums", {"title": "Bloom", "artist": beach["id"], "release_year": 2012, "play_count": 200,
                              "track_count": 1, "tag_relations": [tags["dream pop"]["id"]]})

    tracks = [
        ("Live Forever", oasis, dm, 276, "11111111-1111-1111-1111-111111111111"),
        ("Supersonic", oasis, dm, 283, None),
        ("Slide Away", oasis, dm, 392, None),
        ("Alison", slowdive, souv, 230, None),
        ("When the Sun Hits", slowdive, souv, 286, None),
        ("Myth", beach, bloom, 258, None),
    ]
    made = []
    for i, (title, artist, album, dur, mbid) in enumerate(tracks):
        made.append(create("tracks", {"title": title, "artist": artist["id"], "album": album["id"],
                                      "duration_ms": dur * 1000, "play_count": 50 - i, "mbid": mbid or ""}))

    now = datetime.now(timezone.utc)

    def scrobble(track: dict, title: str, artist: str, when: datetime, ts: int) -> None:
        create("scrobbles", {"track": track["id"], "artist_name": artist, "track_name": title,
                             "scrobbled_at": when.strftime("%Y-%m-%d %H:%M:%S.000Z"), "lastfm_timestamp": ts})

    # Oasis: heard years ago and again this week (not a discovery). Beach House "Myth": first heard 3 days ago.
    scrobble(made[0], "Live Forever", "Oasis", now - timedelta(days=900), 1)
    scrobble(made[0], "Live Forever", "Oasis", now - timedelta(days=2), 2)
    scrobble(made[5], "Myth", "Beach House", now - timedelta(days=3), 3)
    scrobble(made[5], "Myth", "Beach House", now - timedelta(days=1), 4)
    scrobble(made[3], "Alison", "Slowdive", now - timedelta(days=10), 5)

    print("seeded; track ids:")
    for t in made:
        print(f"  {t['id']}  {t['title']}")


if __name__ == "__main__":
    main(*sys.argv[1:4])

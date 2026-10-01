"""Pure scoring: normalisation, duration tolerance, version penalties."""

from server.matching import (
    LibraryTrack,
    best_match,
    core_title,
    search_queries,
    version_flags,
)
from tests.fakes import cand

LIVE_FOREVER = LibraryTrack("t1", "Live Forever", "Oasis", "Definitely Maybe", 276)


def test_core_title_strips_decorations_and_features():
    assert core_title("Wonderwall - Remastered 2014") == "wonderwall"
    assert core_title("Get Lucky (feat. Pharrell Williams)") == "get lucky"
    assert core_title("Stay With Me") == "stay with me"  # 'with' is not a feature marker
    assert core_title("Café del Mar [Live]") == "cafe del mar"


def test_live_in_a_song_title_is_not_a_live_version():
    assert version_flags("Live Forever") == set()
    assert version_flags("Live and Let Die") == set()
    assert "live" in version_flags("Live Forever (Live at Knebworth)")
    assert "live" in version_flags("Slide Away", album="Live at Knebworth")


def test_flags_from_version_field_and_suffixes():
    assert version_flags("Myth", version="Sped Up") == {"sped_up"}
    assert version_flags("Myth - Karaoke Version") == {"karaoke"}
    assert version_flags("Alison", version="2005 Remaster") == {"remaster"}
    assert version_flags("Alison (Acoustic Cover)") == {"acoustic", "cover"}


def test_exact_studio_match_scores_high():
    s = best_match(LIVE_FOREVER, [cand("1", "Live Forever", "Oasis", "Definitely Maybe", 277)])
    assert s is not None and s.confidence >= 0.95


def test_studio_beats_live_karaoke_and_sped_up():
    cands = [
        cand("live", "Live Forever (Live at Knebworth)", "Oasis", "Knebworth 1996", 290),
        cand("kar", "Live Forever (Karaoke Version)", "Oasis Karaoke Band", "Hits", 276),
        cand("fast", "Live Forever", "Oasis", "Live Forever", 230, version="Sped Up"),
        cand("studio", "Live Forever", "Oasis", "Definitely Maybe (Remastered)", 277, version="Remastered"),
    ]
    best = best_match(LIVE_FOREVER, cands)
    assert best is not None and best.candidate.tidal_id == "studio"
    assert best.confidence >= 0.85


def test_remaster_is_only_a_small_penalty():
    plain = best_match(LIVE_FOREVER, [cand("a", "Live Forever", "Oasis", "Definitely Maybe", 276)])
    rem = best_match(LIVE_FOREVER, [cand("b", "Live Forever", "Oasis", "Definitely Maybe", 276, version="Remastered")])
    assert plain and rem and plain.confidence > rem.confidence >= 0.85


def test_library_live_track_prefers_live_candidate():
    lib = LibraryTrack("t", "Champagne Supernova (Live)", "Oasis", "Familiar to Millions", 480)
    best = best_match(lib, [
        cand("studio", "Champagne Supernova", "Oasis", "(What's the Story) Morning Glory?", 451),
        cand("live", "Champagne Supernova", "Oasis", "Familiar to Millions", 482, version="Live"),
    ])
    assert best is not None and best.candidate.tidal_id == "live"


def test_library_sped_up_track_is_not_penalised():
    lib = LibraryTrack("t", "Myth (Sped Up)", "Beach House", "", 210)
    best = best_match(lib, [cand("x", "Myth", "Beach House", "Myth (Sped Up)", 211, version="Sped Up")])
    assert best is not None and best.confidence >= 0.9


def test_duration_within_five_seconds_is_full_credit_and_beyond_decays():
    near = best_match(LIVE_FOREVER, [cand("a", "Live Forever", "Oasis", "Definitely Maybe", 281)])
    far = best_match(LIVE_FOREVER, [cand("b", "Live Forever", "Oasis", "Definitely Maybe", 320)])
    assert near and far
    assert near.confidence >= 0.99
    assert far.confidence < 0.8 <= near.confidence  # a 44s gap is a different edit: rejected
    assert any("duration differs by 44s" in n for n in far.notes)


def test_small_duration_drift_is_still_accepted():
    s = best_match(LIVE_FOREVER, [cand("a", "Live Forever", "Oasis", "Definitely Maybe", 286)])  # 10s off
    assert s and s.confidence >= 0.85


def test_missing_duration_is_ignored_not_penalised():
    lib = LibraryTrack("t", "Supersonic", "Oasis", "Definitely Maybe", None)
    best = best_match(lib, [cand("a", "Supersonic", "Oasis", "Definitely Maybe", 283)])
    assert best and best.confidence >= 0.99


def test_wrong_artist_is_capped_low():
    best = best_match(LIVE_FOREVER, [cand("a", "Live Forever", "Rick Ross", "Teflon Don", 276)])
    assert best and best.confidence <= 0.5
    assert any("artist differs" in n for n in best.notes)


def test_cover_by_other_artist_is_rejected():
    best = best_match(LIVE_FOREVER, [cand("a", "Live Forever (Oasis Cover)", "Some Band", "Covers", 276)])
    assert best and best.confidence < 0.5


def test_the_prefix_and_ampersand_in_artist():
    lib = LibraryTrack("t", "Just Like Honey", "The Jesus and Mary Chain", "Psychocandy", 182)
    best = best_match(lib, [cand("a", "Just Like Honey", "Jesus & Mary Chain", "Psychocandy", 182)])
    assert best and best.confidence >= 0.95


def test_collaboration_credit_matches_primary_artist():
    lib = LibraryTrack("t", "Under Pressure", "Queen & David Bowie", "Hot Space", 248)
    best = best_match(lib, [cand("a", "Under Pressure", ("Queen", "David Bowie"), "Hot Space", 248)])
    assert best and best.confidence >= 0.9


def test_isrc_hit_is_trusted_when_names_agree():
    lib = LibraryTrack("t", "Alison", "Slowdive", "", None)
    c = cand("a", "Alison", "Slowdive", "Souvlaki (Deluxe)", 230)
    from dataclasses import replace

    best = best_match(lib, [replace(c, via_isrc=True)])
    assert best and best.confidence >= 0.97


def test_isrc_hit_with_wrong_title_is_not_trusted():
    from dataclasses import replace

    lib = LibraryTrack("t", "Alison", "Slowdive", "", None)
    best = best_match(lib, [replace(cand("a", "Machine Gun", "Slowdive", "Souvlaki", 270), via_isrc=True)])
    assert best and best.confidence <= 0.5


def test_unavailable_track_is_penalised():
    best = best_match(LIVE_FOREVER, [cand("a", "Live Forever", "Oasis", "Definitely Maybe", 276, available=False)])
    assert best and best.confidence < 0.8


def test_no_candidates():
    assert best_match(LIVE_FOREVER, []) is None


def test_search_queries_most_specific_first():
    qs = search_queries(LibraryTrack("t", "Wonderwall - Remastered", "Oasis", "(What's the Story) Morning Glory?"))
    assert qs[0] == "oasis wonderwall"
    assert qs[-1] == "wonderwall"
    assert len(qs) == len(set(qs))

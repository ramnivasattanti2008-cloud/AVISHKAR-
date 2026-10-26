import pickle

from avishkar_ems import cache


def test_disk_cached_computes_once_then_loads(tmp_path, monkeypatch):
    monkeypatch.setenv("AVISHKAR_CACHE_DIR", str(tmp_path))
    calls = []

    def compute():
        calls.append(1)
        return {"x": 1}

    assert cache.disk_cached("thing", compute) == {"x": 1}
    assert cache.disk_cached("thing", compute) == {"x": 1}
    assert len(calls) == 1
    assert (tmp_path / "thing.pkl").exists()
    assert not list(tmp_path.glob("*.tmp"))  # atomic write leaves nothing behind


def test_disk_cached_recomputes_when_file_is_corrupt(tmp_path, monkeypatch):
    monkeypatch.setenv("AVISHKAR_CACHE_DIR", str(tmp_path))
    (tmp_path / "thing.pkl").write_bytes(b"not a pickle")
    assert cache.disk_cached("thing", lambda: 42) == 42
    assert pickle.loads((tmp_path / "thing.pkl").read_bytes()) == 42  # repaired in place


def _tree(tmp_path):
    (tmp_path / "src" / "avishkar_ems").mkdir(parents=True)
    (tmp_path / "data" / "tariffs").mkdir(parents=True)
    (tmp_path / "data" / "policy").mkdir(parents=True)
    (tmp_path / "data" / "real").mkdir(parents=True)
    (tmp_path / "src" / "avishkar_ems" / "a.py").write_text("x = 1\n")
    (tmp_path / "data" / "tariffs" / "s.json").write_text('{"tou_blocks": [[0, 24, 7.0]], "meta": {"state": "MH", "notes": []}}')
    (tmp_path / "data" / "policy" / "p.json").write_text(
        '{"program": "P", "region": "IN", "source": "a page", "verifiedAt": "2026-10-07", '
        '"rules": [{"ruleKey": "r", "tiers": [{"upToKw": 2, "inrPerKw": 30000}], "capInr": 78000, "statedAs": "words", "notes": []}]}')
    (tmp_path / "data" / "real" / "m.csv").write_text("a,b\n")
    return tmp_path


def test_fingerprint_tracks_code_tariffs_and_data(tmp_path):
    root = _tree(tmp_path)
    base = cache.fingerprint(root)
    assert cache.fingerprint(root) == base
    for rel in ("src/avishkar_ems/a.py", "data/real/m.csv"):
        f = root / rel
        old = f.read_text()
        f.write_text(old + "changed")
        assert cache.fingerprint(root) != base, rel
        f.write_text(old)
    assert cache.fingerprint(root) == base


def _edit(path, old, new):
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new))


def test_fingerprint_tracks_the_numbers_in_tariffs_and_policy(tmp_path):
    root = _tree(tmp_path)
    base = cache.fingerprint(root)
    _edit(root / "data" / "tariffs" / "s.json", "7.0", "7.5")  # a rate the EMS reads
    assert cache.fingerprint(root) != base
    _edit(root / "data" / "tariffs" / "s.json", "7.5", "7.0")
    assert cache.fingerprint(root) == base
    for old, new in (("30000", "35000"), ("78000", "80000")):  # a subsidy tier and the cap
        _edit(root / "data" / "policy" / "p.json", old, new)
        assert cache.fingerprint(root) != base, old
        _edit(root / "data" / "policy" / "p.json", new, old)
    assert cache.fingerprint(root) == base
    (root / "data" / "tariffs" / "s.json").write_text("{not json")  # unparseable files are still tracked, as raw bytes
    assert cache.fingerprint(root) != base


def test_fingerprint_ignores_what_only_the_platform_or_a_reader_uses(tmp_path):
    root = _tree(tmp_path)
    base = cache.fingerprint(root)
    _edit(root / "data" / "tariffs" / "s.json", '"state": "MH"', '"state": "KA"')  # tariff meta is for the platform
    _edit(root / "data" / "policy" / "p.json", "2026-10-07", "2027-01-01")  # re-reading a rule at its source
    _edit(root / "data" / "policy" / "p.json", '"statedAs": "words"', '"statedAs": "other words"')
    _edit(root / "data" / "policy" / "p.json", "a page", "another page")
    assert cache.fingerprint(root) == base


def test_fingerprint_ignores_line_endings_and_uploaded_meters(tmp_path):
    root = _tree(tmp_path)
    base = cache.fingerprint(root)
    (root / "src" / "avishkar_ems" / "a.py").write_bytes(b"x = 1\r\n")  # a CRLF checkout of the same code
    (root / "data" / "real" / "uploaded_meter.csv").write_text("scratch")
    assert cache.fingerprint(root) == base


def test_cache_status_lifecycle(tmp_path, monkeypatch):
    root = _tree(tmp_path / "repo")
    monkeypatch.setenv("AVISHKAR_CACHE_DIR", str(tmp_path / "cache"))
    assert cache.cache_status(root) == "empty"  # no cache directory yet: everything would be computed live
    cache.disk_cached("thing", lambda: 1)
    assert cache.cache_status(root) == "unstamped"  # results exist but nothing vouches for them
    cache.write_stamp(root)
    assert cache.cache_status(root) == "fresh"
    (root / "data" / "tariffs" / "s.json").write_text('{"rate": 9}')
    assert cache.cache_status(root) == "stale"


def test_prune_keeps_only_the_newest_day_views(tmp_path, monkeypatch):
    import os

    monkeypatch.setenv("AVISHKAR_CACHE_DIR", str(tmp_path))
    for i in range(5):
        f = tmp_path / f"day_view_site_2023-01-0{i}_0.5.pkl"
        f.write_bytes(b"x")
        os.utime(f, (1_000_000 + i, 1_000_000 + i))
    (tmp_path / "prepared_site.pkl").write_bytes(b"x")  # never pruned
    assert cache.prune(max_day_views=2) == 3
    left = sorted(p.name for p in tmp_path.glob("day_view_*.pkl"))
    assert left == ["day_view_site_2023-01-03_0.5.pkl", "day_view_site_2023-01-04_0.5.pkl"]
    assert (tmp_path / "prepared_site.pkl").exists()


def test_provenance_records_environment_and_fingerprint():
    p = cache.provenance(every_days=7)
    assert p["every_days"] == 7 and p["fingerprint"] == cache.fingerprint()
    assert set(p["libraries"]) >= {"numpy", "pandas", "pvlib"} and p["python"].count(".") == 2


def test_fingerprint_ignores_modules_that_cannot_change_results(tmp_path):
    """Editing report/lifetime/mysite/explain/summary text must not make cached results and results/ look stale."""
    root = _tree(tmp_path)
    base = cache.fingerprint(root)
    for name in ("report.py", "mysite.py", "lifetime.py", "explain.py", "summary.py"):
        (root / "src" / "avishkar_ems" / name).write_text("# presentation only\n")
        assert cache.fingerprint(root) == base, name
    (root / "src" / "avishkar_ems" / "planner.py").write_text("# a computing module\n")
    assert cache.fingerprint(root) != base

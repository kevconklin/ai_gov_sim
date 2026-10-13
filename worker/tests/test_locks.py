import subprocess
import sys
import textwrap

import pytest

from govern.locks import RunLocked, run_lock


def test_second_process_cannot_advance_the_same_run(tmp_path):
    script = textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {str(__import__('pathlib').Path.cwd())!r})
        from govern.locks import run_lock
        with run_lock({str(tmp_path)!r}, "run1"):
            print("held", flush=True)
            time.sleep(5)
    """)
    holder = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "held"
        with pytest.raises(RunLocked, match="another worker"):
            with run_lock(tmp_path, "run1"):
                pass
        with run_lock(tmp_path, "other-run"):       # a different run is unaffected
            pass
    finally:
        holder.kill()
        holder.wait()
    with run_lock(tmp_path, "run1"):                # released when the holder dies
        pass


# ---- database leases (what makes more than one host safe) -----------------


def test_the_key_is_stable_and_distinct_per_run():
    from govern.locks import advisory_key
    assert advisory_key("run1") == advisory_key("run1")
    assert advisory_key("run1") != advisory_key("run2")
    assert -(2 ** 63) <= advisory_key("run1") < 2 ** 63


def test_a_sqlite_database_still_takes_the_file_lock(db, tmp_path):
    """Only Postgres can lease across hosts; everything else keeps the single-host lock."""
    from govern.locks import run_lock
    assert db.advisory_locks is False
    with run_lock(tmp_path, "run1", db=db):
        assert (tmp_path / "locks" / "run1.lock").exists()


class TestPostgresLease:
    @pytest.fixture(scope="class")
    def server(self, tmp_path_factory):
        pgserver = pytest.importorskip("pgserver")
        return pgserver.get_server(tmp_path_factory.mktemp("pglock"), cleanup_mode="stop")

    @pytest.fixture
    def two(self, server):
        from govern.db import Database
        a, b = Database.connect(server.get_uri()), Database.connect(server.get_uri())
        yield a, b
        a.close()
        b.close()

    def test_a_second_host_cannot_advance_the_same_run(self, two, tmp_path):
        from govern.locks import run_lock
        first, second = two
        assert first.advisory_locks is True
        with run_lock(tmp_path, "run1", db=first):
            with pytest.raises(RunLocked, match="another worker"):
                with run_lock(tmp_path, "run1", db=second):
                    pass

    def test_a_different_run_is_unaffected(self, two, tmp_path):
        from govern.locks import run_lock
        first, second = two
        with run_lock(tmp_path, "run1", db=first):
            with run_lock(tmp_path, "run2", db=second):
                pass

    def test_the_lease_is_released_when_the_month_ends(self, two, tmp_path):
        from govern.locks import run_lock
        first, second = two
        with run_lock(tmp_path, "run1", db=first):
            pass
        with run_lock(tmp_path, "run1", db=second):
            pass

    def test_the_lease_drops_when_the_holder_disconnects(self, server, tmp_path):
        """A pod that dies mid-month must not leave the run locked forever."""
        from govern.db import Database
        from govern.locks import run_lock
        dying = Database.connect(server.get_uri())
        with run_lock(tmp_path, "run1", db=dying):
            survivor = Database.connect(server.get_uri())
            try:
                with pytest.raises(RunLocked):
                    with run_lock(tmp_path, "run1", db=survivor):
                        pass
                dying.close()                      # the pod goes away mid-month
                with run_lock(tmp_path, "run1", db=survivor):
                    pass
            finally:
                survivor.close()

    def test_one_process_cannot_take_the_same_lease_twice(self, two, tmp_path):
        """Postgres advisory locks are re-entrant per session; a run is not."""
        from govern.locks import run_lock
        first, _ = two
        with run_lock(tmp_path, "run1", db=first):
            with pytest.raises(RunLocked):
                with run_lock(tmp_path, "run1", db=first):
                    pass

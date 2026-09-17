import subprocess
import sys
import textwrap

import pytest

from sim.locks import RunLocked, run_lock


def test_second_process_cannot_advance_the_same_run(tmp_path):
    script = textwrap.dedent(f"""
        import sys, time
        sys.path.insert(0, {str(__import__('pathlib').Path.cwd())!r})
        from sim.locks import run_lock
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

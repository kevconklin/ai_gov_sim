import json

import pytest

from sim.analysis.validation import cohen_kappa, kappa_for_file


def test_cohen_kappa_known_values():
    assert cohen_kappa([1, 1, 0, 0], [1, 1, 0, 0]) == pytest.approx(1.0)
    assert cohen_kappa([1, 0, 1, 0], [0, 1, 0, 1]) == pytest.approx(-1.0)
    assert cohen_kappa([], []) is None
    assert cohen_kappa(["a"], ["a"]) == 1.0
    assert cohen_kappa([1, 2, 3, 4], [1, 2, 3, 3], weights="quadratic") > cohen_kappa([1, 2, 3, 4], [1, 2, 3, 3])


def test_kappa_for_file(tmp_path):
    path = tmp_path / "s.csv"
    path.write_text("msg_id,phase,text,human_code,model_code\n"
                    "a,debate,x,true,true\nb,debate,y,false,false\nc,debate,z,,true\n")
    assert kappa_for_file("suspicion", path) == {"kappa": 1.0, "n": 2}
    import csv
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["msg_id", "phase", "text", "human_code", "model_code"])
        writer.writerow(["a", "debate", "x", json.dumps(["sr_11_7"]), json.dumps(["sr_11_7"])])
        writer.writerow(["b", "debate", "y", "[]", "[]"])
    assert kappa_for_file("frameworks", path)["n"] == 2

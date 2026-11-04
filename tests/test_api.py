import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi.testclient import TestClient
from housing.server import create_app


def client(tmp_path):
    return TestClient(create_app(tmp_path / "t.sqlite3"))


def test_run_save_and_load(tmp_path):
    c = client(tmp_path)
    defaults = c.get("/api/catalogue").json()["defaults"]
    r = c.post("/api/runs", json={**defaults, "feedback": True})
    assert r.status_code == 200 and r.json()["scenario"]["feedback"] is True
    saved = c.post("/api/scenarios", json={"scenario": defaults, "result": r.json()}).json()
    assert c.get("/api/scenarios").json()[0]["has_result"] is True
    assert c.get(f"/api/scenarios/{saved['id']}").json()["result"]["engine"] == "LTspice batch"


def test_rejects_bad_input_and_unknown_id(tmp_path):
    c = client(tmp_path)
    assert c.post("/api/runs", json={"kp": -1}).status_code == 422
    assert c.post("/api/runs", json={"netlist": "x"}).status_code == 422
    assert c.get("/api/scenarios/nope").status_code == 404

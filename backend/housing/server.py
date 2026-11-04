"""FastAPI backend: simulation runs, saved scenarios, static front end."""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from .topology import model_map
from . import analysis
from .scenario import MODEL_VERSION, PRESETS, SECONDS_PER_YEAR, TRAN_START, YEAR_AT_RAW_ZERO, Scenario, run

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "frontend" / "dist"
SLOTS = threading.BoundedSemaphore(4)


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario: Scenario
    result: dict | None = Field(None)


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self._db() as db:
            db.execute("create table if not exists scenarios (id text primary key, name text, created_at text, scenario text, result text)")

    def _db(self):
        return sqlite3.connect(self.path)

    def save(self, name: str, scenario: dict, result: dict | None) -> dict:
        row = {"id": uuid.uuid4().hex, "name": name, "created_at": datetime.now(timezone.utc).isoformat()}
        with self._db() as db:
            db.execute("insert into scenarios values (?,?,?,?,?)", (row["id"], name, row["created_at"], json.dumps(scenario), json.dumps(result) if result else None))
        return row

    def list(self) -> list[dict]:
        with self._db() as db:
            rows = db.execute("select id,name,created_at,scenario,result is not null from scenarios order by created_at desc").fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2], "feedback": json.loads(r[3])["feedback"], "has_result": bool(r[4])} for r in rows]

    def get(self, id: str) -> dict | None:
        with self._db() as db:
            r = db.execute("select id,name,created_at,scenario,result from scenarios where id=?", (id,)).fetchone()
        return r and {"id": r[0], "name": r[1], "created_at": r[2], "scenario": json.loads(r[3]), "result": json.loads(r[4]) if r[4] else None}


class Gains(BaseModel):
    model_config = ConfigDict(extra="forbid")
    K: list[float] = Field(min_length=3, max_length=3)
    filtered: bool = True

    def gains(self):
        if not all(0 <= k <= 60 for k in self.K):
            raise HTTPException(422, "Gains must lie between 0 and 60.")
        return self.K


class EvaluateRequest(Gains):
    settling_yr: float = Field(4.0, ge=0.5, le=30)
    overshoot_pct: float = Field(25.0, ge=1, le=90)


class Pick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["flow", "signal", "element"]
    id: str = Field(max_length=80)


class TransferRequest(Gains):
    input: Pick
    output: Pick
    feedback: bool = False


class MonteCarloRequest(Gains):
    perturb: float = Field(0.2, ge=0.0, le=0.6)
    n: int = Field(100, ge=10, le=300)


class TuneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settling_yr: float = Field(4.0, ge=0.5, le=30)
    overshoot_pct: float = Field(25.0, ge=1, le=90)
    with_S: bool = False
    filtered: bool = True


def create_app(database: Path | None = None) -> FastAPI:
    app = FastAPI(title="Housing policy lab", version=MODEL_VERSION)
    app.add_middleware(GZipMiddleware, minimum_size=2000)
    store = Store(database or Path(os.environ.get("HOUSING_DB", ROOT / "data" / "housing.sqlite3")))

    @app.get("/api/catalogue")
    def catalogue():
        return {"defaults": Scenario().model_dump(), "presets": PRESETS, "schema": Scenario.model_json_schema(),
                "model_version": MODEL_VERSION, "time": {"seconds_per_year": SECONDS_PER_YEAR, "tran_start": TRAN_START, "year_at_raw_zero": YEAR_AT_RAW_ZERO}}

    @app.get("/api/model/map")
    def map_of_model():
        return model_map()

    @app.post("/api/runs")
    def create_run(scenario: Scenario):  # FastAPI runs this in its thread pool
        with SLOTS:
            try:
                return run(scenario)
            except (RuntimeError, ValueError, OSError) as error:
                raise HTTPException(422, f"Simulation failed: {error}") from error

    @app.get("/api/analysis/overview")
    def analysis_overview():
        return analysis.overview()

    @app.post("/api/analysis/evaluate")
    def analysis_evaluate(r: EvaluateRequest):
        return analysis.evaluate(r.gains(), r.filtered, r.settling_yr, r.overshoot_pct)

    @app.post("/api/analysis/transfer")
    def analysis_transfer(r: TransferRequest):
        try:
            return analysis.transfer(r.input.model_dump(), r.output.model_dump(), r.feedback, r.gains(), r.filtered)
        except (ValueError, KeyError, StopIteration) as error:
            raise HTTPException(422, str(error) or "This pair cannot be analysed.") from error

    @app.post("/api/analysis/montecarlo")
    def analysis_montecarlo(r: MonteCarloRequest):
        return analysis.monte_carlo(r.gains(), r.filtered, r.perturb, r.n)

    @app.post("/api/analysis/tune")
    def analysis_tune(r: TuneRequest):
        K, violation = analysis.tune(r.settling_yr, r.overshoot_pct, r.with_S, r.filtered)
        return {"K": K, "violation": violation, "met": violation <= 0}

    @app.post("/api/scenarios", status_code=201)
    def save(request: SaveRequest):
        return store.save(request.scenario.name, request.scenario.model_dump(), request.result)

    @app.get("/api/scenarios")
    def scenarios():
        return store.list()

    @app.get("/api/scenarios/{id}")
    def scenario(id: str):
        found = store.get(id)
        if not found:
            raise HTTPException(404, "Scenario not found")
        return found

    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        if not (DIST / "index.html").exists():
            raise HTTPException(503, "Front end not built. Run npm run build in frontend/.")
        return FileResponse(DIST / "index.html")

    return app

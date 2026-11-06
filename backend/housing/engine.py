"""One entry point for the circuit solver: ngspice (PySpice, the default) or LTspice (batch, reference).

HOUSING_ENGINE=ngspice|ltspice chooses; without it ngspice is used when libngspice loads, else LTspice.
Both return traces under LTspice's names with time from the .tran start, so the rest of the backend is the same.
"""
from __future__ import annotations
import os
import tempfile
from pathlib import Path
import numpy as np
from . import ltspice, netlist as nl, ngspice

_choice: str | None = None


def name() -> str:
    global _choice
    if _choice is None:
        wanted = os.environ.get("HOUSING_ENGINE", "").lower()
        _choice = wanted if wanted in ("ngspice", "ltspice") else ("ngspice" if ngspice.available() else "ltspice")
    return _choice


def label() -> str:
    return "ngspice (PySpice)" if name() == "ngspice" else "LTspice batch"


def simulate(lines: list[str]) -> dict[str, np.ndarray]:
    if name() == "ngspice":
        return ngspice.run_lines(lines)
    with tempfile.TemporaryDirectory(prefix="housing-run-") as folder:
        path = Path(folder) / "run.net"
        nl.write_netlist(lines, path)
        return ltspice.run(path)


def operating_point(lines: list[str]) -> dict[str, float]:
    """Every trace at circuit time 0 (the DC operating point, all inputs at their t = 0 values).
    ngspice: a .op analysis, without time steps. LTspice: the first point of a 0.01 s transient."""
    if name() == "ngspice":
        return ngspice.operating_point(lines)
    lines = list(lines)
    nl.set_tran(lines, ".tran 0 0.01 0 0.005")
    return {k: float(v[0]) for k, v in simulate(lines).items()}

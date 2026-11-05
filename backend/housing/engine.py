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

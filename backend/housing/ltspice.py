"""Runs a netlist with LTspice in batch mode, each run in its own folder."""
from __future__ import annotations
from pathlib import Path
import subprocess
import numpy as np
from .raw import read_raw

BINARY = "/Applications/LTspice.app/Contents/MacOS/LTspice"


def run(netlist: Path, timeout: float = 120.0) -> dict[str, np.ndarray]:
    netlist = Path(netlist).resolve()
    done = subprocess.run([BINARY, "-b", netlist.name], cwd=netlist.parent, timeout=timeout,
                          capture_output=True)
    raw = netlist.with_suffix(".raw")
    if done.returncode != 0 or not raw.exists():
        raise RuntimeError(f"LTspice failed (code {done.returncode}) for {netlist}")
    return read_raw(raw)

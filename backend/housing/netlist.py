"""Builds run netlists from the unchanged 19 Oct LTspice model.

The model file is never edited. Each option replaces exact, asserted element lines,
so a change in the source netlist fails loudly instead of silently altering the run.
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import re

MODEL = Path(__file__).resolve().parents[2] / "model" / "19okt_housing_market.net"
START_OFFSET = -29.29  # subsidy ramp offset already in B§PID
Y0_CLOSED = 80.30878   # I(Construction_cost) at t=0 measured with LTspice


def read_model(path: Path = MODEL) -> list[str]:
    return path.read_bytes().decode("utf-16-le").split("\n")


def write_netlist(lines: list[str], path: Path) -> None:
    path.write_bytes("\n".join(lines).encode("utf-16-le"))


def _index(lines: list[str], prefix: str) -> int:
    hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(hits) != 1:
        raise ValueError(f"expected one line starting {prefix!r}, found {len(hits)}")
    return hits[0]


def _sub_exact(line: str, old: str, new: str) -> str:
    if line.count(old) != 1:
        raise ValueError(f"expected {old!r} once in {line[:80]!r}")
    return line.replace(old, new)


def _scale_pwl(line: str, factor: float) -> str:
    match = re.search(r"PWL\(([^)]*)\)", line)
    numbers = match[1].split()
    numbers[1::2] = [f"{float(v) * factor:.6g}" for v in numbers[1::2]]
    return line[:match.start(1)] + " ".join(numbers) + line[match.end(1):]


@dataclass(frozen=True)
class Controller:
    kp: float
    ki: float
    kd: float
    filter_per_s: float | None = None  # derivative filter corner, rad per simulation second
    integrator_start: float | None = None  # None: START_OFFSET / ki, so the ramp hands over smoothly


def set_open_loop(lines: list[str]) -> None:
    """Historical subsidy PWL drives N031. The PID is disconnected."""
    i = _index(lines, "I§Owner_occupied_subsidies NC_01 NC_02 ")
    lines[i] = _sub_exact(lines[i], " NC_01 NC_02 ", " 0 N031 ")
    i = _index(lines, "B§PID 0 N031 ")
    lines[i] = _sub_exact(lines[i], "B§PID 0 N031 ", "B§PID NC_PID1 NC_PID2 ")


def set_controller(lines: list[str], c: Controller, reference_base: float) -> None:
    """Feedback through B§PID, the element already wired to N031."""
    i = _index(lines, "B§PID 0 N031 ")
    lines[i] = _sub_exact(lines[i], "2.06*i(PID_P)+0.55*I(PID_I_robust)+0.67*I(PID_D)",
                          f"{c.kp:.6g}*i(PID_P)+{c.ki:.6g}*I(PID_I_robust)+{c.kd:.6g}*I(PID_D)")
    start = START_OFFSET / c.ki if c.integrator_start is None else c.integrator_start
    i = _index(lines, "B§PID_I_Robust 0 0 ")
    lines[i] = _sub_exact(lines[i], "-51.38", f"{start:.6g}")
    if c.filter_per_s is not None:
        n, e0 = f"{c.filter_per_s:.6g}", f"{reference_base - Y0_CLOSED:.6g}"
        i = _index(lines, "B§PID_D 0 0 ")
        lines[i] = f"B§PID_D 0 0 I={n}*(I(Error)-I(PID_F))"
        lines.insert(i + 1, f"B§PID_F 0 0 I=idt({n}*(I(Error)-I(PID_F)),{e0})")


def set_reference(lines: list[str], base: float, growth_pct: float) -> None:
    i = _index(lines, "B§Reference 0 0 ")
    lines[i] = _sub_exact(lines[i], "I=80*1.025**(time/6)", f"I={base:.6g}*{1 + growth_pct / 100:.6g}**(time/6)")


def scale_source(lines: list[str], prefix: str, factor: float) -> None:
    """Scale the values of a PWL source, leaving its time points alone."""
    if factor != 1:
        i = _index(lines, prefix)
        lines[i] = _scale_pwl(lines[i], factor)


def set_pulse_amplitude(lines: list[str], prefix: str, old: str, factor: float) -> None:
    """Scale a shock's PULSE amplitude; old is the unchanged 'PULSE(v1 v2' text."""
    if factor != 1:
        i = _index(lines, prefix)
        head, amplitude = old.rsplit(" ", 1)
        lines[i] = _sub_exact(lines[i], old, f"{head} {float(amplitude) * factor:.6g}")

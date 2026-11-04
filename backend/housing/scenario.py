"""User scenario: validated inputs, builds the netlist, turns traces into economic results."""
from __future__ import annotations
import hashlib
from pathlib import Path
import tempfile
from typing import Literal
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator
from . import ltspice, netlist as nl

MODEL_VERSION = "19okt-housing-1"
SECONDS_PER_YEAR = 6.0
TRAN_START = 6.01  # .tran 0.01 180 6.01: raw time 0 is model time 6.01
# Calendar anchor used by the thesis figures (fig_hist_zn.py). Marked for confirmation.
YEAR_AT_RAW_ZERO = 1996.46
FILTER_PER_S = 12.566370614359172 / SECONDS_PER_YEAR  # H-infinity design: 12.57 rad/yr
PRESETS = {
    "hinf": {"label": "H-infinity PID", "kp": 1.131, "ki": 0.666, "kd": 2.839, "filtered": True},
    "zn": {"label": "Ziegler-Nichols PID", "kp": 8.18, "ki": 3.54, "kd": 4.72, "filtered": True},
    "netlist": {"label": "19 Oct netlist PID", "kp": 2.06, "ki": 0.55, "kd": 0.67, "filtered": False},
}


class Scenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field("New scenario", max_length=80)
    feedback: bool = False
    controller: Literal["hinf", "zn", "netlist", "custom"] = "hinf"
    kp: float = Field(1.131, ge=0, le=50)
    ki: float = Field(0.666, ge=0.01, le=20)
    kd: float = Field(2.839, ge=0, le=50)
    derivative_filter: bool = True
    target_growth_pct: float = Field(2.5, ge=0, le=6)
    reference_base: float = Field(80.0, ge=50, le=130)
    subsidy_scale: float = Field(1.0, ge=0, le=2)
    interest_scale: float = Field(1.0, ge=0.25, le=2)
    income_scale: float = Field(1.0, ge=0.8, le=1.2)
    mortgage_scale: float = Field(1.0, ge=0, le=2)
    crisis_scale: float = Field(1.0, ge=0, le=2)
    covid_scale: float = Field(1.0, ge=0, le=2)

    @model_validator(mode="after")
    def _apply_preset(self):
        preset = PRESETS.get(self.controller)
        if preset:
            self.kp, self.ki, self.kd = preset["kp"], preset["ki"], preset["kd"]
            self.derivative_filter = preset["filtered"]
        return self


def build(s: Scenario) -> list[str]:
    lines = nl.read_model()
    if s.feedback:
        start = -51.38 if s.controller == "netlist" else None
        nl.set_controller(lines, nl.Controller(s.kp, s.ki, s.kd, FILTER_PER_S if s.derivative_filter else None, start), s.reference_base)
    else:
        nl.set_open_loop(lines)
        nl.scale_source(lines, "I§Owner_occupied_subsidies ", s.subsidy_scale)
    nl.set_reference(lines, s.reference_base, s.target_growth_pct)
    nl.scale_source(lines, "Interest_Rates ", s.interest_scale)
    nl.scale_source(lines, "Incomeactual ", s.income_scale)
    nl.scale_source(lines, "I§Mortgages ", s.mortgage_scale)
    nl.set_pulse_amplitude(lines, "V§Shock_financialcrisis ", "PULSE(00 -50", s.crisis_scale)
    nl.set_pulse_amplitude(lines, "V§Shock_covid ", "PULSE(00 80", s.covid_scale)
    return lines


SERIES = {
    "price": "I(Construction_cost)", "reference": "I(Reference)", "yoy": "I(Year_on_year_change1)",
    "rental_subsidy": "I(Rental_subsidies1)", "mortgage_debt": "I(Mortgage_debt)", "mortgages": "I(Mortgages)",
    "interest_rate": "I(Interest_rates)", "income": "I(Incomeactual)", "housing_services": "I(Housing_services)",
    "construction": "I(Construction)", "rent": "I(Rent)", "imputed_rent": "I(Imputed_rent)",
}


def yoy_from_price(traces: dict[str, np.ndarray], t: np.ndarray) -> np.ndarray:
    """Same formula as B§Year_on_year_change1, from the price trace.

    LTspice's delay() readout jitters by up to about 0.2 points between otherwise equal
    runs; the price trace repeats to about 0.002. Before one year of saved history exists
    the LTspice readout is the only source, so it is used there.
    """
    raw_t, price = traces["time"], traces["I(Construction_cost)"]
    out = np.interp(t, raw_t, traces["I(Year_on_year_change1)"])
    known = t >= SECONDS_PER_YEAR
    before = np.interp(t[known] - SECONDS_PER_YEAR, raw_t, price)
    out[known] = (np.interp(t[known], raw_t, price) - before) / before * 100
    return out


def evaluate(s: Scenario, traces: dict[str, np.ndarray]) -> dict:
    grid = np.arange(0.0, 173.99 + 1e-9, 0.6)  # 0.1 year
    raw_t = traces["time"]
    sample = lambda name: np.interp(grid, raw_t, traces[name])
    series = {key: sample(name) for key, name in SERIES.items()}
    series["yoy"] = yoy_from_price(traces, grid)
    # The owner subsidy is whichever source drives N031 in this mode.
    series["owner_subsidy"] = sample("I(Pid)" if s.feedback else "I(Owner_occupied_subsidies)")
    year = YEAR_AT_RAW_ZERO + grid / SECONDS_PER_YEAR
    settled = year >= YEAR_AT_RAW_ZERO + 1
    yoy, u = series["yoy"][settled], series["owner_subsidy"]
    yearly_change = np.abs(u[10:] - u[:-10])  # grid is 0.1 year
    kpis = {
        "yoy_min": yoy.min(), "yoy_max": yoy.max(), "yoy_std": yoy.std(),
        "yoy_mean_abs_gap": np.abs(yoy - s.target_growth_pct).mean(),
        "price_final": series["price"][-1],
        "price_gap_final_pct": (series["price"][-1] / series["reference"][-1] - 1) * 100,
        "subsidy_min": u.min(), "subsidy_max": u.max(), "subsidy_mean": u.mean(),
        "subsidy_total": np.trapezoid(u, year), "subsidy_max_change_per_year": yearly_change.max(),
    }
    if not all(np.isfinite(v).all() for v in series.values()):
        raise ValueError("The simulation returned non-finite values.")
    # Every simulated current and node voltage, for the clickable model map.
    all_traces = {name: np.round(sample(name), 4).tolist() for name in traces if name != "time" and not name.startswith("V(nc_")}
    return {"year": year.round(3).tolist(), "traces": all_traces,
            "series": {k: np.round(v, 4).tolist() for k, v in series.items()},
            "kpis": {k: round(float(v), 3) for k, v in kpis.items()}}


def run(s: Scenario) -> dict:
    lines = build(s)
    text = "\n".join(lines)
    with tempfile.TemporaryDirectory(prefix="housing-run-") as folder:
        path = Path(folder) / "run.net"
        nl.write_netlist(lines, path)
        traces = ltspice.run(path)
    return {**evaluate(s, traces), "scenario": s.model_dump(), "engine": "LTspice batch",
            "model_version": MODEL_VERSION, "netlist_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "netlist": text}

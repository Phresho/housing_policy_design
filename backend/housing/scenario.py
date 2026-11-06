"""User scenario: validated inputs, builds the netlist, turns traces into economic results."""
from __future__ import annotations
import hashlib
from pathlib import Path
import tempfile
from typing import Literal
from functools import lru_cache
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator
from . import engine, ltspice, netlist as nl

MODEL_VERSION = "19okt-housing-2 (B4 gain -10, linearised)"
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
    # Model parameters changed in the system-identification panel: {element: factor} on R, L, C values (empty: the netlist).
    param_scale: dict[str, float] = Field(default_factory=dict, max_length=60)
    # Start in equilibrium with the controller in charge (thesis EQUILIBRIUM_INIT_HANDOFF.md): price on the reference,
    # subsidy at the level that holds it there, integrator pre-charged. False: the netlist's 5-s soft start.
    equilibrium_start: bool = True
    # Second loop (MIMO): rental share of housing services, needs feedback on. Gains are Claude's tuning.
    share_control: bool = False
    skp: float = Field(2.112, ge=0, le=50)
    ski: float = Field(1.165, ge=0, le=20)
    skd: float = Field(1.008, ge=0, le=50)
    share_target_pct: float = Field(20.5, ge=5, le=50)
    target_growth_pct: float = Field(2.5, ge=0, le=6)
    reference_base: float = Field(80.0, ge=50, le=130)
    subsidy_scale: float = Field(1.0, ge=0, le=10)
    # False: the historical rental subsidy (4 until 2023, then 0) is switched off for the whole run.
    # With the rental-share loop on, the money that loop moves still flows (it has its own source).
    rental_subsidy: bool = True
    interest_scale: float = Field(1.0, ge=0.25, le=3)
    interest_shift_yr: float = Field(0.0, ge=-5, le=5)   # move the interest-rate path in time (years)
    # Share of the new-loan rate in each step of the effective rate (netlist: 0.1 = 90% old, 10% new).
    interest_new_share: float = Field(0.1, ge=0.02, le=1.0)
    income_scale: float = Field(1.0, ge=0.0, le=2.0)
    # Income: the historical path or a stable growth path from the same 1996 value. Default growth 1.53%
    # a year is the average of the historical path (259.1 to 408.2 over 30 years).
    income_path: Literal["historical", "stable"] = "historical"
    income_growth_pct: float = Field(1.53, ge=-2, le=5)
    # False: the original CPB model without the bank (all bank ports carry zero current).
    bank: bool = True
    mortgage_scale: float = Field(1.0, ge=0, le=10)
    mortgage_shift_yr: float = Field(0.0, ge=-5, le=5)   # move the mortgage-lending path in time (years)
    # Inflation for the comparison with the nominal CBS index: the model's year-on-year change plus this rate.
    # It does not enter the circuit.
    inflation_pct: float = Field(0.0, ge=0, le=5)
    crisis_scale: float = Field(1.0, ge=0, le=2)
    crisis_start_yr: float = Field(YEAR_AT_RAW_ZERO + 15.0, ge=2000, le=2020)  # netlist: 90 s = 2011.46
    # W-shaped crisis: an extra, earlier dip added to the netlist pulse (Claude's addition, 5 Nov 2026).
    # Its shape: 1-year rise, crisis_w_on_yr at full depth, 1-year recovery. Depth relative to the main pulse (-50).
    crisis_w: bool = False
    crisis_w_start_yr: float = Field(2008.0, ge=2000, le=2020)
    crisis_w_scale: float = Field(0.5, ge=0, le=2)
    crisis_w_on_yr: float = Field(1.0, ge=0, le=5)
    covid_scale: float = Field(1.0, ge=0, le=2)
    covid_on_yr: float = Field(2.5, ge=0.1, le=5)     # Covid shock fully on (netlist 15 s = 2.5 yr)
    covid_fall_yr: float = Field(50 / 6, ge=0.1, le=10)  # and its fade-out (netlist 50 s = 8.3 yr)

    @model_validator(mode="after")
    def _check_param_scale(self):
        for name, f in self.param_scale.items():
            if name[:1] not in "RLC" or not (0.05 <= f <= 20):
                raise ValueError(f"param_scale: {name} x{f} (R, L or C, factor 0.05-20)")
        return self

    @model_validator(mode="after")
    def _apply_preset(self):
        preset = PRESETS.get(self.controller)
        if preset:
            self.kp, self.ki, self.kd = preset["kp"], preset["ki"], preset["kd"]
            self.derivative_filter = preset["filtered"]
        return self


# Operating point of B4 (gain -10) in 2015: open-loop run of the 19okt netlist with the non-linear B4, computed with
# LTspice. Stored because ngspice cannot run the non-linear B4 (its first time step stalls); it depends only on the
# netlist, not on any scenario input. tests/test_ngspice.py recomputes it with LTspice where LTspice is installed.
B4_POINT = {"I(Rent)": 29.306751767100593, "I(Demand_rent)": 9.187888049265833,
            "I(Imputed_rent)": 96.18529155352896, "I(Demand_owner_occupied)": 43.000929986092444}


def b4_point(year: float = 2015.0) -> dict[str, float]:
    return dict(B4_POINT) if year == 2015.0 else b4_point_simulated(year)


@lru_cache(maxsize=4)
def b4_point_simulated(year: float = 2015.0) -> dict[str, float]:
    """Operating point of B4 with gain -10: one open-loop run with the non-linear B4 (needs LTspice)."""
    lines = build(Scenario(feedback=False), b4="nonlinear")
    traces = engine.simulate(lines)
    t = (year - YEAR_AT_RAW_ZERO) * SECONDS_PER_YEAR
    lower = {k.lower(): k for k in traces}
    return {n: float(np.interp(t, traces["time"], traces[lower[n.lower()]])) for n in ("I(Rent)", "I(Demand_rent)", "I(Imputed_rent)", "I(Demand_owner_occupied)")}


def _start_price(s: Scenario, u: float) -> float:
    """Price at circuit time 0 (the DC operating point, all inputs at their t = 0 values) with the subsidy fixed at u."""
    lines = build(s.model_copy(update={"feedback": False, "share_control": False}))
    nl.set_constant_subsidy(lines, u)
    nl.set_tran(lines, ".tran 0 0.01 0 0.005")
    traces = engine.simulate(lines)
    lower = {k.lower(): k for k in traces}
    return float(traces[lower["i(construction_cost)"]][0])


SUBSIDY_LIMITS = (-60.0, 600.0)


def equilibrium_subsidy(s: Scenario) -> dict:
    """Subsidy u_ss that puts the price exactly on the reference at t = 0 (secant steps; the plant is nearly
    linear in u, only debt x rate is not). Clipped to the subsidy limits; then the start is not on target."""
    target = s.reference_base
    u0, u1 = 0.0, 30.0
    y0, y1 = _start_price(s, u0), _start_price(s, u1)
    for _ in range(4):
        u2 = u1 - (y1 - target) * (u1 - u0) / (y1 - y0)
        u0, y0, u1 = u1, y1, u2
        y1 = _start_price(s, u1)
        if abs(y1 - target) < 1e-4:
            break
    lo, hi = SUBSIDY_LIMITS
    return {"u_ss": u1, "price0": y1, "free_price0": None, "clipped": not lo <= u1 <= hi, "u_start": min(max(u1, lo), hi)}


def build(s: Scenario, b4: Literal["linear", "nonlinear", "original"] = "linear", u_start: float | None = None) -> list[str]:
    """b4: 'linear' (the site: gain -10, linearised), 'nonlinear' (gain -10), 'original' (the netlist's -1).
    u_start: equilibrium subsidy for the equilibrium start (feedback with equilibrium_start); None: soft start."""
    lines = nl.read_model()
    if b4 != "original":
        nl.set_b4(lines, nl.B4_GAIN, b4_point() if b4 == "linear" else None)
    if s.feedback:
        eq = s.equilibrium_start and u_start is not None
        start = u_start / s.ki if eq else (-51.38 if s.controller == "netlist" else None)
        nl.set_controller(lines, nl.Controller(s.kp, s.ki, s.kd, FILTER_PER_S if s.derivative_filter else None, start, eq), s.reference_base)
        if s.share_control:
            nl.set_share_controller(lines, nl.Controller(s.skp, s.ski, s.skd, FILTER_PER_S if s.derivative_filter else None), s.share_target_pct)
    else:
        nl.set_open_loop(lines)
        nl.scale_source(lines, "I§Owner_occupied_subsidies ", s.subsidy_scale)
    if not s.rental_subsidy:
        lines[nl._index(lines, "I§Rental_subsidies1 ")] = "I§Rental_subsidies1 0 N029 0"
    nl.set_reference(lines, s.reference_base, s.target_growth_pct)
    nl.set_interest_blend(lines, s.interest_new_share)
    nl.scale_source(lines, "Interest_Rates ", s.interest_scale)
    nl.shift_pwl(lines, "Interest_Rates ", s.interest_shift_yr * SECONDS_PER_YEAR)
    if s.income_path == "stable":
        nl.set_income_path(lines, s.income_growth_pct)
    nl.scale_source(lines, "Incomeactual ", s.income_scale)
    if not s.bank:
        nl.set_no_bank(lines)
    nl.scale_source(lines, "I§Mortgages ", s.mortgage_scale)
    nl.shift_pwl(lines, "I§Mortgages ", s.mortgage_shift_yr * SECONDS_PER_YEAR)
    crisis_delay = round((s.crisis_start_yr - YEAR_AT_RAW_ZERO) * SECONDS_PER_YEAR, 6)
    if s.crisis_w:
        w_delay = round((s.crisis_w_start_yr - YEAR_AT_RAW_ZERO) * SECONDS_PER_YEAR, 6)
        nl.set_crisis_pwl(lines, [(crisis_delay, -50 * s.crisis_scale, 10, 20, 35),
                                  (w_delay, -50 * s.crisis_scale * s.crisis_w_scale, SECONDS_PER_YEAR, SECONDS_PER_YEAR, s.crisis_w_on_yr * SECONDS_PER_YEAR)])
    else:
        nl.set_crisis_start(lines, crisis_delay)
        nl.set_pulse_amplitude(lines, "V§Shock_financialcrisis ", "PULSE(00 -50", s.crisis_scale)
    nl.set_covid_timing(lines, round(s.covid_on_yr * SECONDS_PER_YEAR, 6), round(s.covid_fall_yr * SECONDS_PER_YEAR, 6))
    nl.set_pulse_amplitude(lines, "V§Shock_covid ", "PULSE(00 80", s.covid_scale)
    if s.param_scale:
        nl.scale_elements(lines, s.param_scale)
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
    hr, hk = sample("I(Demand_rent)"), sample("I(Demand_owner_occupied)")
    series["rental_share"] = 100 * hr / (hr + hk)
    if s.feedback and s.share_control:
        shift = sample("I(Spid)")
        series["owner_subsidy"] = series["owner_subsidy"] - shift
        series["rental_subsidy"] = series["rental_subsidy"] + shift
        series["share_target"] = np.full_like(grid, s.share_target_pct)
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
    eq = equilibrium_subsidy(s) if s.feedback and s.equilibrium_start else None
    lines = build(s, u_start=eq["u_start"] if eq else None)
    text = "\n".join(lines)
    traces = engine.simulate(lines)
    return {**evaluate(s, traces), "scenario": s.model_dump(), "engine": engine.label(),
            "model_version": MODEL_VERSION, "netlist_sha256": hashlib.sha256(text.encode()).hexdigest(),
            "netlist": text, "equilibrium": eq}

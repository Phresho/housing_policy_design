"""Fit the historical input paths to the CBS year-on-year change (open loop, historical subsidies).

Jesse's request (2026-11-05): the mortgage-lending and interest-rate paths in the netlist were set by hand, so their
scale and timing may be fitted. The housing market itself is not fitted. Fitted: mortgage-lending scale and shift,
interest-rate scale, shift and the share of the new-loan rate, and the Covid shock's duration (on, fade-out). The level offset (inflation and any other trend the model lacks) is the mean gap,
solved in closed form, or held fixed. Least squares on the monthly CBS series, the circuit simulation in the loop (0.1-1 s a run).
"""
from __future__ import annotations
import numpy as np
from scipy.optimize import least_squares

from . import cbs, ltspice
from .scenario import Scenario, run

FIELDS = ("mortgage_scale", "mortgage_shift_yr", "interest_scale", "interest_shift_yr", "interest_new_share", "covid_on_yr", "covid_fall_yr")
LO, HI = (0.0, -4.0, 0.25, -4.0, 0.02, 0.2, 0.2), (10.0, 4.0, 3.0, 4.0, 1.0, 5.0, 10.0)


def _compare(s: Scenario):
    yd, vd = cbs.load()
    r = run(s)
    my = np.array(r["year"]); k = (yd >= my[0] + 1) & (yd <= my[-1])
    return vd[k], np.interp(yd[k], my, r["series"]["yoy"])


def score(s: Scenario, inflation: float | None = None) -> dict:
    d, m = _compare(s)
    pi = float(np.clip(np.mean(d - m), 0, 5)) if inflation is None else inflation
    e = d - m - pi
    return {"rmse": round(float(np.sqrt(np.mean(e ** 2))), 3), "corr": round(float(np.corrcoef(d, m)[0, 1]), 3), "inflation_pct": round(pi, 2),
            "model_std": round(float(m.std()), 2), "data_std": round(float(d.std()), 2)}


def fit(base: Scenario, inflation: float | None = None, starts=((5.03, 2.13, 0.27, 0.0, 0.1, 1.0, 1.0), (5.0, 2.0, 3.0, 0.0, 1.0, 1.0, 1.0))) -> dict:
    """Least-squares fit from the current inputs and the given starts; returns the best inputs and scores."""
    base = base.model_copy(update={"feedback": False, "share_control": False})
    def resid(x):
        try:
            d, m = _compare(base.model_copy(update=dict(zip(FIELDS, x))))
        except Exception:  # a simulation run that fails or hangs counts as a very bad fit
            n = len(_compare(base)[0]); return np.full(n, 50.0)
        pi = np.clip(np.mean(d - m), 0, 5) if inflation is None else inflation
        return d - m - pi
    best = None
    for x0 in (tuple(getattr(base, f) for f in FIELDS), *starts):
        x0 = np.clip(x0, LO, HI)
        sol = least_squares(resid, x0, bounds=(LO, HI), diff_step=[0.05, 0.1, 0.05, 0.1, 0.05, 0.1, 0.1], max_nfev=40)
        if best is None or sol.cost < best.cost:
            best = sol
    x = {f: round(float(v), 3) for f, v in zip(FIELDS, best.x)}
    after = score(base.model_copy(update=x), inflation)
    return {"inputs": {**x, "inflation_pct": after["inflation_pct"]}, "before": score(base, inflation), "after": after,
            "note": "Fitted: mortgage-lending scale and shift, interest-rate scale, shift and new-loan share, Covid duration (open loop, historical subsidies). The market itself is not fitted."}


# ---------------------------------------------------------------- fit to the CPB model's peaks
# Jesse (2026-11-05): the CPB line shows that the model is built on the CPB equations. Only the two CPB peaks
# (the subsidy steps around 2000.5 and 2011.5) and the level between them need to match; the inductors change the
# rest of the dynamics. Use the CPB structure: open loop, bank off, no shocks, stable income growth, no rental subsidy.
CPB_FIELDS = ("income_scale", "subsidy_scale", "income_growth_pct")
CPB_LO, CPB_HI = (0.1, 0.0, -2.0), (2.0, 10.0, 5.0)  # Jesse: income may go down to x0.1
CPB_WINDOWS = ((1999.5, 2003.0), (2010.5, 2013.5))
CPB_LEVEL = (2003.0, 2010.0)


def _features(s: Scenario) -> tuple[np.ndarray, list[float]]:
    """Model peak heights in the two CPB peak windows and the mean between the peaks (with the inflation/trend
    setting added), and the years of the two peaks."""
    r = run(s)
    y = np.array(r["year"]); m = np.array(r["series"]["yoy"]) + s.inflation_pct
    w = [(y > a) & (y < b) for a, b in CPB_WINDOWS]
    level = m[(y >= CPB_LEVEL[0]) & (y < CPB_LEVEL[1])].mean()
    return np.array([m[k].max() for k in w] + [level]), [round(float(y[k][m[k].argmax()]), 2) for k in w]


def fit_cpb(base: Scenario, cpb_scale: float = 1.0) -> dict:
    """Income scale, subsidy scale and income growth so the two peaks and the level match cpb_scale x the CPB path."""
    c = cbs.cpb(); cy, cv = np.array(c["year"]), cpb_scale * np.array(c["yoy"])
    peaks = [float(cv[(cy > a - 1) & (cy < b)].max()) for a, b in CPB_WINDOWS]
    target = np.array(peaks + [float(cv[(cy >= CPB_LEVEL[0]) & (cy < CPB_LEVEL[1])].mean())])
    base = base.model_copy(update={"feedback": False, "share_control": False})
    old, ltspice.TIMEOUT = ltspice.TIMEOUT, 30.0
    def resid(x):
        try:
            return _features(base.model_copy(update=dict(zip(CPB_FIELDS, x))))[0] - target
        except Exception:  # a run that fails or hangs counts as a very bad fit
            return np.full(3, 50.0)
    def show(s):
        f, at = _features(s)
        return {"peaks": [round(float(v), 2) for v in f[:2]], "peak_years": at, "level": round(float(f[2]), 2)}
    try:
        best = None
        for x0 in ((base.income_scale, base.subsidy_scale, base.income_growth_pct), (0.1, 5.0, 3.0), (0.3, 8.0, 3.0)):
            sol = least_squares(resid, np.clip(x0, CPB_LO, CPB_HI), bounds=(CPB_LO, CPB_HI), diff_step=[0.02, 0.02, 0.02], max_nfev=30)
            if best is None or sol.cost < best.cost:
                best = sol
        x = {f: round(float(v), 3) for f, v in zip(CPB_FIELDS, best.x)}
        return {"inputs": x, "target": {"peaks": [round(v, 2) for v in peaks], "level": round(float(target[2]), 2)},
                "before": show(base), "after": show(base.model_copy(update=x)), "cpb_scale": cpb_scale,
                "note": "Fitted: income scale, historical-subsidy scale and income growth so the two CPB peaks and the level between them match."}
    finally:
        ltspice.TIMEOUT = old

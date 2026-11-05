"""CBS house price index (existing owner-occupied homes, 2020=100, monthly) and its alignment with the model.

The data are shown behind the model's year-on-year change. The model is not fitted to them (thesis choice: nominal
model). Only a time shift of the data overlay is estimated: the whole-month lag that maximises the correlation between
the data's year-on-year change and the open-loop historical run's, over the overlapping years. Correlation compares
shape only, so levels play no role. The lag is Claude's estimate and the user can override it on the site.
"""
from __future__ import annotations
import csv
from functools import lru_cache
from pathlib import Path
import numpy as np

CSV = Path(__file__).resolve().parents[2] / "model" / "reference" / "cbs_house_price_index.csv"
MAX_LAG = 36  # months


def load() -> tuple[np.ndarray, np.ndarray]:
    year, yoy = [], []
    with CSV.open() as fh:
        for r in csv.DictReader(fh):
            if r["yoy_pct"]:
                year.append(float(r["year"])); yoy.append(float(r["yoy_pct"]))
    return np.array(year), np.array(yoy)


def best_lag(model_year: np.ndarray, model_yoy: np.ndarray) -> tuple[int, float, float]:
    """(lag in months, correlation at that lag, correlation at zero). Positive lag: the data are moved later."""
    year, yoy = load()
    def corr(lag: int) -> float:
        t = year + lag / 12
        keep = (t >= model_year[0] + 1) & (t <= model_year[-1])  # skip the first model year (start-up transient)
        return float(np.corrcoef(yoy[keep], np.interp(t[keep], model_year, model_yoy))[0, 1])
    lags = range(-MAX_LAG, MAX_LAG + 1)
    scores = [corr(l) for l in lags]
    k = int(np.argmax(scores))
    return lags[k], scores[k], corr(0)


@lru_cache(maxsize=1)
def overlay() -> dict:
    from .scenario import Scenario, run
    r = run(Scenario(feedback=False))
    lag, c, c0 = best_lag(np.array(r["year"]), np.array(r["series"]["yoy"]))
    year, yoy = load()
    return {"year": np.round(year, 4).tolist(), "yoy": np.round(yoy, 3).tolist(), "lag_months": lag, "corr": round(c, 3), "corr_zero": round(c0, 3),
            "source": "CBS, Bestaande koopwoningen; verkoopprijzen prijsindex 2020=100, monthly, 1995-01 to 2026-07"}


CPB_CSV = CSV.parent / "cpb_yoy.csv"


def cpb() -> dict:
    """Year-on-year house price change of the original CPB model, as given by Jesse (2026-11-05): one value a year,
    t in years. Placed at the model's own start (t = 0 is 1996.46), so it lines up with the model run."""
    from .scenario import YEAR_AT_RAW_ZERO
    t, v = [], []
    with CPB_CSV.open() as fh:
        for r in csv.DictReader(fh):
            t.append(float(r["t_years"])); v.append(float(r["yoy_pct"]))
    return {"year": [round(YEAR_AT_RAW_ZERO + x, 4) for x in t], "yoy": v, "source": "CPB model, year-on-year house price change (Jesse, 5 Nov 2026), t = 0 at the model start 1996.46"}

"""Open-loop subsidy paths for the guided tour: one step and a phase-out staircase."""
import sys
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import scenario as sc
from housing.scenario import Scenario


def test_step_points():
    p = sc.subsidy_points(Scenario(subsidy_path="step", subsidy_base=2, subsidy_step=10, subsidy_step_yr=2005))
    assert p[0] == (0, 2) and p[-1][1] == 12
    assert p[1][0] == pytest.approx((2005 - sc.YEAR_AT_RAW_ZERO) * 6 + sc.TRAN_START)


@pytest.mark.parametrize("n", [1, 3, 20])
def test_staircase_points(n):
    p = sc.subsidy_points(Scenario(subsidy_path="staircase", phase_from=30, phase_steps=n, phase_start_yr=2005, phase_years=10))
    values = sorted({round(v, 9) for _, v in p}, reverse=True)
    assert values[0] == 30 and values[-1] == 0 and len(values) == n + 1
    assert all(b[0] >= a[0] for a, b in zip(p, p[1:]))  # time never goes back
    assert p[-2][0] == pytest.approx((2015 - sc.YEAR_AT_RAW_ZERO) * 6 + sc.TRAN_START)  # last step lands at start + years


def test_subsidy_series_follows_the_path():
    r = sc.run(Scenario(subsidy_path="staircase", phase_from=30, phase_steps=3, bank=False))
    u, year = np.array(r["series"]["owner_subsidy"]), np.array(r["year"])
    assert u[year < 2004][0] == pytest.approx(30, abs=1e-3) and u[year > 2016][0] == pytest.approx(0, abs=1e-3)


def test_step_shows_at_its_year():
    r = sc.run(Scenario(subsidy_path="step", subsidy_base=0, subsidy_step=10, subsidy_step_yr=2005, bank=False))
    y, u = np.array(r["year"]), np.array(r["series"]["owner_subsidy"])
    assert abs(y[np.argmax(u > 5)] - 2005) < 0.11

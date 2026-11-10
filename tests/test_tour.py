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


def test_w_crisis_reaches_the_lending_shock():
    """W-shaped crisis: the lending shock (I8) gets the extra early dip and its main dip moves to the crisis start."""
    lines = sc.build(Scenario(crisis_w=True))
    i8 = next(l for l in lines if l.startswith("I8 0 N008 "))
    assert "PWL(" in i8 and "PULSE" not in i8
    plain = next(l for l in sc.build(Scenario()) if l.startswith("I8 0 N008 "))
    assert "PULSE(30 10 70" in plain
    assert next(l for l in sc.build(Scenario(crisis_w=True, bank=False)) if l.startswith("I8 0 N008 ")) == "I8 0 N008 0"


def test_nyquist_margins():
    """H-inf PID: comfortable margins; Ziegler-Nichols: close to -1 (thesis story)."""
    from housing import analysis as an
    h = an.nyquist((1.131, 0.666, 2.839), True)
    z = an.nyquist((8.18, 3.54, 4.72), True)
    assert h["stable"] and z["stable"]
    assert h["gm"]["ratio"] > 3 and h["pm"]["deg"] > 45 and h["ms"] < 2
    assert z["gm"]["ratio"] < 1.5 and z["pm"]["deg"] < 20 and z["ms"] > 5
    assert len(h["re"]) == len(h["im"]) == len(h["cycle_yr"])


def test_gentle_w_keeps_part_of_the_first_dip():
    """W crisis with crisis_w_floor: between the two dips the shock does not bounce back to 0; default unchanged."""
    import re
    def pwl(s):
        line = next(l for l in sc.build(s) if l.startswith("V§Shock_financialcrisis"))
        v = [float(x) for x in re.search(r"PWL\(([^)]*)\)", line).group(1).split()]
        return list(zip(v[0::2], v[1::2]))
    plain = pwl(Scenario(crisis_w=True))
    assert dict(plain)[90.0] == 0.0  # full bounce back before the main dip (netlist delay 90 s)
    gentle = dict(pwl(Scenario(crisis_w=True, crisis_w_floor=0.6, crisis_w_recovery_yr=2.5)))
    assert gentle[90.0] < -10 and min(gentle.values()) == -50

"""System identification (open loop, subsidy -> price) and the model-parameter design."""
import sys
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import analysis as A, engine, netlist as nl
from housing.scenario import Scenario, build

FASTER = {'R13': 1.66, 'C3': 0.63, 'L§Gross_imputed_rent': 0.59, 'L§Gross_rent': 0.72, 'C2': 0.81, 'L2': 0.68}


def test_scale_elements_keeps_rser():
    lines = build(Scenario(param_scale={"L§Gross_imputed_rent": 0.5, "C2": 2}))
    assert "L§Gross_imputed_rent N030 N007 1.5 Rser=1u" in lines and "C2 0 N030 2" in lines
    with pytest.raises(ValueError):
        Scenario(param_scale={"I5": 2})


def test_identify_nominal():
    r = A.identify()
    m = r["metrics"]
    assert r["final"] == pytest.approx(0.5217, abs=1e-3) and m["stable"]
    assert m["cycle_yr"] == pytest.approx(2.79, abs=0.02)  # dominant pair -1.18 +- 2.26j
    assert 1.5 < r["peak"]["t"] < 1.7


def test_design_moves_adjustment_both_ways():
    r0 = A.identify(); a0 = r0["metrics"]["adjust_yr"]
    names = [x["name"] for x in A.sensitivity()[:6]]
    fast, slow = A.design_params(a0 / 2, None, names), A.design_params(a0 * 2, None, names)
    assert fast["metrics"]["adjust_yr"] < 0.7 * a0 < slow["metrics"]["adjust_yr"] / 2
    assert fast["settle_5pct_yr"] < r0["settle_5pct_yr"] < slow["settle_5pct_yr"]


@pytest.mark.parametrize("scale", [{}, FASTER], ids=["nominal", "faster"])
def test_linear_step_matches_netlist(scale):
    """+1 subsidy step at year 10 in the netlist (ngspice) against the linear identification."""
    out = []
    for du in (0.0, 1.0):
        lines = build(Scenario(param_scale=scale))
        lines[nl._index(lines, "I§Owner_occupied_subsidies ")] = f"I§Owner_occupied_subsidies 0 N031 PWL(0 25 60 25 60.01 {25 + du})"
        out.append(engine.simulate(lines))
    t = np.arange(0, 25, 0.1); T = 60.0 - 6.01 + t * 6
    a, b = (np.interp(T, o["time"], o["I(Construction_cost)"]) for o in out)
    r = A.identify(scale)
    assert np.abs((b - a) - np.interp(t, r["step_years"], r["step"])).max() < 0.03

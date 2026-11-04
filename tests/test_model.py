import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
import pytest
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from housing import ltspice, netlist as nl
from housing.raw import read_raw
from housing.scenario import Scenario, build, run, yoy_from_price
SAVED = ROOT / "model" / "reference" / "19okt_saved_closed_loop.raw"


def changed(a, b):
    return [(x, y) for x, y in zip(a, b) if x != y]


def test_default_closed_loop_netlist_is_the_original():
    assert build(Scenario(feedback=True, controller="netlist")) == nl.read_model()


def test_open_loop_changes_only_the_two_wiring_lines():
    a, b = nl.read_model(), build(Scenario(feedback=False))
    assert len(a) == len(b)
    diff = changed(a, b)
    assert len(diff) == 2
    assert b[[i for i, l in enumerate(b) if l.startswith("I§Owner_occupied_subsidies")][0]].startswith("I§Owner_occupied_subsidies 0 N031 PWL(")
    assert not any(l.startswith("B§PID 0 N031") for l in b)


def test_batch_run_reproduces_saved_ltspice_result(tmp_path):
    p = tmp_path / "m.net"
    nl.write_netlist(build(Scenario(feedback=True, controller="netlist")), p)
    new, old = ltspice.run(p), read_raw(SAVED)
    for name in ("I(Construction_cost)", "I(Pid)"):
        gap = np.abs(np.interp(new["time"], old["time"], old[name]) - new[name])
        assert gap.max() < 0.02, name
    t = np.arange(0, 173.9, .1)
    assert np.abs(yoy_from_price(new, t)[t >= 6] - yoy_from_price(old, t)[t >= 6]).max() < 0.01


def test_time_shift_income_reaches_final_pwl_value(tmp_path):
    p = tmp_path / "m.net"
    nl.write_netlist(build(Scenario()), p)
    d = ltspice.run(p)
    assert d["time"][-1] == pytest.approx(173.99, abs=1e-3)
    assert d["I(Incomeactual)"][-1] == pytest.approx(408.24, abs=1e-2)


def test_open_loop_applies_historical_subsidy():
    r = run(Scenario(feedback=False))
    assert r["kpis"]["subsidy_min"] == pytest.approx(20.98, abs=.01)
    assert r["kpis"]["subsidy_max"] == pytest.approx(29.34, abs=.01)


def test_feedback_changes_price_and_tracks_reference():
    closed, opened = run(Scenario(feedback=True)), run(Scenario(feedback=False))
    assert abs(closed["kpis"]["price_gap_final_pct"]) < 2
    assert abs(opened["kpis"]["price_gap_final_pct"]) > 2
    assert closed["kpis"]["yoy_std"] < opened["kpis"]["yoy_std"]


def test_derivative_filter_obeys_its_equation(tmp_path):
    p = tmp_path / "m.net"
    nl.write_netlist(build(Scenario(feedback=True, controller="hinf")), p)
    d = ltspice.run(p)
    t = np.linspace(20, 170, 3000)
    x, dx = np.interp(t, d["time"], d["I(Pid_f)"]), np.interp(t, d["time"], d["I(Pid_d)"])
    numeric = np.gradient(x, t)
    assert np.abs(numeric - dx).max() < 0.05 * max(np.abs(dx).max(), 1)


@pytest.mark.parametrize("field,value", [("interest_scale", 1.5), ("income_scale", 1.1), ("mortgage_scale", .5), ("crisis_scale", 0), ("covid_scale", 0), ("subsidy_scale", .5)])
def test_each_input_changes_open_loop_result(field, value):
    base, other = run(Scenario()), run(Scenario(**{field: value}))
    assert base["netlist_sha256"] != other["netlist_sha256"]
    assert np.abs(np.array(base["series"]["price"]) - np.array(other["series"]["price"])).max() > .01


def test_target_growth_moves_closed_loop():
    k = run(Scenario(feedback=True, target_growth_pct=1.5))["kpis"]
    assert k["price_gap_final_pct"] == pytest.approx(0, abs=2)


def test_presets_cannot_be_overridden_and_bounds_hold():
    s = Scenario(feedback=True, controller="zn", kp=1)
    assert (s.kp, s.ki, s.kd, s.derivative_filter) == (8.18, 3.54, 4.72, True)
    with pytest.raises(ValueError):
        Scenario(ki=0)
    with pytest.raises(ValueError):
        Scenario(extra_line=".include evil")


def test_parallel_runs_do_not_mix():
    with ThreadPoolExecutor(4) as pool:
        a = list(pool.map(run, [Scenario(feedback=bool(i % 2)) for i in range(8)]))
    finals = [round(r["kpis"]["price_final"], 2) for r in a]
    assert len(set(finals[0::2])) == 1 and len(set(finals[1::2])) == 1 and finals[0] != finals[1]

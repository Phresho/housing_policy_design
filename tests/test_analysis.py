"""Linear model and analysis: checked against LTspice and against known structure."""
import sys
import tempfile
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import analysis as An, linear as L, ltspice, netlist as nl
from housing.scenario import Scenario, build, YEAR_AT_RAW_ZERO

HINF = (1.131, 0.666, 2.839)


def _ltspice_step(feedback: bool, year: float = 2010.0):
    """Change in price after a +1 step of the owner subsidy at N031, from two LTspice runs."""
    t0 = (year - YEAR_AT_RAW_ZERO) * 6
    out = []
    for amp in (0, 1):
        lines = build(Scenario(feedback=feedback, controller="hinf"))
        lines.insert(lines.index(".backanno"), f"I§Test 0 N031 PULSE(0 {amp} {t0 + 6.01:.3f} 0.001 0.001 1000 2000)")
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "step.net"
            nl.write_netlist(lines, path)
            tr = ltspice.run(path)
        out.append((tr["time"], tr["I(Construction_cost)"]))
    tt = t0 + np.arange(0, 15, 0.25) * 6
    return (tt - t0) / 6, np.interp(tt, *out[1]) - np.interp(tt, *out[0])


@pytest.mark.parametrize("feedback", [False, True], ids=["open", "closed"])
def test_linear_model_reproduces_ltspice_step(feedback):
    P = L.build_plant(2010.0)
    b, c = An._loop_vectors(P)
    E, A, _ = L.with_controller(P, HINF if feedback else None, True)
    m = A.shape[0]
    bb, cc = np.zeros(m), np.zeros(m)
    bb[:len(b)], cc[:len(c)] = b, c
    years, ltspice_dy = _ltspice_step(feedback)
    t, y = L.step(E, A, bb, cc, 0.0, 15, 0.01)
    linear_dy = np.interp(years, t, y)
    assert np.abs(linear_dy - ltspice_dy).max() < 0.05 * np.abs(ltspice_dy).max()


def test_minimal_plant_matches_the_full_descriptor():
    g, P = An.loop(), An.plant()
    b, c = An._loop_vectors(P)
    s = 1j * L.W[::25]
    rational = np.polyval(g["num"], s) / np.polyval(g["den"], s)
    assert np.allclose(rational, L.freq(P.E, P.A, b, c, 0, L.W[::25]), rtol=1e-4)


@pytest.mark.parametrize("K", [HINF, (8.1768, 3.5413, 4.7201)])
def test_closed_loop_poles_are_eigenvalues_of_the_full_loop(K):
    E, A, _ = L.with_controller(An.plant(), K, True)
    full = L.eigs(E, A)
    for p in An.closed_loop_poles(K):
        assert np.min(np.abs(full - p)) < 1e-4 * max(1, abs(p))


def test_ultimate_gain_puts_a_pair_on_the_axis():
    u = An.ultimate()
    p = np.roots(np.polyadd(An.loop()["den"], u["Ku"] * An.loop()["num"]))
    assert abs(p.real.max()) < 1e-6 and 0.5 < u["Pu_yr"] < 1.0


def test_pole_check_drops_fake_poles():
    # Rental subsidy to price: every reported pole must make the response blow up next to it.
    P = An.plant()
    b = P.B[:, P.inputs.index("I§Rental_subsidies1")]
    _, c = An._loop_vectors(P)
    poles, _ = L.tf_poles_zeros(P.E, P.A, b, c)
    for p in poles / L.YR:
        assert abs(L._h(P.E, P.A, b, c, 0, p + 1e-5)) > 1e3 * abs(L._h(P.E, P.A, b, c, 0, p + 0.2))


def test_transfer_between_two_ports_and_closed_loop_subsidy():
    r = An.transfer({"kind": "flow", "id": "rent"}, {"kind": "flow", "id": "rental_services"}, False, HINF, True)
    assert r["output"] == "Rental housing services" and len(r["gain"]) == len(L.W)
    r = An.transfer({"kind": "signal", "id": "d_crisis"}, {"kind": "flow", "id": "owner_subsidy"}, True, HINF, True)
    assert r["feedback"] and r["poles"] and all(p["decay_rate"] > 0 for p in r["poles"])
    with pytest.raises(ValueError):
        An.resolve({"kind": "signal", "id": "d_crisis"}, "output", True)


def test_hinf_meets_effort_and_trust_limits_zn_does_not():
    e = An.evaluate(HINF, True, 4, 25)
    z = An.evaluate(An.PRESETS["zn"]["K"], True, 4, 25)
    assert e["stable"] and e["limits"]["T"] < 1 and e["limits"]["KS"] < 1
    assert z["limits"]["KS"] > 1 and z["limits"]["T"] > 1

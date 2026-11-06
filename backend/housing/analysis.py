"""Frequency-domain, pole and robustness analysis on the linear model of the run netlist.

The loop: subsidy u at N031 -> price y = I(Construction_cost). G(s) is the minimal (cancelled)
transfer function, so the closed-loop poles of the price loop are the roots of
    s (s + wf) den(s) + [(kd wf + kp) s^2 + (kp wf + ki) s + ki wf] num(s)      (filtered PID)
Gains are in model units (simulation time), as in the thesis and the simulator; they are converted
to years here (ki * 6, kd / 6). Weights and spec values are Claude's choices (see the thesis CHECK list).
"""
from __future__ import annotations
from functools import lru_cache
import numpy as np
from scipy.optimize import minimize
from . import linear as L
from .topology import FLOWS, DISTURBANCES, OUTPUTS

OP_YEAR = 2015.0
WF = L.WF_YR
PRESETS = {  # model units
    "zn": {"label": "Ziegler–Nichols (thesis gains)", "K": [8.1768, 3.5413, 4.7201]},
    "hinf": {"label": "H∞ PID", "K": [1.131, 0.666, 2.839]},
    "pole": {"label": "Pole region only", "K": [0.208, 0.25, 1.402]},
    "pole_s": {"label": "Pole region + shock rejection", "K": [1.45, 0.68, 2.58]},
}
SHOCK_SOURCES = {d["id"]: d["element"] for d in DISTURBANCES}


# ---------------------------------------------------------------- plant
@lru_cache(maxsize=4)
def plant(op_year: float = OP_YEAR) -> L.Plant:
    return L.build_plant(op_year)


def _loop_vectors(P: L.Plant):
    b = P.B[:, P.inputs.index(L.SUBSIDY)].copy()
    c = np.zeros(P.A.shape[0]); c[P.branch[L.PRICE]] = 1
    return b, c


def minimal_g(P: L.Plant) -> dict:
    """G(s) = num(s)/den(s) in years, after pole-zero cancellation."""
    b, c = _loop_vectors(P)
    p, z = L.tf_poles_zeros(P.E, P.A, b, c)
    s0 = 1.0j
    k = L.freq(P.E, P.A, b, c, 0, [1.0])[0] / (np.prod(s0 - z) / np.prod(s0 - p))
    return {"poles": p, "zeros": z, "num": np.real(k * np.poly(z)), "den": np.real(np.poly(p)), "gain": float(np.real(k))}


@lru_cache(maxsize=4)
def loop(op_year: float = OP_YEAR) -> dict:
    P = plant(op_year)
    g = minimal_g(P)
    b, c = _loop_vectors(P)
    g["G"] = L.freq(P.E, P.A, b, c, 0, L.W)
    # Price modes the subsidy cannot move: poles of a shock -> price path that are not poles of G.
    # The pure integrator at 0 (mortgage debt accumulates the lending input) is an input, not a market mode.
    fixed: list[complex] = []
    for src in set(SHOCK_SOURCES.values()) | {"I§Rental_subsidies1", "V4", "V§Maintenance_costs"}:
        pd, _ = L.tf_poles_zeros(P.E, P.A, P.B[:, P.inputs.index(src)], c)
        for q in pd:
            if abs(q) > 1e-6 and min(abs(g["poles"] - q)) > 1e-3 * max(1, abs(q)) and all(abs(q - f) > 1e-3 for f in fixed):
                fixed.append(q)
    g["fixed"] = np.array(fixed)
    return g


def years(K):
    kp, ki, kd = K
    return kp, ki * L.YR, kd / L.YR


def char_poly(g: dict, K, filtered: bool = True) -> np.ndarray:
    kp, ki, kd = years(K)
    if filtered:
        return np.polyadd(np.polymul([1, WF, 0], g["den"]), np.polymul([kd * WF + kp, kp * WF + ki, ki * WF], g["num"]))
    return np.polyadd(np.polymul([1, 0], g["den"]), np.polymul([kd, kp, ki], g["num"]))


def closed_loop_poles(K, filtered: bool = True, g: dict | None = None) -> np.ndarray:
    return np.roots(char_poly(g or loop(), K, filtered))


def ctrl(K, w, filtered: bool = True):
    kp, ki, kd = years(K)
    s = 1j * np.asarray(w)
    return kp + ki / s + (kd * s / (1 + s / WF) if filtered else kd * s)


def sens(K, filtered: bool = True, G=None):
    G = loop()["G"] if G is None else G
    k = ctrl(K, L.W, filtered)
    lp = k * G
    S = 1 / (1 + lp)
    return S, lp * S, k * S


@lru_cache(maxsize=1)
def ultimate():
    """P-only: the gain where a pole pair reaches the imaginary axis (Ku) and its cycle (Pu)."""
    g = loop()
    lo, hi = 0.0, 200.0
    unstable = lambda k: np.roots(np.polyadd(g["den"], k * g["num"])).real.max() > 0
    if not unstable(hi):
        return None
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if unstable(mid) else (mid, hi)
    r = np.roots(np.polyadd(g["den"], hi * g["num"]))
    pu_yr = 2 * np.pi / abs(r[np.argmax(r.real)].imag)
    return {"Ku": hi, "Pu_yr": pu_yr, "zn": [0.6 * hi, 1.2 * hi / (pu_yr * L.YR), 0.075 * hi * pu_yr * L.YR]}


def root_locus(n: int = 260):
    g, u = loop(), ultimate()
    ks = np.linspace(0, 1.7 * (u["Ku"] if u else 20), n)
    return ks, [np.roots(np.polyadd(g["den"], k * g["num"])) for k in ks]


# ---------------------------------------------------------------- weights (Claude's choices)
def WP(w, M=2.0, wB=2.0, eps=1e-3):
    s = 1j * np.asarray(w)
    return (s / M + wB) / (s + wB * eps)


KS_LIMIT = 8.2
RLC = lambda P: [n for n in P.elements if n[0] in "RLC"]


def perturbed(P0: L.Plant, perturb: float, rng) -> L.Plant:
    names = RLC(P0)
    scale = dict(zip(names, rng.uniform(1 - perturb, 1 + perturb, len(names))))
    return L.build_plant(OP_YEAR, scale=scale, op=_op())


@lru_cache(maxsize=1)
def _op():
    return L._operating_point(OP_YEAR)


@lru_cache(maxsize=4)
def wt_envelope(perturb: float = 0.2, n: int = 150, seed: int = 11):
    """Model-error weight: the largest relative change of G over n random plants."""
    P0, G0 = plant(), loop()["G"]
    rng = np.random.default_rng(seed)
    env = np.zeros(len(L.W))
    for _ in range(n):
        P = perturbed(P0, perturb, rng)
        b, c = _loop_vectors(P)
        env = np.maximum(env, np.abs(L.freq(P.E, P.A, b, c, 0, L.W) / G0 - 1))
    return env


@lru_cache(maxsize=16)
def _draws(perturb: float, n: int, seed: int):
    """Random plants (minimal G and frequency response), cached per uncertainty level."""
    P0, rng, out = plant(), np.random.default_rng(seed), []
    for _ in range(n):
        P = perturbed(P0, perturb, rng)
        g = minimal_g(P)
        b, c = _loop_vectors(P)
        g["G"] = L.freq(P.E, P.A, b, c, 0, L.W)
        out.append(g)
    return out


def monte_carlo(K, filtered: bool, perturb: float, n: int = 100, seed: int = 5, curves: int = 40):
    draws = _draws(round(perturb, 3), n, seed)
    stable, S_lines = [], []
    for i, g in enumerate(draws):
        ok = bool(closed_loop_poles(K, filtered, g).real.max() < -1e-4)
        stable.append(ok)
        if i < curves:
            S, _, _ = sens(K, filtered, g["G"])
            S_lines.append({"stable": ok, "S": np.round(np.abs(S)[::5], 4).tolist()})
    return {"n": n, "seed": seed, "perturb": perturb, "stable": int(sum(stable)), "fraction": float(np.mean(stable)), "curves": S_lines}


# ---------------------------------------------------------------- pole region design
def spec_from(settling_yr: float, overshoot_pct: float):
    lo = np.log(overshoot_pct / 100)
    return 4 / settling_yr, -lo / np.sqrt(np.pi ** 2 + lo ** 2)


def region_violation(K, sigma_min, zeta_min, filtered=True, w_max=None):
    p = closed_loop_poles(K, filtered)
    if p.real.max() >= -1e-3:
        return 5.0 + p.real.max()
    z = -p.real / np.abs(p)
    v = max(((sigma_min + p.real) / sigma_min).max(), ((zeta_min - z) / zeta_min).max())
    if w_max:  # shortest allowed cycle: |imaginary part| <= 2 pi / cycle
        v = max(v, ((np.abs(p.imag) - w_max) / w_max).max())
    return v


def tune(settling_yr: float, overshoot_pct: float, with_S: bool, filtered: bool = True, min_cycle_yr: float | None = None):
    sigma, zeta = spec_from(settling_yr, overshoot_pct)
    w_max = 2 * np.pi / min_cycle_yr if min_cycle_yr else None
    wp = np.abs(WP(L.W))

    def cost(x):
        K = np.exp(x)
        if K[2] > 8 or K[0] > 30:
            return 9.0
        v = region_violation(K, sigma, zeta, filtered, w_max)
        if with_S and v < 4:
            v = max(v, (wp * np.abs(sens(K, filtered)[0])).max() - 1)
        return v
    best = None
    for s0 in ([1.131, .666, 2.839], [2, .5, 1], [.8, .4, 1], [.5, .3, .5], [3, 1, 2], [.3, .3, .3]):
        r = minimize(cost, np.log(s0), method="Nelder-Mead", options=dict(xatol=1e-4, fatol=1e-6, maxiter=1500))
        if best is None or r.fun < best.fun:
            best = r
    return [float(v) for v in np.exp(best.x)], float(best.fun)


# ---------------------------------------------------------------- transfer function between two picks
def _element_of_signal(signal: str) -> str | None:
    inner = signal[2:-1].lower() if signal.startswith("I(") else None
    if inner is None:
        return None
    for name in plant().elements:
        if name.split("§")[-1].lower() == inner:
            return name
    return None


def resolve(pick: dict, role: str, feedback: bool) -> dict:
    """Turn a clicked item into an input or output of the linear model."""
    P, kind, id = plant(), pick["kind"], pick["id"]
    if kind == "flow":
        f = next(x for x in FLOWS if x["id"] == id)
        if f["kind"] == "policy":
            src = f["chain"][0]
            if role == "input":
                return {"source": src, "label": f"{f['label']} (extra)"}
            if id == "owner_subsidy" and feedback:
                return {"control": True, "label": f["label"]}
            return {"source_out": src, "label": f["label"]}
        if role == "input":
            if not f["port"]:
                raise ValueError(f"{f['label']} has no port")
            element = _element_of_signal(f["signal"])
            if element in P.inputs:
                return {"source": element, "label": f["label"]}
            return {"inject": [f["port"]["node"], f["port"]["ret"]], "label": f"{f['label']} (extra flow pushed in at the port)"}
        element = _element_of_signal(f["signal"])
        if element is None:
            raise ValueError(f"{f['label']} cannot be an output")
        return {"current": element, "label": f["label"]}
    if kind == "effort":
        f = next(x for x in FLOWS if x["id"] == id)
        if role != "output" or not f["port"]:
            raise ValueError("An effort can only be an output, at a port.")
        return {"voltage": (f["port"]["node"], f["port"]["ret"]), "label": f"{f['label']} (effort)"}
    if kind == "signal":
        if id == "u_open":  # unit step in the controller output, loop open: what the market does on its own
            if role != "input":
                raise ValueError("The open-loop controller step is an input.")
            return {"source": "I§Owner_occupied_subsidies", "label": "Controller output u (owner-occupied subsidy), loop open"}
        if id == "y_reference" and role == "input":
            if not feedback:
                raise ValueError("The target only acts with the loop closed.")
            return {"reference": True, "label": "Target r"}
        if id == "y_reference":
            return {"reference_out": True, "label": "Target r"}
        if id == "y_error" and role == "output":
            return {"error": True, "label": "Gap e"}
        if id in SHOCK_SOURCES:
            if role != "input":
                raise ValueError("A shock is set from outside; use it as the input.")
            return {"source": SHOCK_SOURCES[id], "label": next(d["label"] for d in DISTURBANCES if d["id"] == id)}
        out = next((o for o in OUTPUTS if o["id"] == id), None)
        if out and out["signal"] == "I(Construction_cost)" and role == "output":
            return {"current": L.PRICE, "label": out["label"]}
        raise ValueError("Only the measured price and the shocks can be used here; the other read-outs are ratios.")
    if kind == "element":
        if role == "input":
            if id in P.inputs:
                return {"source": id, "label": id}
            raise ValueError("Use a source, a shock, a subsidy or a port pair as input.")
        if id not in P.elements:
            raise ValueError(f"{id} is not part of the linear model")
        return {"current": id, "label": id}
    raise ValueError("Pick a flow, a signal or a component.")


def _system(i_spec: dict, o_spec: dict, feedback: bool, K, filtered: bool, scale: dict | None = None):
    """(E, A, b, c, d) of one input-output pair, with the loop closed when feedback is on."""
    P = scaled_plant(_key(scale))
    E, A, u_idx = L.with_controller(P, tuple(K) if feedback else None, filtered)
    m, n = A.shape[0], P.A.shape[0]
    b, src = np.zeros(m), None
    if "reference" in i_spec:
        # e = r - y enters the controller rows (see L.with_controller)
        kp, ki, kd = K; nf = L.WF_YR / L.YR; xi, xf, u = n, n + 1, n + 2
        b[xi] = 1
        if filtered:
            b[xf] = nf; b[u] = kp + kd * nf
        else:
            b[xf] = 1; b[u] = kp
    elif "source" in i_spec:
        src = i_spec["source"]; b[:n] = P.B[:, P.inputs.index(src)]
    else:
        col, src = L.input_column(P, {"inject": i_spec["inject"]}); b[:n] = col
    c, d = np.zeros(m), 0.0
    if "control" in o_spec:
        c[u_idx] = 1
    elif "source_out" in o_spec:
        d = 1.0 if o_spec["source_out"] == src else 0.0
    elif "reference_out" in o_spec:
        d = 1.0 if "reference" in i_spec else 0.0
    elif "error" in o_spec:  # e = r - y
        row, dval = L.output_row(P, {"current": L.PRICE}, src)
        c[:n] = -row; d = (1.0 if "reference" in i_spec else 0.0) - dval
    elif "voltage" in o_spec:
        c[:n] = P.voltage(*o_spec["voltage"])
    else:
        row, dval = L.output_row(P, {"current": o_spec["current"]}, src)
        c[:n] = row; d = dval
    return E, A, b, c, d


def steps(inp: dict, outs: list[dict], feedback: bool, K, filtered: bool, years: float = 15, scale: dict | None = None) -> dict:
    """Step responses of several outputs to one input, for the plot cards while tuning."""
    i_spec = resolve(inp, "input", feedback)
    res = {}
    for o in outs:
        key = f"{o['kind']}:{o['id']}"
        try:
            t, y = L.step(*_system(i_spec, resolve(o, "output", feedback), feedback, K, filtered, scale), years=years)
            res[key] = {"t": np.round(t[::4], 3).tolist(), "y": np.round(y[::4], 6).tolist()}
        except (ValueError, KeyError, StopIteration) as error:
            res[key] = {"error": str(error) or "Not available"}
    return {"input": i_spec["label"], "responses": res}


def transfer(inp: dict, out: dict, feedback: bool, K, filtered: bool, scale: dict | None = None):
    i_spec, o_spec = resolve(inp, "input", feedback), resolve(out, "output", feedback)
    E, A, b, c, d = _system(i_spec, o_spec, feedback, K, filtered, scale)
    H = L.freq(E, A, b, c, d, L.W)
    poles, zeros = L.tf_poles_zeros(E, A, b, c, d)
    t, y = L.step(E, A, b, c, d, years=25)
    keep = np.abs(poles) > 1e-7
    dc = L.freq(E, A, b, c, d, [1e-4])[0]
    return {
        "input": i_spec["label"], "output": o_spec["label"], "feedback": feedback,
        "cycle_yr": np.round(L.cycle(L.W), 5).tolist(), "gain": np.round(np.abs(H), 6).tolist(),
        "phase_deg": np.round(np.degrees(np.unwrap(np.angle(H))), 3).tolist(),
        "step_years": np.round(t[::5], 3).tolist(), "step": np.round(y[::5], 6).tolist(),
        "poles": [L.pole_info(p) for p in sorted(poles[keep], key=lambda v: -v.real)],
        "integrators": int((~keep).sum()),
        "zeros": [L.pole_info(z) for z in sorted(zeros, key=lambda v: -v.real)],
        "long_run_gain": round(float(np.real(dc)), 5) if np.all(np.abs(poles) > 1e-7) else None,
    }


# ---------------------------------------------------------------- page data
def _poles(p):
    return [{"re": round(float(v.real), 4), "im": round(float(v.imag), 4)} for v in p]


def overview():
    g, u = loop(), ultimate()
    ks, locus = root_locus()
    return {
        "op_year": OP_YEAR, "presets": PRESETS, "ultimate": u, "wf": WF,
        "open_loop": _poles(g["poles"]), "fixed": _poles(g["fixed"]), "plant_zeros": _poles(g["zeros"]),
        "locus": {"gains": np.round(ks, 4).tolist(), "poles": [_poles(p) for p in locus]},
        "cycle_yr": np.round(L.cycle(L.W), 5).tolist(), "WP": np.round(np.abs(WP(L.W)), 5).tolist(),
        "WT": np.round(wt_envelope(), 5).tolist(), "ks_limit": KS_LIMIT,
    }


PIN_SHIFT, PIN_ZERO = 0.15, 0.5  # Claude's thresholds: moves < 0.15/yr when all gains double, and a plant zero within 0.5


def mobility(K, filtered: bool = True, g: dict | None = None):
    """For each closed-loop pole: how far it moves if all three gains double (first order), and the nearest plant zero."""
    g = g or loop()
    c = char_poly(g, K, filtered)
    nk = np.polysub(c, char_poly(g, [0.0, 0.0, 0.0], filtered))  # the part proportional to the gains
    p = np.roots(c)
    shift = np.abs(np.polyval(nk, p) / np.polyval(np.polyder(c), p)) * np.log(2)
    zd = np.array([np.min(np.abs(g["zeros"] - q)) if len(g["zeros"]) else np.inf for q in p])
    return p, shift, zd


def evaluate(K, filtered: bool, settling_yr: float, overshoot_pct: float, min_cycle_yr: float | None = None):
    p, shift, zd = mobility(K, filtered)
    sigma, zeta = spec_from(settling_yr, overshoot_pct)
    damping = -p.real / np.abs(p)
    inside = (p.real <= -sigma + 1e-9) & (damping >= zeta - 1e-9)
    if min_cycle_yr:  # poles that cycle faster than the shortest allowed cycle are not admissible
        inside &= np.abs(p.imag) <= 2 * np.pi / min_cycle_yr + 1e-9
    S, T, KS = sens(K, filtered)
    wt, wp = wt_envelope(), np.abs(WP(L.W))
    return {
        "poles": [{**L.pole_info(v), "inside": bool(ok), "shift": round(float(s), 4), "zero_dist": round(float(d), 4), "pinned": bool(s < PIN_SHIFT and d < PIN_ZERO)}
                  for v, ok, s, d in zip(p, inside, shift, zd)],
        "stable": bool(p.real.max() < 0), "outside": int((~inside).sum()), "sigma_min": sigma, "zeta_min": zeta,
        "S": np.round(np.abs(S), 5).tolist(), "T": np.round(np.abs(T), 5).tolist(), "KS": np.round(np.abs(KS), 5).tolist(),
        "peaks": {"S": float(np.abs(S).max()), "T": float(np.abs(T).max()), "KS": float(np.abs(KS).max())},
        "limits": {"S": float((wp * np.abs(S)).max()), "T": float((wt * np.abs(T)).max()), "KS": float(np.abs(KS).max() / KS_LIMIT)},
    }


# ---------------------------------------------------------------- system identification (open loop)
# Subsidy u -> house price with the loop open, on the linear model (2015 operating point). Model parameters can be
# changed by factors on R, L, C values ("scale"); the same factors go into the netlist runs (Scenario.param_scale).
# The operating point and the linearised B4 stay those of the netlist (approximation for changed parameters).
ADJUST_TOL = 0.05  # "full adjustment": the price transient is below 5% of the long-run change. Claude's convention.


def _key(scale: dict | None) -> tuple:
    return tuple(sorted((k, round(float(v), 6)) for k, v in (scale or {}).items() if v != 1))


@lru_cache(maxsize=64)
def scaled_plant(key: tuple = ()) -> L.Plant:
    return plant() if not key else L.build_plant(OP_YEAR, scale=dict(key), op=_op())


def _open_poles(P: L.Plant) -> np.ndarray:
    b, c = _loop_vectors(P)
    p, _ = L.tf_poles_zeros(P.E, P.A, b, c)
    return p[np.abs(p) > 1e-7]


def _modes(P: L.Plant) -> dict:
    """Step response of the price to the subsidy as final value + sum of modes r_i e^(p_i t) (residues of G(s)/s).
    adjust: time when the sum of |r_i| e^(Re p_i t) falls below 5% of the final change (an upper bound on the
    measured 5% settling time, but smooth in the parameters). Dominant pair: the oscillating pair with the largest
    residue, i.e. the cycle that shows most in the price (not necessarily the slowest pole)."""
    from scipy import signal
    from scipy.optimize import brentq
    g = minimal_g(P)
    r, p, _ = signal.residue(g["num"], np.polymul(g["den"], [1, 0]))
    zero = np.abs(p) < 1e-7
    final = float(np.real(np.sum(r[zero])))
    modes = [(abs(ri), pi) for ri, pi in zip(r[~zero], p[~zero])]
    stable = bool(all(pi.real < 0 for _, pi in modes))
    adjust = None
    if stable and abs(final) > 1e-12:
        f = lambda T: sum(a * np.exp(pi.real * T) for a, pi in modes) - ADJUST_TOL * abs(final)
        adjust = 0.0 if f(0) <= 0 else float(brentq(f, 0, 500))
    osc = [(a, pi) for a, pi in modes if pi.imag > 1e-6]
    dom = max(osc, key=lambda m: m[0])[1] if osc else None
    return {"final": final, "adjust": adjust, "dominant": dom, "stable": stable, "poles": p[~zero], "residues": [a for a, _ in modes]}


def _metrics(m: dict) -> dict:
    d = m["dominant"]
    return {"adjust_yr": round(m["adjust"], 3) if m["adjust"] is not None else None,
            "cycle_yr": round(float(2 * np.pi / d.imag), 3) if d is not None else None,
            "dominant": {"re": round(float(d.real), 4), "im": round(float(d.imag), 4)} if d is not None else None,
            "stable": m["stable"]}


def identify(scale: dict | None = None, years: float = 25.0) -> dict:
    P = scaled_plant(_key(scale))
    b, c = _loop_vectors(P)
    m = _modes(P); p = m["poles"]
    t, y = L.step(P.E, P.A, b, c, 0.0, years=years)
    final = float(np.real(L.freq(P.E, P.A, b, c, 0, [1e-4])[0])) if np.all(p.real < 0) else None
    k_pk = int(np.argmax(y)); after = y[k_pk:]
    k_tr = k_pk + int(np.argmin(after)) if len(after) > 1 else k_pk
    # time after which the response stays within 5% of its final value (measured, not from the poles)
    settle = None
    if final:
        out = np.where(np.abs(y - final) > ADJUST_TOL * abs(final))[0]
        settle = round(float(t[out[-1] + 1]), 2) if len(out) and out[-1] + 1 < len(t) else (0.0 if not len(out) else None)
    return {
        "poles": [{**L.pole_info(q), "weight": round(float(w), 5)} for q, w in sorted(zip(p, m["residues"]), key=lambda v: -v[0].real)],
        "metrics": _metrics(m), "final": round(final, 5) if final is not None else None,
        "step_years": np.round(t[::5], 3).tolist(), "step": np.round(y[::5], 6).tolist(),
        "peak": {"t": round(float(t[k_pk]), 2), "y": round(float(y[k_pk]), 5)},
        "trough": {"t": round(float(t[k_tr]), 2), "y": round(float(y[k_tr]), 5)} if k_tr > k_pk else None,
        "settle_5pct_yr": settle, "scale": dict(_key(scale)),
    }


@lru_cache(maxsize=1)
def _element_info() -> dict:
    from .topology import model_map
    names = RLC(plant())
    return {e["name"]: {"agent": e.get("agent"), "value": e.get("value"), "role": e.get("role")} for e in model_map()["elements"] if e["name"] in names}


def sensitivity(scale: dict | None = None) -> list[dict]:
    """How much +10% on each R, L, C moves the slowest decay rate and the slowest cycle."""
    base = dict(scale or {}); m0 = _metrics(_modes(scaled_plant(_key(base))))
    rows = []
    for name in RLC(plant()):
        trial = dict(base); trial[name] = trial.get(name, 1.0) * 1.1
        m = _metrics(_modes(L.build_plant(OP_YEAR, scale=trial, op=_op())))
        d_adj = (m["adjust_yr"] or 0) - (m0["adjust_yr"] or 0)
        d_cyc = (m["cycle_yr"] or 0) - (m0["cycle_yr"] or 0)
        rows.append({"name": name, **_element_info().get(name, {}), "d_adjust_yr": round(d_adj, 4), "d_cycle_yr": round(d_cyc, 4)})
    # ranked by the effect on the adjustment time, then on the cycle
    return sorted(rows, key=lambda r: -(abs(r["d_adjust_yr"]) + 0.5 * abs(r["d_cycle_yr"])))


def design_params(adjust_yr: float, cycle_yr: float | None, elements: list[str], scale: dict | None = None,
                  lo: float = 0.2, hi: float = 5.0, weight: float = 0.02) -> dict:
    """Factors on the chosen elements so the slowest mode adjusts in adjust_yr (and the slowest pair cycles in cycle_yr).
    Least squares in log terms, with a small penalty on large changes (weight). Bounds lo..hi per factor."""
    from scipy.optimize import least_squares
    base = dict(scale or {})
    names = [n for n in elements if n in set(RLC(plant()))]
    if not names:
        raise ValueError("choose at least one R, L or C element")

    def trial(x):
        sc = dict(base)
        for n, v in zip(names, x):
            sc[n] = base.get(n, 1.0) * float(np.exp(v))
        return sc

    def res(x):
        try:
            m = _modes(L.build_plant(OP_YEAR, scale=trial(x), op=_op()))
        except Exception:
            m = {"stable": False}
        if not m["stable"] or not m.get("adjust"):
            r = [5.0, 5.0 if cycle_yr else 0.0]
        else:  # unrounded, so the finite-difference gradient survives
            cyc = 2 * np.pi / m["dominant"].imag if m["dominant"] is not None else None
            r = [np.log(m["adjust"] / adjust_yr), np.log(cyc / cycle_yr) if cycle_yr and cyc else 0.0]
        return np.r_[r, np.sqrt(weight) * np.asarray(x)]

    b_lo = [np.log(lo / base.get(n, 1.0)) for n in names]; b_hi = [np.log(hi / base.get(n, 1.0)) for n in names]
    x0 = np.clip(np.zeros(len(names)), np.array(b_lo) + 1e-9, np.array(b_hi) - 1e-9)
    sol = least_squares(res, x0, bounds=(b_lo, b_hi), diff_step=1e-2, max_nfev=300)
    sc = {k: round(v, 4) for k, v in trial(sol.x).items() if abs(v - 1) > 1e-4}
    out = identify(sc)
    out["design"] = {"target_adjust_yr": adjust_yr, "target_cycle_yr": cycle_yr, "elements": names,
                     "changed": {n: sc.get(n, 1.0) for n in names}, "bounds": [lo, hi]}
    return out


def pole_path(a: dict | None, b: dict | None, n: int = 24) -> list[dict]:
    """Open-loop poles (subsidy -> price) while the parameters move from set a to set b, geometrically
    (factor a^(1-l) b^l per element, l = 0..1), so the plot can show where each pole travels."""
    a, b = dict(a or {}), dict(b or {})
    names = sorted(set(a) | set(b))
    out = []
    for lam in np.linspace(0, 1, n + 1):
        sc = {k: float(a.get(k, 1.0) ** (1 - lam) * b.get(k, 1.0) ** lam) for k in names}
        m = _modes(L.build_plant(OP_YEAR, scale=sc, op=_op()) if names else plant())
        d = m["dominant"]
        out.append({"lam": round(float(lam), 3), "poles": [[round(float(q.real), 4), round(float(q.imag), 4)] for q in m["poles"]],
                    "dominant": [round(float(d.real), 4), round(float(d.imag), 4)] if d is not None else None})
    return out

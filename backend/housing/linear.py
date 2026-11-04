"""Linear (small-signal) model of the run netlist, for frequency-domain and pole analysis.

Built from the same 19 Oct netlist the simulator runs, in the open-loop wiring (the owner-occupied
subsidy source at N031 is the plant input). Passive parts enter exactly. The few non-linear
behavioural sources are linearised around one LTspice run at a chosen year:
  B4                     V = -(Rent/Demand_rent - Imputed_rent/Demand_owner)      (ratios)
  B§Construction         I = 0.002 * delay(price^0.6, 1 year)                       (delay: 2nd-order Padé)
  B§Housing_services     I = 48 + integral of construction
  B§Mortgage_interest    I = mortgage debt * interest rate, debt = 100 + integral of mortgages
Constant sources (B2, B5) are zero in small signal. The controller is added as equations, not as
netlist lines: u = K(s) e, e = -y, K(s) = Kp + Ki/s + Kd s/(1 + s/n).

Descriptor form in simulation time: E x' = A x + B u, y = C x + D u. Everything returned to the
outside is in years: poles in 1/year, frequencies in rad/year, cycle length 2*pi/omega years.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from functools import lru_cache
import re
import numpy as np
import scipy.linalg as sl
from .topology import model_map, FLOWS

YR = 6.0                         # simulation seconds per year
WF_YR = 4 * np.pi                # derivative filter corner, rad/year (same as the simulator)
PRICE = "V§Construction_cost"    # y = I(Construction_cost)
SUBSIDY = "I§Owner_occupied_subsidies"  # u enters at N031
SKIP = {"B§PID", "B2", "B5", "B§Salary"}  # controller (added as equations) and constants
PADE = 2


def _num(text: str) -> float:
    m = re.fullmatch(r"([-+]?[\d.]+(?:e[-+]?\d+)?)([a-zA-Zµ]*)", text.strip())
    if not m:
        raise ValueError(f"not a number: {text}")
    scale = {"": 1, "f": 1e-15, "p": 1e-12, "n": 1e-9, "u": 1e-6, "µ": 1e-6, "m": 1e-3, "k": 1e3, "meg": 1e6}[m[2].lower()]
    return float(m[1]) * scale


@dataclass
class Plant:
    E: np.ndarray
    A: np.ndarray
    names: list[str]                 # name of each state
    node: dict[str, int]             # node voltage index
    branch: dict[str, int]           # element current state index (L, C, V, behavioural V)
    elements: dict[str, dict]
    inputs: list[str]                # independent sources, one input column each
    B: np.ndarray
    expr: dict[str, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)  # behavioural current = row @ x + drow @ u

    def current(self, name: str) -> tuple[np.ndarray, np.ndarray, int]:
        """Output row for the current through an element: (c, d, derivative order)."""
        e, n, c, d = self.elements[name], self.A.shape[0], np.zeros(self.A.shape[0]), np.zeros(len(self.inputs))
        if name in self.branch:
            c[self.branch[name]] = 1
        elif name[0] == "R":
            r = _num(e["value"])
            for node, s in ((e["a"], 1), (e["b"], -1)):
                if node in self.node:
                    c[self.node[node]] += s / r
        elif name in self.inputs:
            d[self.inputs.index(name)] = 1
        elif name in self.expr:
            c, d = self.expr[name]
        else:
            raise KeyError(f"no current for {name}")
        return c, d, 0

    def voltage(self, a: str, b: str) -> np.ndarray:
        c = np.zeros(self.A.shape[0])
        for node, s in ((a, 1), (b, -1)):
            if node in self.node:
                c[self.node[node]] += s
        return c


def _operating_point(year: float) -> dict[str, float]:
    from .scenario import Scenario, run, YEAR_AT_RAW_ZERO, SECONDS_PER_YEAR
    traces = _baseline_traces()
    t = (year - YEAR_AT_RAW_ZERO) * SECONDS_PER_YEAR
    names = ["I(Rent)", "I(Demand_rent)", "I(Imputed_rent)", "I(Demand_owner_occupied)", "I(Construction_cost)", "I(Mortgage_debt)", "I(Interest_rates)"]
    lower = {k.lower(): k for k in traces}
    return {n: float(np.interp(t, traces["time"], traces[lower[n.lower()]])) for n in names}


@lru_cache(maxsize=1)
def _baseline_traces():
    import tempfile
    from pathlib import Path
    from . import ltspice, netlist as nl
    from .scenario import Scenario, build
    with tempfile.TemporaryDirectory(prefix="housing-op-") as folder:
        path = Path(folder) / "op.net"
        nl.write_netlist(build(Scenario(feedback=False)), path)
        return ltspice.run(path)


def build_plant(op_year: float = 2015.0, scale: dict[str, float] | None = None, op: dict[str, float] | None = None) -> Plant:
    """Small-signal descriptor of the open-loop netlist. scale multiplies R, L, C values by name
    (used for the parameter-uncertainty Monte Carlo)."""
    op = op or _operating_point(op_year)
    scale = scale or {}
    els = {}
    for e in model_map()["elements"]:
        e = dict(e)
        if e["name"] == SUBSIDY:
            e["a"], e["b"], e["state"] = "0", "N031", "active"
        if e["a"] == e["b"] or e["name"] in SKIP or e["state"] not in ("active", "signal") or "NC_" in e["a"] + e["b"]:
            continue
        els[e["name"]] = e
    nodes = sorted({n for e in els.values() for n in (e["a"], e["b"])} - {"0"})
    names = [f"V({n})" for n in nodes]
    node = {n: i for i, n in enumerate(nodes)}
    branch: dict[str, int] = {}
    for name, e in els.items():
        kind = name[0]
        if kind in "LCV" or (kind == "B" and "V=" in e["value"]):
            branch[name] = len(names); names.append(f"I({name})")
    extra = {"debt": len(names), "housing": len(names) + 1}
    names += ["mortgage debt", "housing services"]
    pade0 = len(names); names += [f"delay state {k}" for k in range(PADE)]
    n = len(names)
    inputs = [name for name in els if name[0] in "IV"]
    M0, M1, B = np.zeros((n, n)), np.zeros((n, n)), np.zeros((n, len(inputs)))
    expr: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    def kcl(a: str, b: str, col: int | None = None, row_vec: np.ndarray | None = None, factor: float = 1.0):
        """Current factor*(x[col] or row_vec @ x) leaves node a and enters node b."""
        for nd, s in ((a, 1), (b, -1)):
            if nd in node:
                if col is not None:
                    M0[node[nd], col] += s * factor
                else:
                    M0[node[nd]] += s * factor * row_vec

    for name, e in els.items():
        a, b, kind, value = e["a"], e["b"], name[0], e["value"]
        f = scale.get(name, 1.0)
        if kind == "R":
            g = 1 / (_num(value.split()[0]) * f)
            for p, q, s in ((a, a, 1), (b, b, 1), (a, b, -1), (b, a, -1)):
                if p in node and q in node:
                    M0[node[p], node[q]] += s * g
        elif kind == "L":
            k = branch[name]; parts = value.split()
            rser = _num(parts[1].split("=")[1]) if len(parts) > 1 and parts[1].lower().startswith("rser") else 0.0
            kcl(a, b, k)
            for nd, s in ((a, 1), (b, -1)):
                if nd in node:
                    M0[k, node[nd]] += s
            M0[k, k] -= rser; M1[k, k] -= _num(parts[0]) * f
        elif kind == "C":
            k = branch[name]
            kcl(a, b, k)
            for nd, s in ((a, 1), (b, -1)):
                if nd in node:
                    M1[k, node[nd]] += s * _num(value.split()[0]) * f
            M0[k, k] -= 1
        elif kind == "V":
            k = branch[name]
            kcl(a, b, k)
            for nd, s in ((a, 1), (b, -1)):
                if nd in node:
                    M0[k, node[nd]] += s
            B[k, inputs.index(name)] = 1
        elif kind == "I":
            j = inputs.index(name)
            for nd, s in ((a, -1), (b, 1)):
                if nd in node:
                    B[node[nd], j] += s
    handled = {"B11", "B4", "B§Construction", "B§Housing_services", "B§Mortgage_interest"}
    unknown = [name for name in els if name[0] == "B" and name not in handled]
    if unknown:
        raise ValueError(f"behavioural sources without a linear form: {unknown}")
    # Behavioural sources, linearised.
    cur = lambda name: branch[name]
    price = cur(PRICE)
    # B11: I = 0.02 * I(F_consumption), from 0 into N043
    row = np.zeros(n); row[cur("L§F_Consumption")] = 0.02
    kcl("0", "N043", row_vec=row); expr["B11"] = (row, np.zeros(len(inputs)))
    # B4 (voltage source N027 -> 0): V = -(R/Dr - I/Do)
    k = branch["B4"]; R0, Dr, I0, Do = op["I(Rent)"], op["I(Demand_rent)"], op["I(Imputed_rent)"], op["I(Demand_owner_occupied)"]
    kcl("N027", "0", k); M0[k, node["N027"]] += 1
    M0[k, cur("L§Rent")] += 1 / Dr; M0[k, cur("L§Demand_rent")] -= R0 / Dr ** 2
    M0[k, cur("L§Imputed_rent")] -= 1 / Do; M0[k, cur("L§Demand_owner_occupied")] += I0 / Do ** 2
    # Construction: kc * delay(price), Padé (1 - sT/2 + (sT)^2/12)/(1 + sT/2 + (sT)^2/12), T = 6 s
    P0, T = op["I(Construction_cost)"], 6.0
    kc = 0.002 * 0.6 * P0 ** -0.4
    q1, q2 = pade0, pade0 + 1   # controllable canonical form of the Padé filter, input = price
    a1, a0 = 6 / T, 12 / T ** 2  # den s^2 + a1 s + a0, num s^2 - a1 s + a0
    M1[q1, q1] = 1; M0[q1, q2] = -1                         # q1' = q2
    M1[q2, q2] = 1; M0[q2, q1] = a0; M0[q2, q2] = a1; M0[q2, price] = -1  # q2' = -a0 q1 - a1 q2 + price
    delayed = np.zeros(n); delayed[q2] = -2 * a1; delayed[price] = 1  # num/den = 1 + (-2 a1 s)/den
    construction = kc * delayed
    kcl("N035", "N034", row_vec=construction); expr["B§Construction"] = (construction, np.zeros(len(inputs)))
    h = extra["housing"]; M1[h, h] = 1; M0[h] -= construction           # housing' = construction
    hrow = np.zeros(n); hrow[h] = 1
    kcl("0", "N018", row_vec=hrow); expr["B§Housing_services"] = (hrow, np.zeros(len(inputs)))
    # Mortgage interest from N007 to 0: rate0 * debt + debt0 * rate; debt' = mortgages
    d = extra["debt"]; M1[d, d] = 1; B[d, inputs.index("I§Mortgages")] = 1
    mrow = np.zeros(n); mrow[d] = op["I(Interest_rates)"]
    kcl("N007", "0", row_vec=mrow)
    B[node["N007"], inputs.index("Interest_Rates")] -= op["I(Mortgage_debt)"]
    mdrow = np.zeros(len(inputs)); mdrow[inputs.index("Interest_Rates")] = op["I(Mortgage_debt)"]
    expr["B§Mortgage_interest"] = (mrow, mdrow)
    # Floating islands (the houses loop): fix one node voltage per island.
    parent = {nd: nd for nd in nodes}

    def find(x):
        while parent[x] != x:
            x = parent[x]
        return x
    for e in els.values():
        if e["a"] != "0" and e["b"] != "0":
            parent[find(e["a"])] = find(e["b"])
    grounded = {find(e["a"] if e["a"] != "0" else e["b"]) for e in els.values() if "0" in (e["a"], e["b"])}
    for root in {find(nd) for nd in nodes} - grounded:
        i = node[root]; M0[i] = 0; M1[i] = 0; B[i] = 0; M0[i, i] = 1
    return Plant(E=M1, A=-M0, names=names, node=node, branch=branch, elements=els, inputs=inputs, B=B, expr=expr)


# ---------------------------------------------------------------- systems
@dataclass
class System:
    E: np.ndarray
    A: np.ndarray
    b: np.ndarray
    c: np.ndarray
    d: float = 0.0


def input_column(P: Plant, spec: dict) -> np.ndarray:
    """spec: {'source': element} or {'inject': [node, return]} (a flow pushed into node, back out of return)."""
    if "source" in spec:
        return P.B[:, P.inputs.index(spec["source"])].copy(), spec["source"]
    a, ret = spec["inject"]
    col = np.zeros(P.A.shape[0])
    for nd, s in ((ret, -1), (a, 1)):
        if nd in P.node:
            col[P.node[nd]] += s
    return col, None


def output_row(P: Plant, spec: dict, source: str | None) -> tuple[np.ndarray, float]:
    if "current" in spec:
        c, drow, _ = P.current(spec["current"])
        return c, float(drow[P.inputs.index(source)]) if source else 0.0
    return P.voltage(*spec["voltage"]), 0.0


def with_controller(P: Plant, K: tuple[float, float, float] | None, filtered: bool = True, extra_out: bool = False) -> tuple[np.ndarray, np.ndarray, int]:
    """Closed loop: u at N031 = K(s) e, e = -y. Returns (E, A, index of u) with the controller states appended.
    K is in model units (simulation time), as in the thesis tables and the simulator."""
    n = P.A.shape[0]
    if K is None:
        return P.E.copy(), P.A.copy(), -1
    kp, ki, kd = K
    nf = WF_YR / YR
    m = n + 3  # integrator, filter state, u (algebraic)
    E, A = np.zeros((m, m)), np.zeros((m, m))
    E[:n, :n], A[:n, :n] = P.E, P.A
    bu, cy = P.B[:, P.inputs.index(SUBSIDY)], np.zeros(n)
    cy[P.branch[PRICE]] = 1
    xi, xf, u = n, n + 1, n + 2
    A[:n, u] = bu
    E[xi, xi] = 1; A[xi, :n] = -cy                                  # xi' = e = -y
    if filtered:
        E[xf, xf] = 1; A[xf, :n] = -nf * cy; A[xf, xf] = -nf        # f' = n (e - f)
        # u = kp e + ki xi + kd n (e - f)
        A[u, u] = -1; A[u, :n] = -(kp + kd * nf) * cy; A[u, xi] = ki; A[u, xf] = -kd * nf
    else:
        A[xf, xf] = -1; A[xf, :n] = -cy                              # w = e (algebraic)
        A[u, u] = -1; A[u, :n] = -kp * cy; A[u, xi] = ki; E[u, xf] = -kd  # 0 = -u + kp e + ki xi + kd w'
    return E, A, u


def _finite(w: np.ndarray, big: float = 1e5) -> np.ndarray:
    return w[np.isfinite(w) & (np.abs(w) < big)]


def eigs(E: np.ndarray, A: np.ndarray) -> np.ndarray:
    """Finite eigenvalues of E x' = A x, in 1/year."""
    return _finite(sl.eig(A, E, right=False)) * YR


def _h(E, A, b, c, d, s):
    return np.linalg.solve(s * E - A, b) @ c + d


def tf_poles_zeros(E, A, b, c, d=0.0, tol=1e-6):
    """Poles and zeros of c (sE - A)^-1 b + d, in 1/year.

    Candidates come from the pencil and the Rosenbrock pencil; common pairs cancel. Each survivor is
    then checked on the function itself: a pole must make |H| blow up next to it, a zero must make
    it vanish. This removes pairs that numerical cancellation misses."""
    n = A.shape[0]
    poles = list(_finite(sl.eig(A, E, right=False)))
    Ar = np.block([[A, b[:, None]], [c[None, :], np.array([[d]])]])
    Er = np.block([[E, np.zeros((n, 1))], [np.zeros((1, n + 1))]])
    zeros = list(_finite(sl.eig(Ar, Er, right=False)))
    kept_p = []
    for p in sorted(poles, key=lambda v: (v.real, v.imag)):
        j = min(range(len(zeros)), key=lambda k: abs(zeros[k] - p), default=None)
        if j is not None and abs(zeros[j] - p) < tol * max(1, abs(p)) + 1e-9:
            zeros.pop(j)
        else:
            kept_p.append(p)

    def ratio(q):
        r = 1e-4 * max(1.0, abs(q))
        near = np.mean([abs(_h(E, A, b, c, d, q + r * np.exp(1j * t))) for t in (0.4, 2.1, 4.0)])
        far = np.mean([abs(_h(E, A, b, c, d, q + 0.25 * max(1.0, abs(q)) * np.exp(1j * t))) for t in (0.4, 2.1, 4.0)])
        return near / max(far, 1e-300)
    real_p = [p for p in kept_p if ratio(p) > 30]
    real_z = [z for z in zeros if ratio(z) < 1 / 30]
    return np.array(real_p) * YR, np.array(real_z) * YR


def freq(E, A, b, c, d, w_yr) -> np.ndarray:
    s = 1j * np.asarray(w_yr) / YR
    M = s[:, None, None] * E[None] - A[None]
    x = np.linalg.solve(M, np.broadcast_to(b, (len(s), len(b)))[..., None])[..., 0]
    return x @ c + d


def step(E, A, b, c, d, years: float = 20.0, dt_yr: float = 0.02):
    """Response of the output to a permanent unit step of the input (implicit Euler)."""
    h = dt_yr * YR
    lu = sl.lu_factor(E - h * A)
    x = np.zeros(A.shape[0]); out = [0.0]
    # consistent start: algebraic parts settle at the first step
    for _ in range(int(round(years / dt_yr))):
        x = sl.lu_solve(lu, E @ x + h * b)
        out.append(float(c @ x + d))
    return np.arange(len(out)) * dt_yr, np.array(out)


def pole_info(p: complex) -> dict:
    sigma, wd = -p.real, abs(p.imag)
    zeta = sigma / abs(p) if abs(p) > 0 else 1.0
    return {"re": round(float(p.real), 4), "im": round(float(p.imag), 4), "decay_rate": round(float(sigma), 4),
            "settling_yr": round(4 / sigma, 3) if sigma > 1e-9 else None,
            "cycle_yr": round(2 * np.pi / wd, 3) if wd > 1e-9 else None, "damping": round(float(zeta), 4)}


W = np.logspace(-2, np.log10(300), 500)  # rad/year: cycles from 630 years down to 0.02 years


def cycle(w):
    return 2 * np.pi / np.asarray(w)

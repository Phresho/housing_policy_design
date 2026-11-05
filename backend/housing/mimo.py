"""Two subsidies, two goals: the house price and the rental share of housing services.

Linear 2x2 model of the 19 Oct netlist. Inputs: owner-occupied subsidy (N031) and rental subsidy
(N029). Outputs: house price (model units) and the rental share of housing services,
100 * h_rent / (h_rent + h_owner), in percent.

Controller (Claude's choice, the thesis uses the sum/difference version of the same idea):
    owner subsidy  = u_price - u_share
    rental subsidy = baseline + u_share
The price loop is the single-input PID unchanged. The share loop moves money from one subsidy to the
other; both subsidies move the price by the same amount, so this leaves the price (almost) alone.
"""
from __future__ import annotations
from functools import lru_cache
import numpy as np
from scipy.optimize import minimize

from . import linear as L
from . import analysis as A

RENT = "I§Rental_subsidies1"
D = np.array([[1.0, -1.0], [0.0, 1.0]])  # rows: owner, rental subsidy; columns: price loop, share loop
SHARE_PRESET = [4.0, 2.0, 0.0]            # placeholder until tuned; replaced by TUNED below when available


def _share_row(P: L.Plant, op: dict) -> np.ndarray:
    hr, hk = op["I(Demand_rent)"], op["I(Demand_owner_occupied)"]
    cr, _, _ = P.current("L§Demand_rent")
    ck, _, _ = P.current("L§Demand_owner_occupied")
    return 100 * (hk * cr - hr * ck) / (hr + hk) ** 2


def share0(op: dict | None = None) -> float:
    op = op or A._op()
    hr, hk = op["I(Demand_rent)"], op["I(Demand_owner_occupied)"]
    return 100 * hr / (hr + hk)


def io(P: L.Plant):
    """Input columns (owner, rental) and output rows (price, share)."""
    B = np.column_stack([P.B[:, P.inputs.index(L.SUBSIDY)], P.B[:, P.inputs.index(RENT)]])
    cp = np.zeros(P.A.shape[0]); cp[P.branch[L.PRICE]] = 1
    C = np.vstack([cp, _share_row(P, A._op())])
    return B, C


def freq2(P: L.Plant, w=None) -> np.ndarray:
    """G(jw) as an array (len(w), 2, 2)."""
    w = L.W if w is None else w
    B, C = io(P)
    G = np.zeros((len(w), 2, 2), complex)
    for j in range(2):
        for i in range(2):
            G[:, i, j] = L.freq(P.E, P.A, B[:, j], C[i], 0, w)
    return G


@lru_cache(maxsize=2)
def G2() -> np.ndarray:
    return freq2(A.plant())


def kmat(Kp, Ks, filtered=True, w=None):
    w = L.W if w is None else w
    k1, k2 = A.ctrl(Kp, w, filtered), A.ctrl(Ks, w, filtered)
    Kd = np.zeros((len(w), 2, 2), complex); Kd[:, 0, 0] = k1; Kd[:, 1, 1] = k2
    return D[None] @ Kd


def sens2(Kp, Ks, filtered=True, G=None):
    G = G2() if G is None else G
    K = kmat(Kp, Ks, filtered)
    S = np.linalg.inv(np.eye(2)[None] + G @ K)
    return S, G @ K @ S, K @ S


def sv(M):
    return np.linalg.svd(M, compute_uv=False)  # (len(w), k), largest first


def closed_loop(P: L.Plant, Kp, Ks, filtered=True):
    """Descriptor E x' = A x of the plant with both loops closed (simulation time)."""
    n = P.A.shape[0]; B, C = io(P); nf = L.WF_YR / L.YR
    m = n + 6
    E, Am = np.zeros((m, m)), np.zeros((m, m))
    E[:n, :n], Am[:n, :n] = P.E, P.A
    for j, (K, cy) in enumerate(((Kp, C[0]), (Ks, C[1]))):
        kp, ki, kd = K
        xi, xf, v = n + 3 * j, n + 3 * j + 1, n + 3 * j + 2
        Am[:n, v] = B @ D[:, j]
        E[xi, xi] = 1; Am[xi, :n] = -cy
        if filtered:
            E[xf, xf] = 1; Am[xf, :n] = -nf * cy; Am[xf, xf] = -nf
            Am[v, v] = -1; Am[v, :n] = -(kp + kd * nf) * cy; Am[v, xi] = ki; Am[v, xf] = -kd * nf
        else:
            Am[xf, xf] = -1; Am[xf, :n] = -cy
            Am[v, v] = -1; Am[v, :n] = -kp * cy; Am[v, xi] = ki; E[v, xf] = -kd
    return E, Am


def _raw_poles(Kp, Ks, filtered=True, P=None):
    E, Am = closed_loop(P or A.plant(), Kp, Ks, filtered)
    return L.eigs(E, Am)


@lru_cache(maxsize=1)
def fixed_modes() -> np.ndarray:
    """Modes no gain choice moves (same for two unrelated controllers), e.g. the two pure integrators of
    mortgage debt and the services stock, which the subsidies cannot reach."""
    c1, c2 = _raw_poles([1.131, 0.666, 2.839], [4, 2, 0.5]), _raw_poles([2, 1, 1], [1, 1, 0.1])
    return np.array([q for q in c1 if min(abs(c2 - q)) < 1e-6 * max(1, abs(q))])


def poles2(Kp, Ks, filtered=True, P=None):
    """Closed-loop poles in 1/year, without the fixed modes."""
    p, fx = list(_raw_poles(Kp, Ks, filtered, P)), list(fixed_modes())
    for q in fx:
        j = min(range(len(p)), key=lambda k: abs(p[k] - q))
        if abs(p[j] - q) < 1e-5 * max(1, abs(q)):
            p.pop(j)
    return np.array(p)


@lru_cache(maxsize=2)
def wt_envelope2(perturb: float = 0.2, n: int = 150, seed: int = 11):
    """Largest singular value of (Gp - G) G^-1 over n random plants (multiplicative output uncertainty)."""
    G0 = G2(); Gi = np.linalg.inv(G0)
    rng = np.random.default_rng(seed); env = np.zeros(len(L.W))
    for _ in range(n):
        Gp = freq2(A.perturbed(A.plant(), perturb, rng))
        env = np.maximum(env, sv((Gp - G0) @ Gi)[:, 0])
    return env


def norm_N(Kp, Ks, filtered=True, with_T=False):
    S, T, KS = sens2(Kp, Ks, filtered)
    parts = [np.abs(A.WP(L.W))[:, None, None] * S, KS / A.KS_LIMIT]
    if with_T:
        parts.append(wt_envelope2()[:, None, None] * T)
    return float(sv(np.concatenate(parts, axis=1))[:, 0].max())


def tune_share(Kp, filtered=True, x0=(4.0, 2.0, 0.5)):
    """Share-loop gains that minimise ||N||_inf with the price gains held fixed (Nelder-Mead on log gains)."""
    def cost(x):
        Ks = np.exp(x)
        if poles2(Kp, Ks, filtered).real.max() >= -1e-4:
            return 1e3
        return norm_N(Kp, Ks, filtered)
    best = None
    for s in (x0, (10.0, 5.0, 1.0), (1.0, 0.5, 0.2)):
        r = minimize(cost, np.log(s), method="Nelder-Mead", options=dict(xatol=1e-4, fatol=1e-6, maxiter=800))
        if best is None or r.fun < best.fun:
            best = r
    return np.exp(best.x), float(best.fun)


def tune_all(filtered=True, x0=None, with_T=False):
    """All six gains (price and share loop) that minimise ||N||_inf (Nelder-Mead on log gains, a local minimum)."""
    x0 = x0 or [*A.PRESETS["hinf"]["K"], 2.1, 1.2, 1.0]
    def cost(x):
        K = np.exp(x)
        if poles2(K[:3], K[3:], filtered).real.max() >= -1e-4:
            return 1e3
        return norm_N(K[:3], K[3:], filtered, with_T)
    r = minimize(cost, np.log(x0), method="Nelder-Mead", options=dict(xatol=1e-4, fatol=1e-6, maxiter=3000, adaptive=True))
    K = np.exp(r.x)
    return K[:3], K[3:], float(r.fun)

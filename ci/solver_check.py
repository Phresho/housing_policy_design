"""Solver check for a new machine (written for the Windows ngspice DLL, 6 Nov 2026).

Stages, each run and reported separately:
  1. load     PySpice loads libngspice / ngspice.dll (fails the check if not).
  2. init     the equilibrium-start initialisation (_start_price) at the two fixed subsidies 0 and 30, per scenario,
              with default and strict tolerances. Since 6 Nov 2026 this is a DC operating point (.op).
              'init-legacy' repeats the old short transient (.tran 0 0.01 0 0.005) for diagnosis only; it does not
              fail the check.
  3. run      full runs as the site does them (scenario.run), open loop and closed loop, default and strict.
  4. compare  price and year-on-year against ci/reference/*.csv (ngspice 45.2 on the Mac, default tolerances).
              Allowed: |price diff| <= 0.05 index points, |yoy diff| <= 0.05 percentage points (the tolerance used
              against LTspice in tests/test_ngspice.py).

Usage (from the repository root):
  python ci/solver_check.py --out ci_out              # check; exit code 1 if a required stage fails
  python ci/solver_check.py --write-reference         # rewrite ci/reference/*.csv on the reference machine
Environment: HOUSING_ENGINE=ngspice, NGSPICE_LIBRARY_PATH, SPICE_LIB_DIR (Windows), HOUSING_NGSPICE_TIMEOUT
(seconds per ngspice call, default 60). Netlists and logs of failed runs go to <out>/failed_netlists.
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import platform
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import numpy as np  # noqa: E402
from housing import engine, netlist as nl, ngspice as ng, scenario as sc  # noqa: E402
from housing.scenario import Scenario  # noqa: E402

REFERENCE = ROOT / "ci" / "reference"
PRICE_TOL, YOY_TOL = 0.05, 0.05
OPTIONS = {"default": "", "strict": ".options reltol=1e-4"}
INIT = {
    "hinf": Scenario(feedback=True, controller="hinf"),
    "zn": Scenario(feedback=True, controller="zn"),
    "nobank_zn": Scenario(feedback=True, controller="zn", bank=False, rental_subsidy=False),
}
RUNS = {
    "open": Scenario(),
    "open_nobank": Scenario(bank=False),
    "open_nobank_norent": Scenario(bank=False, rental_subsidy=False),
    "hinf": Scenario(feedback=True, controller="hinf"),
    "zn": Scenario(feedback=True, controller="zn"),
    "netlist_pid": Scenario(feedback=True, controller="netlist"),
    "nobank_zn": Scenario(feedback=True, controller="zn", bank=False, rental_subsidy=False),
    "hinf_share": Scenario(feedback=True, controller="hinf", share_control=True),
}
_translate = ng.translate


def use_options(extra: str) -> None:
    """Append ngspice .options to every translated netlist (as tests/test_ngspice.py does)."""
    if not extra:
        ng.translate = _translate
        return
    def strict(lines):
        text, names, tstart = _translate(lines)
        return text.replace("\n.end", "\n" + extra + "\n.end"), names, tstart
    ng.translate = strict


def timed(fn):
    t0 = time.perf_counter()
    try:
        return {"ok": True, "value": fn(), "seconds": round(time.perf_counter() - t0, 3)}
    except Exception as e:  # report every failure, keep going
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:1500], "seconds": round(time.perf_counter() - t0, 3)}


def legacy_start_price(s: Scenario, u: float) -> float:
    lines = sc.build(s.model_copy(update={"feedback": False, "share_control": False}))
    nl.set_constant_subsidy(lines, u)
    nl.set_tran(lines, ".tran 0 0.01 0 0.005")
    return float(engine.simulate(lines)["I(Construction_cost)"][0])


def rows_of(result: dict) -> list[list]:
    year, price, yoy = result["year"], result["series"]["price"], result["series"]["yoy"]
    out = []
    for i, (y, p, g) in enumerate(zip(year, price, yoy)):
        g = "" if g is None or not np.isfinite(g) else f"{g:.6f}"
        out.append([f"{0.6 * i:.4f}", f"{y:.4f}", f"{p:.6f}", g])
    return out


def write_csv(path: Path, rows: list[list]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sim_time_s", "year", "house_price", "year_on_year_pct"])
        w.writerows(rows)


def read_csv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with path.open() as f:
        r = list(csv.DictReader(f))
    price = np.array([float(x["house_price"]) for x in r])
    yoy = np.array([float(x["year_on_year_pct"]) if x["year_on_year_pct"] else np.nan for x in r])
    return price, yoy


def compare(rows: list[list], ref: Path) -> dict:
    if not ref.exists():
        return {"ok": False, "error": f"no reference {ref.name}"}
    p_ref, g_ref = read_csv(ref)
    p = np.array([float(r[2]) for r in rows])
    g = np.array([float(r[3]) if r[3] else np.nan for r in rows])
    if p.size != p_ref.size:
        return {"ok": False, "error": f"{p.size} points, reference has {p_ref.size}"}
    both = np.isfinite(g) & np.isfinite(g_ref)
    dp, dg = float(np.max(np.abs(p - p_ref))), float(np.max(np.abs(g[both] - g_ref[both])))
    return {"ok": dp <= PRICE_TOL and dg <= YOY_TOL, "max_price_diff": round(dp, 6), "max_yoy_diff_pt": round(dg, 6)}


def environment() -> dict:
    info = {"platform": platform.platform(), "machine": platform.machine(), "python": sys.version.split()[0],
            "engine": engine.name()}
    for k in ("HOUSING_ENGINE", "NGSPICE_LIBRARY_PATH", "SPICE_LIB_DIR", "HOUSING_NGSPICE_TIMEOUT"):
        info[k] = os.environ.get(k)
    try:
        import PySpice
        info["pyspice"] = PySpice.__version__
    except Exception as e:
        info["pyspice"] = f"not importable: {e}"
    return info


def ngspice_version() -> str:
    g = ng._shared()
    g.clear_output()
    g._ngspice_shared.ngSpice_Command(b"version -f")
    text = " ".join(l.strip() for l in g._stdout if l.strip())
    return text[:400]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ci_out")
    ap.add_argument("--write-reference", action="store_true")
    ap.add_argument("--legacy-timeout", type=float, default=20.0, help="seconds per legacy transient init run")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HOUSING_NGSPICE_DUMP", str(out / "failed_netlists"))
    report = {"environment": environment(), "stages": {}}
    required_ok = True

    # 1. load
    load = timed(lambda: ng.available() and ngspice_version())
    if not (load["ok"] and load["value"]):
        load = {**load, "ok": False, "error": load.get("error", "ngspice.available() is False")}
        try:
            ng._shared()
        except Exception:
            load["error"] += "\n" + traceback.format_exc()[-1500:]
    report["stages"]["load"] = load
    print("load", "OK" if load["ok"] else "FAIL", load.get("value") or load.get("error"), flush=True)
    if not load["ok"] or engine.name() != "ngspice":
        report["stages"]["load"]["ok"] = False
        report["stages"]["load"].setdefault("error", f"engine is {engine.name()}, not ngspice")
        (out / "results.json").write_text(json.dumps(report, indent=2))
        return 1

    if a.write_reference:
        use_options("")
        for name, s in RUNS.items():
            write_csv(REFERENCE / f"{name}.csv", rows_of(sc.run(s)))
            print("reference", name, flush=True)
        return 0

    # 2. init
    init, legacy = [], []
    for opt, extra in OPTIONS.items():
        use_options(extra)
        for name, s in INIT.items():
            for u in (0.0, 30.0):
                r = timed(lambda: sc._start_price(s, u))
                init.append({"scenario": name, "options": opt, "u": u, **r})
                required_ok &= r["ok"]
                print(f"init        {opt:8s} {name:10s} u={u:4.0f}", "OK " if r["ok"] else "FAIL", r.get("value", r.get("error")), f"{r['seconds']} s", flush=True)
        saved = os.environ.get("HOUSING_NGSPICE_TIMEOUT")
        os.environ["HOUSING_NGSPICE_TIMEOUT"] = str(a.legacy_timeout)
        for lname, u in (("hinf", 0.0), ("hinf", 30.0), ("nobank_zn", 30.0)):
            r = timed(lambda: legacy_start_price(INIT[lname], u))
            legacy.append({"scenario": lname, "options": opt, "u": u, **r})
            print(f"init-legacy {opt:8s} {lname:10s} u={u:4.0f}", "OK " if r["ok"] else "fail (info)", r.get("value", r.get("error")), f"{r['seconds']} s", flush=True)
        if saved is None:
            os.environ.pop("HOUSING_NGSPICE_TIMEOUT")
        else:
            os.environ["HOUSING_NGSPICE_TIMEOUT"] = saved
    report["stages"]["init"] = init
    report["stages"]["init_legacy_transient (information only)"] = legacy

    # 3. runs and 4. comparison
    runs = []
    for opt, extra in OPTIONS.items():
        use_options(extra)
        for name, s in RUNS.items():
            r = timed(lambda: sc.run(s))
            row = {"scenario": name, "options": opt, "ok": r["ok"], "seconds": r["seconds"]}
            if r["ok"]:
                rows = rows_of(r["value"])
                write_csv(out / "csv" / f"{name}_{opt}.csv", rows)
                row["compare"] = compare(rows, REFERENCE / f"{name}.csv")
                row["ok"] = row["compare"]["ok"]
                if r["value"].get("equilibrium"):
                    row["u_start"] = r["value"]["equilibrium"]["u_start"]
            else:
                row["error"] = r["error"]
            required_ok &= row["ok"]
            runs.append(row)
            print(f"run         {opt:8s} {name:12s}", "OK  " if row["ok"] else "FAIL", row.get("compare", row.get("error")), f"{row['seconds']} s", flush=True)
    report["stages"]["runs"] = runs
    report["tolerance"] = {"price_index_points": PRICE_TOL, "yoy_percentage_points": YOY_TOL}
    report["passed"] = bool(required_ok)
    (out / "results.json").write_text(json.dumps(report, indent=2, default=float))

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        lines = ["## Solver check", "", f"`{report['environment']['platform']}`, Python {report['environment']['python']}, {load['value']}", "",
                 "| stage | options | scenario | result | max price diff | max yoy diff (pt) | s |", "|---|---|---|---|---|---|---|"]
        for r in init:
            lines.append(f"| init (.op) | {r['options']} | {r['scenario']} u={r['u']:g} | {'OK' if r['ok'] else 'FAIL'} | | | {r['seconds']} |")
        for r in legacy:
            lines.append(f"| init legacy .tran (info) | {r['options']} | {r['scenario']} u={r['u']:g} | {'OK' if r['ok'] else 'fail'} | | | {r['seconds']} |")
        for r in runs:
            c = r.get("compare", {})
            lines.append(f"| run | {r['options']} | {r['scenario']} | {'OK' if r['ok'] else 'FAIL'} | {c.get('max_price_diff', '')} | {c.get('max_yoy_diff_pt', '')} | {r['seconds']} |")
        lines += ["", f"Allowed: price {PRICE_TOL} index points, year-on-year {YOY_TOL} points. Overall: **{'PASS' if required_ok else 'FAIL'}**"]
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    print("PASS" if required_ok else "FAIL", flush=True)
    return 0 if required_ok else 1


if __name__ == "__main__":
    sys.exit(main())

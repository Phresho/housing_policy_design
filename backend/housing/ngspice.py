"""ngspice engine: translates the LTspice netlist that scenario.build() writes into ngspice syntax and runs it
through PySpice's shared-library interface (libngspice), so the site does not need LTspice.

The translation keeps every element, node and value. Only LTspice-specific syntax is rewritten:
- names:   L§Rent -> L_Rent (LTspice refers to it as I(Rent); so does this module's output)
- idt(x[, ic])     -> x as a current into 1 F, start value by .ic (the XSPICE int block stalled ngspice here)
- ddt(x)           -> x as a current through 1 H, whose voltage is dx/dt (1 kOhm across it: 1 ms filter)
- delay(x, T)      -> ideal transmission line with delay T, driven by x and terminated in Z0 (no reflection)
- if(time<=0, h, x) (equilibrium hold) -> h blended into x over 1 ms; other if(c, a, b) -> (c) ? (a) : (b)
- PULSE with one zero edge -> that edge = 10% of the on-time, as LTspice does (measured); both zero -> 1 us
- x**p of a signal -> max(x, 1e-6)**p (ngspice ramps sources from 0 to find the operating point)
- floating parts of the circuit (no path to ground) -> one 1 GOhm resistor to ground each
- limit(x, a, b)   -> min(max(x, a), b)
- Rser=r on L/C    -> separate series resistor
- every inductor   -> plus 100 kOhm in parallel (RPAR_L). Node N019 is fed only by inductors (L10 in, the rent
  and owner-occupied branches out); trapezoidal integration then rings +-3700 V from the first step without
  decaying, and stricter builds (e.g. the Windows DLL) stop with "timestep too small". LTspice damps this itself.
  Effect on the price: 0.0001 (tolerance against LTspice is 0.05); time constant L/R <= 1e-4 s. Values tested on 6 Nov 2026
  (6 scenarios x default / reltol=1e-4 / trtol=1): 1 kOhm stopped no-bank runs near t = 178, 10 kOhm stopped
  no-bank with trtol=1; 100 kOhm (with 1 kOhm on ddt) passes all but H-inf/ZN with trtol=1. Gear was worse.
- I(element) in expressions and in the output -> current through a 0 V sense source in series with the element
- current sources that carry only a signal (both nodes 0, both the same, or a floating NC_ pair) -> a B voltage
  source on its own node, so ngspice sees no floating current source; I(name) then reads that node voltage.
The output uses LTspice's trace names ("I(Construction_cost)", "V(n007)", time from the .tran start), so the rest
of the backend does not change. Validated against LTspice in tests/test_ngspice.py.
"""
from __future__ import annotations
import os
import re
import threading
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
_LOCAL_LIB = ROOT / "tools" / "ngspice" / "lib" / "libngspice.dylib"
RPAR_L = 1e5  # resistor across every inductor of the netlist, see the module docstring
RPAR_DDT = 1e3  # resistor across the inductor that builds ddt(): 1 ms filter
TMAX = 0.05  # max time step for ngspice (LTspice averaged 0.047 s on the full run)
_lock = threading.Lock()
_ng = None


# ------------------------------------------------------------------ expression rewriting
def _split_args(s: str, start: int) -> tuple[list[str], int]:
    """Arguments of the call whose '(' is at s[start]; returns (args, index after ')')."""
    depth, args, cur, i = 0, [], [], start
    while i < len(s):
        ch = s[i]
        if ch == "(":
            depth += 1
            if depth > 1:
                cur.append(ch)
        elif ch == ")":
            depth -= 1
            if depth == 0:
                args.append("".join(cur).strip())
                return args, i + 1
            cur.append(ch)
        elif ch == "," and depth == 1:
            args.append("".join(cur).strip()); cur = []
        else:
            cur.append(ch)
        i += 1
    raise ValueError(f"Unbalanced parentheses in {s!r}")


def _rewrite_calls(expr: str, name: str, fn) -> str:
    """Replace every call name(args) (case-insensitive, innermost first) by fn(args)."""
    pat = re.compile(rf"(?<![A-Za-z0-9_]){name}\s*\(", re.I)
    while True:
        hits = list(pat.finditer(expr))
        if not hits:
            return expr
        m = hits[-1]  # the last one has no un-rewritten call of this name inside it
        args, end = _split_args(expr, m.end() - 1)
        expr = expr[:m.start()] + fn(args) + expr[end:]


class _Translator:
    def __init__(self):
        self.extra: list[str] = []
        self.n = 0
        self.signal: dict[str, str] = {}    # ref name (lower) -> node carrying its value as a voltage
        self.sensed: dict[str, str] = {}    # ref name (lower) -> sense source name
        self.vsrc: dict[str, str] = {}      # ref name (lower) -> ngspice V source name (its own branch current)
        self.ics: list[str] = []

    def new(self, kind: str) -> str:
        self.n += 1
        return f"x{kind}{self.n}"

    def current_ref(self, ref: str) -> str:
        key = ref.lower()
        if key in self.signal:
            return f"v({self.signal[key]})"
        if key in self.vsrc:
            return f"i({self.vsrc[key]})"
        if key in self.sensed:
            return f"i({self.sensed[key]})"
        raise KeyError(f"I({ref}) refers to an unknown element")

    def expr(self, e: str) -> str:
        e = e.strip()
        e = re.sub(r"(?<![A-Za-z0-9_])[Ii]\(([^()]+)\)", lambda m: self.current_ref(m.group(1).strip()), e)
        # x**p of a simulated signal: ngspice ramps every source from 0 to find the operating point, and at x = 0 the
        # slope of x**0.6 is infinite, so the solve fails. A floor at 1e-6 changes nothing for positive x.
        e = re.sub(r"((?:i|v)\([^()]+\))\s*\*\*", r"max(\1,1e-6)**", e)
        e = _rewrite_calls(e, "limit", lambda a: f"min(max({a[0]},{a[1]}),{a[2]})")
        e = _rewrite_calls(e, "if", self._if)
        e = _rewrite_calls(e, "idt", self._idt)
        e = _rewrite_calls(e, "delay", self._delay)
        e = _rewrite_calls(e, "ddt", self._ddt)
        return e

    @staticmethod
    def _if(a: list[str]) -> str:
        # if(time<=0, hold, x): the equilibrium start holds the PID at u_ss during the operating point. An instant
        # switch at t = 0+ stalls ngspice's first step with high gains (ZN), so blend over 1 ms (0.0002 yr, inside the
        # hidden first year). At t = 0 the value is exactly the held one, so the operating point is the same.
        if re.fullmatch(r"\s*time\s*<=\s*0\s*", a[0]):
            return f"(({a[1]})+min(time/1e-3,1)*(({a[2]})-({a[1]})))"
        return f"(({a[0]}) ? ({a[1]}) : ({a[2]}))"

    def _idt(self, a: list[str]) -> str:
        # Classic SPICE integrator: the input as a current into 1 F, start value by .ic (held during the operating
        # point, released for the transient). The XSPICE int block made ngspice's first time step fail here.
        k = self.new("int"); ic = a[1] if len(a) > 1 else "0"
        self.extra += [f"B{k}in 0 {k} I={a[0]}", f"C{k} {k} 0 1", f"R{k} {k} 0 1e15"]
        self.ics.append(f"v({k})={float(ic):.12g}")
        return f"v({k})"

    def _ddt(self, a: list[str]) -> str:
        # x as a current through 1 H: the voltage is exactly dx/dt (0 at the operating point, as ddt). ngspice's own
        # ddt() in a B source made Gear fail on the netlist PID. The parallel RPAR_DDT stops trapezoidal ringing (an
        # inductor driven only by a current source); it adds a first-order filter of L/R = 1 ms = 0.0002 yr
        # (100 kOhm was too weak here with strict tolerances).
        k = self.new("dt")
        self.extra += [f"B{k}in 0 {k} I={a[0]}", f"L{k} {k} 0 1", f"R{k}par {k} 0 {RPAR_DDT:g}"]
        return f"v({k})"

    def _delay(self, a: list[str]) -> str:
        k = self.new("dl")
        self.extra += [f"B{k}in {k}in 0 V={a[0]}", f"T{k} {k}in 0 {k} 0 Z0=1 TD={a[1]}", f"R{k} {k} 0 1"]
        return f"v({k})"


def _ltspice_pulse(rest: str) -> str:
    """LTspice's PULSE with a zero edge: if only one of rise/fall is 0, LTspice uses 10% of the on-time for it
    (measured: Covid shock rises over 1.5 s with Ton = 15, I8 over 3 s with Ton = 30); if both are 0 it switches at
    once. ngspice would use its print step instead, so write the edges out."""
    m = re.search(r"PULSE\(([^)]*)\)", rest, re.I)
    if not m:
        return rest
    a = m.group(1).split()
    if len(a) >= 6:
        tr, tf, ton = float(a[3]), float(a[4]), float(a[5])
        if tr == 0 and tf == 0:
            tr = tf = 1e-6
        elif tr == 0:
            tr = 0.1 * ton if ton > 0 else 1e-6
        elif tf == 0:
            tf = 0.1 * ton if ton > 0 else 1e-6
        a[3], a[4] = f"{tr:.6g}", f"{tf:.6g}"
    return rest[:m.start()] + "PULSE(" + " ".join(a) + ")" + rest[m.end():]


def _ref(token: str) -> tuple[str, str]:
    """(ngspice name, LTspice reference name) of an element token."""
    if "§" in token:
        kind, name = token.split("§", 1)
        return f"{kind}_{name}", name
    return token, token


def _floating(node: str) -> bool:
    return node.lower().startswith("nc_")


def _tran(rows: list[str]) -> tuple[str, float]:
    """ngspice .tran from the netlist's '.tran tstep tstop [tstart [tmax]]', and its tstart."""
    row = next(r for r in rows if r.lower().startswith(".tran"))
    v = [float(x) for x in row.split()[1:]]
    tstep, tstop = v[0], v[1]
    tstart = v[2] if len(v) > 2 else 0.0
    tmax = min(v[3] if len(v) > 3 else TMAX, TMAX, (tstop - tstart) / 50)
    tstep = tstep if tstep > 0 else tmax
    return f".tran {tstep:.6g} {tstop:.6g} {tstart:.6g} {tmax:.6g}", tstart


def translate(lines: list[str]) -> tuple[str, dict[str, str], float]:
    """ngspice netlist text, {LTspice trace name: ngspice vector} and the .tran start time."""
    rows = [l.rstrip("\r") for l in lines if l.strip() and not l.lstrip().startswith("*")]
    T = _Translator()
    elems, out = [], []
    degree: dict[str, int] = {}
    for l in rows:
        tok = l.split()
        if l.startswith(".") or tok[0][0].upper() == "K":
            continue
        for node in tok[1:3]:
            degree[node.lower()] = degree.get(node.lower(), 0) + 1
    # Pass 1: classify, so references resolve regardless of order.
    for l in rows:
        if l.startswith("."):
            continue
        tok = l.split()
        kind = tok[0][0].upper()
        if kind == "K":
            elems.append(("K", tok)); continue
        name, ref = _ref(tok[0]); n1, n2 = tok[1], tok[2]
        is_source = kind in "IB" and (kind == "I" or re.search(r"\bI\s*=", l))
        dangling = lambda n: n != "0" and degree.get(n.lower(), 0) < 2
        signal = is_source and (n1 == n2 or (n1 == "0" and n2 == "0") or _floating(n1) or _floating(n2) or dangling(n1) or dangling(n2))
        if not is_source and (_floating(n1) and _floating(n2) or n1 == n2):
            # e.g. B7 NC_06 NC_07 V=...: a voltage across two unconnected nodes, nothing flows; LTspice reads 0.
            elems.append(("drop", ref)); continue
        if signal:
            T.signal[ref.lower()] = f"s_{ref.lower()}"
        elif kind == "V":
            T.vsrc[ref.lower()] = name
        else:
            T.sensed[ref.lower()] = f"vs_{ref.lower()}"
        elems.append((kind, tok, name, ref, signal, l))
    # Pass 2: write.
    names = {}
    for item in elems:
        if item[0] == "drop":
            names[f"I({item[1][0].upper()}{item[1][1:].lower()})"] = "zero"
            continue
        if item[0] == "K":
            tok = item[1]
            out.append(f"K_{tok[0][1:] or 'k'} L_{tok[1]} L_{tok[2]} {tok[3]}" if "§" not in tok[1] else " ".join(tok))
            continue
        kind, tok, name, ref, signal, l = item
        n1, n2, rest = tok[1], tok[2], l.split(None, 3)[3] if len(l.split(None, 3)) > 3 else ""
        trace = f"I({ref[0].upper()}{ref[1:].lower()})"
        if signal:
            node = T.signal[ref.lower()]
            if kind == "B":
                expr = re.split(r"\bI\s*=", rest, maxsplit=1)[1]
                out.append(f"B_s_{ref.lower()} {node} 0 V={T.expr(expr)}")
            else:  # independent current source: same waveform as a voltage
                out.append(f"V_s_{ref.lower()} {node} 0 {_ltspice_pulse(rest)}")
            out.append(f"R_s_{ref.lower()} {node} 0 1e12")
            names[trace] = f"v({node})"
            continue
        if kind == "V":
            out.append(f"{name} {n1} {n2} {_ltspice_pulse(rest)}")
            names[trace] = f"i({name})"
            continue
        sense, mid = T.sensed[ref.lower()], f"{ref.lower()}_s"
        ser = re.search(r"\s+Rser=(\S+)", rest, re.I)
        rest = re.sub(r"\s+Rser=\S+", "", rest, flags=re.I)
        if kind == "B":
            m = re.match(r"\s*([IV])\s*=\s*(.*)$", rest, re.S)
            body = f"{m.group(1)}={T.expr(m.group(2))}"
        else:
            body = _ltspice_pulse(rest) if kind == "I" else rest
        if ser:
            out.append(f"{name} {n1} {mid}r {body}"); out.append(f"R_{ref}_ser {mid}r {mid} {ser.group(1)}")
        else:
            out.append(f"{name} {n1} {mid} {body}")
        out.append(f"{sense} {mid} {n2} 0")
        if kind == "L":
            out.append(f"R_{ref}_par {n1} {mid} {RPAR_L:g}")
        names[trace] = f"i({sense})"
    out += _ground_floating_parts(out + T.extra)
    tran, tstart = _tran(rows)
    head = ["* housing model, translated from the LTspice netlist by housing/ngspice.py"]
    ics = [".ic " + " ".join(T.ics)] if T.ics else []
    # Trapezoidal integration. The netlist asks for Gear, but with Gear ngspice's first time step stalls on this
    # circuit when the .ic integrators are present (depends on the run length). With the LTspice pulse edges (above)
    # trapezoidal gives the same results as LTspice's Gear (tests/test_ngspice.py).
    text = "\n".join(head + out + T.extra + ics + [tran, ".options method=trap", ".end"])
    # PySpice treats any output line containing "error" as a failed run, and ngspice prints vector names
    # (the signal Error -> node s_error). Rename those identifiers.
    text = re.sub("error", "gap_", text, flags=re.I)
    names = {k: re.sub("error", "gap_", v, flags=re.I) for k, v in names.items()}
    return text, names, tstart


def _ground_floating_parts(rows: list[str]) -> list[str]:
    """One 1 GOhm resistor to ground per connected part without a path to ground (LTspice tolerates those; ngspice
    finds the matrix singular). A single connection carries no current, so no result changes."""
    parent: dict[str, str] = {}
    def find(a):
        parent.setdefault(a, a)
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for r in rows:
        tok = r.split()
        if not tok or tok[0][0] in ".*K" or tok[0][0].upper() == "K":
            continue
        nodes = tok[1:5] if tok[0][0].upper() == "T" else tok[1:3]
        if tok[0][0].upper() == "A":
            nodes = tok[1:3]
        nodes = [n.lower() for n in nodes]
        for n in nodes[1:]:
            parent[find(nodes[0])] = find(n)
    roots = {find(n) for n in list(parent)}
    ground = find("0")
    return [f"R_gnd_{i} {root} 0 1e9" for i, root in enumerate(sorted(roots - {ground}))]


# ------------------------------------------------------------------ running
def _shared():
    global _ng
    if _ng is None:
        if "NGSPICE_LIBRARY_PATH" not in os.environ and _LOCAL_LIB.exists():
            os.environ["NGSPICE_LIBRARY_PATH"] = str(_LOCAL_LIB)
        import logging
        logging.getLogger("PySpice").setLevel(logging.CRITICAL)  # "Unsupported Ngspice version": 1.5 works with 45
        from PySpice.Spice.NgSpice.Shared import NgSpiceShared
        _ng = NgSpiceShared.new_instance()
    return _ng


def available() -> bool:
    """True when PySpice and a libngspice can be loaded."""
    try:
        _shared(); return True
    except Exception:
        return False


def run_lines(lines: list[str]) -> dict[str, np.ndarray]:
    """Run the netlist in ngspice; return traces under LTspice's names, time measured from the .tran start
    (as in LTspice's .raw for this netlist)."""
    text, names, tstart = translate(lines)
    tstop = float(next(r for r in text.splitlines() if r.startswith(".tran")).split()[2])
    with _lock:
        ng = _shared()
        api = ng._ngspice_shared
        # PySpice flags a run as failed for any stderr line not starting with "Warning:" (also ngspice's harmless
        # "Note: ..." lines). Call the API directly and check that the run reached its end time instead.
        ng.clear_output()
        ng.load_circuit(text)
        api.ngSpice_Command(b"run")
        vec = {}
        try:
            plot = ng.plot(simulation=None, plot_name=ng.last_plot)
            vec = {k.lower(): np.asarray(v._data, dtype=float) for k, v in plot.items()}
        except Exception:
            pass
        log = [l for l in ng._stderr if "Note:" not in l][-6:]
        api.ngSpice_Command(b"destroy all")
        api.ngSpice_Command(b"remcirc")
    if "time" not in vec or vec["time"].size == 0 or vec["time"][-1] < tstop - 1e-6:
        raise RuntimeError("ngspice did not finish the run: " + " | ".join(log))
    t = vec["time"]
    traces = {"time": t - tstart}
    for trace, v in names.items():
        if v == "zero":
            traces[trace] = np.zeros_like(t); continue
        key = v.lower()
        if key.startswith("i(") and key not in vec:
            key = key[2:-1] + "#branch"
        if key.startswith("v(") and key not in vec:
            key = key[2:-1]
        traces[trace] = vec[key]
    for k, v in vec.items():
        if k != "time" and "#" not in k and not k.startswith(("x", "s_")) and not k.endswith(("_s", "_sr")):
            traces[f"V({k})"] = v
    return traces

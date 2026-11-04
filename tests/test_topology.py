import sys
from collections import Counter
from pathlib import Path
import numpy as np
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from housing import ltspice, netlist as nl
from housing.scenario import Scenario, build, run
from housing.topology import AGENTS, CONTROLLER_LAYOUT, DISTURBANCES, FLOWS, LAYOUTS, NOT_IN_CIRCUIT, OUTPUTS, model_map


@pytest.fixture(scope="module", params=[False, True], ids=["open", "closed"])
def traces(request, tmp_path_factory):
    path = tmp_path_factory.mktemp("t") / "m.net"
    nl.write_netlist(build(Scenario(feedback=request.param)), path)
    return ltspice.run(path)


def _drawn_nets(agent):
    """Group an agent's drawn pins, ports and grounds by wire connection."""
    layout, parent = LAYOUTS[agent], {}

    def find(n):
        parent.setdefault(n, n)
        while parent[n] != n:
            parent[n] = parent[parent[n]]
            n = parent[n]
        return n
    wires = layout["wires"] + layout.get("return_wires", []) + layout.get("common_returns", [])
    points = {(w[0], w[1]) for w in wires} | {(w[2], w[3]) for w in wires}
    points |= {tuple(p) for pins in layout["elements"].values() for p in pins}
    points |= {tuple(p) for p in layout["ports"].values()} | {tuple(p) for p in layout.get("returns", {}).values()} | {tuple(g) for g in layout["grounds"]}
    for x0, y0, x1, y1 in wires:
        assert x0 == x1 or y0 == y1, f"{agent}: wire is not straight"
        parent[find((x0, y0))] = find((x1, y1))
        for q in points:
            if (x0 == x1 == q[0] and min(y0, y1) <= q[1] <= max(y0, y1)) or (y0 == y1 == q[1] and min(x0, x1) <= q[0] <= max(x0, x1)):
                parent[find(q)] = find((x0, y0))
    return find


NODES = {e["name"]: (e["a"], e["b"]) for e in model_map()["elements"]}


@pytest.mark.parametrize("agent", list(LAYOUTS))
def test_drawing_matches_the_netlist_node_by_node(agent):
    layout, find = LAYOUTS[agent], _drawn_nets(agent)
    net_of = {}
    for name, pins in layout["elements"].items():
        for pin, node in zip(pins, NODES[name]):
            net_of.setdefault(find(tuple(pin)), set()).add(node)
    for ground in layout["grounds"]:
        net_of.setdefault(find(tuple(ground)), set()).add("0")
    flows = {f["id"]: f for f in FLOWS}
    for flow_id, pos in layout["ports"].items():
        net_of.setdefault(find(tuple(pos)), set()).add(flows[flow_id]["port"]["node"])
    for flow_id, pos in layout.get("returns", {}).items():
        net_of.setdefault(find(tuple(pos)), set()).add(flows[flow_id]["port"]["ret"])
    for x0, y0, x1, y1 in layout.get("return_wires", []):
        net_of.setdefault(find((x0, y0)), set())
    for net, nodes in net_of.items():
        assert len(nodes) == 1, f"{agent}: one drawn net joins different netlist nodes {nodes}"
    seen = [next(iter(n)) for n in net_of.values()]
    repeated = [n for n, c in Counter(seen).items() if c > 1 and n != "0"]
    assert not repeated, f"{agent}: netlist node drawn in separate pieces {repeated}"


def _circuit_of():
    """Circuits: parts of the netlist that are connected without going through ground."""
    parent = {}

    def find(n):
        parent.setdefault(n, n)
        while parent[n] != n:
            n = parent[n]
        return n
    for e in model_map()["elements"]:
        if e["a"] != e["b"] and e["state"] != "unused" and "0" not in (e["a"], e["b"]):
            parent[find(e["a"])] = find(e["b"])
    return find


@pytest.mark.parametrize("agent", list(LAYOUTS))
def test_returns_of_one_circuit_are_joined_inside_the_agent(agent):
    layout, find, circuit = LAYOUTS[agent], _drawn_nets(agent), _circuit_of()
    pieces: dict[str, set] = {}
    for name, pins in layout["elements"].items():
        for pin, node in zip(pins, NODES[name]):
            other = [n for n in NODES[name] if n != "0"]
            if node == "0" and other:
                pieces.setdefault(circuit(other[0]), set()).add(find(tuple(pin)))
    flows = {f["id"]: f for f in FLOWS}
    for flow_id, pos in layout["returns"].items():
        if flows[flow_id]["port"]["ret"] == "0":
            pieces.setdefault(circuit(flows[flow_id]["port"]["node"]), set()).add(find(tuple(pos)))
    split = {c: len(p) for c, p in pieces.items() if len(p) > 1}
    assert not split, f"{agent}: returns of one circuit drawn in separate pieces {split}"


def test_every_element_has_one_place():
    drawn = Counter(n for l in LAYOUTS.values() for n in l["elements"])
    assert all(c == 1 for c in drawn.values())
    known = set(drawn) | set(CONTROLLER_LAYOUT["elements"]) | set(CONTROLLER_LAYOUT["not_drawn"]) | set(NOT_IN_CIRCUIT) | {n for l in LAYOUTS.values() for n in l["not_drawn"]} | {o["element"] for o in OUTPUTS}
    missing = [e["name"] for e in model_map()["elements"] if e["name"] not in known]
    assert not missing


def test_not_drawn_elements_really_are_outside_the_circuit():
    state = {e["name"]: e["state"] for e in model_map()["elements"]}
    for name in [n for l in LAYOUTS.values() for n in l["not_drawn"]] + NOT_IN_CIRCUIT:
        assert state[name] != "active", name


def test_agents_only_touch_through_declared_ports():
    touch = {}
    for agent, layout in LAYOUTS.items():
        for name in layout["elements"]:
            for node in NODES[name]:
                if node != "0":
                    touch.setdefault(node, set()).add(agent)
    declared = {}
    for flow in FLOWS:
        if flow["port"]:
            for node in (flow["port"]["node"], flow["port"]["ret"]):
                if node != "0":
                    declared.setdefault(node, set()).update({flow["source"], flow["target"]})
    shared = {n: a for n, a in touch.items() if len(a) > 1}
    assert shared == declared


def test_every_port_continues_inside_as_a_pair():
    for agent, layout in LAYOUTS.items():
        assert set(layout["returns"]) == set(layout["ports"]), agent
        for flow_id, (x, y) in layout["ports"].items():
            rx, ry = layout["returns"][flow_id]
            assert abs(rx - x) + abs(ry - y) == 24, (agent, flow_id)
            on_return = any((w[0], w[1]) == (rx, ry) or (w[2], w[3]) == (rx, ry) for w in layout["return_wires"])
            assert on_return, f"{agent}: return rail of {flow_id} does not continue inside"


def test_both_agents_of_a_flow_draw_its_port():
    for flow in FLOWS:
        if flow["port"]:
            assert flow["id"] in LAYOUTS[flow["source"]]["ports"], flow["id"]
            assert flow["id"] in LAYOUTS[flow["target"]]["ports"], flow["id"]


def test_subsidy_sources_are_inside_households():
    elements = {e["name"]: e for e in model_map()["elements"]}
    assert elements["I§Owner_occupied_subsidies"]["agent"] == elements["B§PID"]["agent"] == elements["I§Rental_subsidies1"]["agent"] == "households"
    assert "government" not in AGENTS and all(f["source"] != "government" for f in FLOWS)


def test_element_states_match_what_the_netlist_shows():
    state = {e["name"]: e["state"] for e in model_map()["elements"]}
    for name in ("L§Rent", "R13", "I8", "B4"):
        assert state[name] == "active", name
    for name in ("I4", "I§Mortgagesold", "B§Salary", "I3", "I2"):
        assert state[name] == "unused", name
    assert state["I1"] == "signal"  # unconnected, but B5 reads it
    assert state["B§Construction"] == state["L4"] == "signal"  # own loop, read by B§Housing_services
    assert state["I5"] == "unused"  # only read by B7, which is itself unconnected
    assert state["B§Error"] == "readout" and state["B§Year_on_year_change1"] == "readout"


def test_flows_reference_real_elements_agents_and_traces(traces):
    names = {e["name"] for e in model_map()["elements"]}
    for flow in FLOWS:
        assert flow["source"] in AGENTS or flow["source"] == "controller"
        assert flow["target"] in AGENTS
        assert set(flow["chain"]) <= names, flow["id"]
        assert flow["signal"] == "owner_subsidy" or flow["signal"] in traces, flow["id"]
    assert Counter(f["id"] for f in FLOWS).most_common(1)[0][1] == 1


def test_flows_run_in_the_drawn_direction(traces):
    for flow in FLOWS:
        if flow["signal"] != "owner_subsidy" and flow["id"] != "mortgages":
            assert traces[flow["signal"]].mean() > 0, flow["id"]


def test_money_balances_at_every_junction(traces):
    i = lambda n: traces[f"I({n})"]
    closed = traces["I(Pid)"].min() != traces["I(Pid)"].max()
    owner = i("Pid") if closed else i("Owner_occupied_subsidies")
    balances = {
        "household budget": i("Income") + i("L15") - i("R12") - i("R4") - i("R5") - i("L8") - i("C6"),
        "investor hub": i("Gross_rent") + i("Gross_imputed_rent") + i("Mortgages") - i("Mortgage_interest") - i("L1") - i("R13") - i("C4"),
        "rent and rental subsidy": i("Rent") + i("Rental_subsidies1") - i("R3"),
        "imputed rent and owner subsidy": i("Imputed_rent") + owner - i("R6"),
        "housing services split": i("L10") - i("Supply_rent") - i("Supply_owner_occupied"),
    }
    for name, gap in balances.items():
        assert np.abs(gap).max() < 0.3, name  # LTspice's reltol 1e-3 on flows up to about 170


def test_disturbance_signals_can_be_read(traces):
    for d in DISTURBANCES:
        if d["signal"].startswith("V("):
            for node in d["signal"][2:-1].split(","):
                assert node == "0" or f"V({node})" in traces, d["id"]
        else:
            assert d["signal"] in traces, d["id"]


def test_port_incentives_and_outputs_can_be_read(traces):
    for flow in FLOWS:
        if flow["port"]:
            assert f"V({flow['port']['node'].lower()})" in traces, flow["id"]
    for output in OUTPUTS:
        assert output["signal"] == "yoy" or output["signal"] in traces, output["id"]


def test_run_returns_traces_for_the_map():
    r = run(Scenario())
    assert len(r["traces"]["I(Rent)"]) == len(r["year"])
    assert "V(n007)" in r["traces"]

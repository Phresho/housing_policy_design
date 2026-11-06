# Housing Policy Lab

Web front end and API for the 19 Oct 2026 LTspice housing market model. Structure follows the DynaBI app by a fellow student (used with permission).

## Run
`./start.sh`, then open http://127.0.0.1:8001. Needs the conda env `housing` and the ngspice shared library (built here in `tools/ngspice`, see Hosting). LTspice is optional: it is the reference solver for the tests, and `HOUSING_ENGINE=ltspice ./start.sh` uses it instead of ngspice.

After front-end edits: `cd frontend && npm run build` with the env's Node on PATH. After Python edits: restart.

## Check
- Backend: `/opt/anaconda3/envs/housing/bin/python -m pytest -q tests`
- Browser: start a server, then `node frontend/e2e/verify.mjs <port>` from `frontend/` (uses installed Chrome)

## How it works
`model/19okt_housing_market.net` is never edited. `backend/housing/netlist.py` changes exact asserted lines per run, `engine.py` picks the solver (`ngspice.py` translates the netlist to ngspice syntax and runs it through PySpice, the default; `ltspice.py` runs LTspice in batch, the reference), `scenario.py` validates inputs and computes results, `server.py` is the API, `frontend/` is React and Plotly.

- Model map (`backend/housing/topology.py`, `frontend/src/ModelMap.tsx`, `Schematic.tsx`): one canvas, as in Quenten's DynaBI app. The control loop follows the slides (reference, controller, housing market, sensor). Clicking + opens a block in place and zooms to it: Housing Market shows the agents, an agent shows its components. Agents connect through port pairs (flow rail and return rail, f and e marks, name along the rails); shocks and subsidies are single signal arrows (d, u). The government is the controller, outside the system; the subsidy sources are drawn inside Households. Circuit drawings are hand-laid in `LAYOUTS`; tests compare every wire with the netlist and require that agents only touch through declared ports.
- Open loop: `I§Owner_occupied_subsidies` drives N031, B§PID disconnected.
- Closed loop: B§PID drives N031. Default netlist preset is identical to the source file.
- Raw time = model time - 6.01 because of `.tran 0.01 180 6.01`.
- Year-on-year is computed from price, because the `delay()` readout jitters by up to about 0.2 points.

## Solver: ngspice instead of LTspice
`backend/housing/ngspice.py` keeps every element, node and value of the netlist and rewrites only LTspice syntax (list at the top of the file). Things that had to be matched to LTspice's behaviour:
- PULSE with one zero edge: LTspice uses 10% of the on-time for that edge (the Covid shock rises over 1.5 s). Without this the 2020 Covid response differed by 1.4 in price.
- `idt()` as a current into 1 F with `.ic`; `delay()` as an ideal transmission line; `ddt()` as a current through 1 H.
- Trapezoidal integration (the netlist asks for Gear; with Gear ngspice's first time step stalls on this circuit).
- 100 kOhm across every inductor, and 1 kOhm across the inductor that builds `ddt()` (a 1 ms filter). Node N019 is fed only by inductors, and the `ddt()` inductor only by a current source; trapezoidal integration rings there from the first step without decaying. The Mac build tolerated it, the Windows ngspice DLL on the VM stopped with "timestep too small" (6 Nov 2026). Effect on the price 0.0001 (1 kOhm and 10 kOhm still failed some runs); `tests/test_ngspice.py::test_runs_with_strict_tolerances` runs with tighter tolerances to catch it.
- The B4 linearisation point (2015, non-linear B4 with gain -10) is stored in `scenario.B4_POINT`, because ngspice cannot run the non-linear B4 with gain -10. A test recomputes it with LTspice.

Validation against LTspice (`tests/test_ngspice.py`, and 150 random slider settings on 5 Nov 2026): price within 0.05 (median 0.016%), year-on-year within 0.05 points, for open loop, H-infinity, ZN, the netlist PID, no bank, the fitted CBS inputs and the rental-share loop. ngspice is 3-5x faster (0.1-0.2 s a run). Unstable gains (for example a large unfiltered D) give chaotic saturated runs, where the two solvers differ after the first instability.

## Hosting (Linux VM)
Not yet tried on the VM. Expected steps:
1. `pip install -r backend/requirements.txt`
2. ngspice shared library: on Windows the ngspice DLL that PySpice can download (`pyspice-post-installation --install-ngspice-dll`), on Linux `sudo apt install libngspice0-dev` (Ubuntu/Debian; the `-dev` package provides `libngspice.so`), or build ngspice with `./configure --with-ngshared`. If PySpice does not find it, set `NGSPICE_LIBRARY_PATH` to the `libngspice.so` file.
3. `cd frontend && npm ci && npm run build`
4. `python backend/run.py --port 8001` behind the VM's web server. `python -m pytest -q tests` should pass there (the LTspice comparisons skip without LTspice).

Developed with ngspice 45.2 and PySpice 1.5 (PySpice warns that 45 is "unsupported"; it works). Ubuntu ships older ngspice versions; the translation uses only basic features, but run the tests there.

## Limits
- Calendar anchor 1996.46 comes from the thesis figure scripts and needs confirmation.
- ZN and H-infinity gains come from the linear design and were not retuned on this nonlinear circuit.

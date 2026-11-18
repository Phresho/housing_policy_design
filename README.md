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
- Error floors `abstol=1e-9`, `chgtol=1e-10` instead of ngspice's chip-sized defaults (1e-12, 1e-14). At the equilibrium start the gap reference - price is round-off noise (~1e-12) and feeds the PID integrators (1 F) and the `ddt()` inductor; against the default floors the time step collapsed at t = 1e-4 s ("timestep too small", or crawling steps that look like a hang). With the floors every check scenario passes at `reltol` 1e-4 and 1e-5 and `trtol` 1; price changes at most 0.0001.
- The equilibrium-start initialisation (`scenario._start_price`, subsidy fixed at 0 and 30, secant search for the subsidy that puts the price on the reference) is a DC operating point (`.op`, `ngspice.operating_point`) instead of a 0.01 s transient: the closed-loop transient starts from exactly that operating point, so no time steps are needed. Integrator start values (`.ic`) are held by voltage sources there. Equal to the old transient value within 2e-8, 4 ms per call.
- Each ngspice run is stopped after `HOUSING_NGSPICE_TIMEOUT` seconds (default 60) with an error instead of blocking. `HOUSING_NGSPICE_DUMP=<folder>` keeps the netlist and log of every failed run.
- The B4 linearisation point (2015, non-linear B4 with gain -10) is stored in `scenario.B4_POINT`, because ngspice cannot run the non-linear B4 with gain -10. A test recomputes it with LTspice.

Validation against LTspice (`tests/test_ngspice.py`, and 150 random slider settings on 5 Nov 2026): price within 0.05 (median 0.016%), year-on-year within 0.05 points, for open loop, H-infinity, ZN, the netlist PID, no bank, the fitted CBS inputs and the rental-share loop. ngspice is 3-5x faster (0.1-0.2 s a run). Unstable gains (for example a large unfiltered D) give chaotic saturated runs, where the two solvers differ after the first instability.

## Windows (tested in GitHub Actions)
`.github/workflows/windows-ngspice.yml` runs on Windows Server 2022 x64 with Python 3.13 and the official ngspice 45.2 DLL. The same steps by hand (PowerShell, repository root):
```
python -m pip install -r backend/requirements.txt
curl.exe -fsSL -o ngspice.7z https://sourceforge.net/projects/ngspice/files/ng-spice-rework/old-releases/45.2/ngspice-45.2_dll_64.7z/download
(Get-FileHash -Algorithm SHA256 ngspice.7z).Hash   # FF110EBB04367EB37FF3C88C75AB3BEA1B2191C11EFCE78F264C2CA73034762B
7z x ngspice.7z -oC:\ngspice                       # gives C:\ngspice\Spice64_dll\...
$env:NGSPICE_LIBRARY_PATH = "C:\ngspice\Spice64_dll\dll-vs\ngspice.dll"
$env:SPICE_LIB_DIR = "C:\ngspice\Spice64_dll\share\ngspice"
$env:HOUSING_ENGINE = "ngspice"
python ci/solver_check.py --out ci_out             # PASS/FAIL per stage; ci_out/results.json, CSVs, failed netlists
python -m pytest -q
```
`ci/solver_check.py` checks, separately: the DLL loads; the initialisation at subsidies 0 and 30 (`.op`, plus the old transient for information); full open- and closed-loop runs with default and strict (`reltol=1e-4`) tolerances; price and year-on-year against `ci/reference/*.csv` (ngspice 45.2 on the Mac). Allowed difference: 0.05 index points in price and 0.05 points in year-on-year, the tolerance used against LTspice. On the Mac all differences are at most 0.0001 (the CSV rounding). Another DLL package: set the repository variables `NGSPICE_DLL_URL` and `NGSPICE_DLL_SHA256`, or start the workflow by hand with those inputs.

## Hosting (Azure VM, live since 8 Nov 2026)
The live site runs branch `main` on the Windows Azure VM, as a Windows service on port 8002 under the path `/housing/` (port 8001 on that VM is DynaBI). Rules:
- `frontend/src/api.ts` keeps a relative API URL (`fetch('api' + path)`), never `'/api'`; new requests go through `api()`.
- The frontend is built with `npm run build -- --base=/housing/`; no hard-coded `/` asset paths (relative paths or `import.meta.env.BASE_URL`).
- The service depends on the backend port, the `run.py` arguments and the environment variables `HOUSING_ENGINE`, `NGSPICE_LIBRARY_PATH`, `SPICE_LIB_DIR`, `HOUSING_DB`, `HOUSING_NGSPICE_TIMEOUT`, `HOUSING_NGSPICE_DUMP`: say so explicitly when any of them changes.
- Before a push to `main`: tests pass locally and the Windows ngspice workflow passes (`ci/solver_check.py` PASS). Never rewrite `ci/reference` to make a check pass.

Update on the VM after a push: `git pull`; if backend code or `backend/requirements.txt` changed, `python -m pip install -r backend/requirements.txt` and `python ci/solver_check.py --out ci_out` (must end with PASS); `cd frontend && npm ci && npm run build -- --base=/housing/`; restart the service. ngspice DLL set-up: see "Windows" above. On Linux the shared library comes from `sudo apt install libngspice0-dev` or `./configure --with-ngshared`; set `NGSPICE_LIBRARY_PATH` if PySpice does not find it.

Local development on the Mac: `./start.sh` serves the site at http://127.0.0.1:8001.

Developed with ngspice 45.2 and PySpice 1.5 (PySpice warns that 45 is "unsupported"; it works). Ubuntu ships older ngspice versions; the translation uses only basic features, but run the tests there.

## Monetary Policy Lab (branch `FrisoMonetary`)
A second, separate app for the macro model with a central bank, banks, households, firms, government and a foreign sector (`model/Model_Bank_20261111_bank_cleaned up.net`, drawn in `Model_Bank_20261111_bank_cleaned up.asc`; the cleaned-up drawing leaves room between the agents for the web map. The older `Model_Bank_20261111_bank.*` differs only in the dividends: `div_leak*I(NII)` there, `div_leak*I(B_NW)/120` here). It shares nothing with the housing app at run time.

### Run (Windows)
First time:
```
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
cd monetary_frontend && npm install && npm run build
```
The ngspice DLL is taken from `tools/ngspice/Spice64_dll/` (git-ignored; same 45.2 package as in "Windows" above) unless `NGSPICE_LIBRARY_PATH` is set. Then `start_monetary.cmd` opens http://127.0.0.1:8010 (`backend/run_monetary.py --port 8010`). `MONETARY_NGSPICE_TIMEOUT` (default 120 s) stops a hanging run.

After front-end edits: `cd monetary_frontend && npm run build`. After Python edits: restart.

### Check
`.venv\Scripts\python -m pytest -q tests/test_monetary.py` and `cd monetary_frontend && npx tsc --noEmit`.

### How it works
- `backend/monetary/netlist.py`: run netlists from the unchanged model file; every option replaces exact, asserted lines (open loop: the rate source `B§R`; closed loop: the policy rule `B_PI`).
- `ngspice.py`: LTspice syntax to ngspice, runs through the shared DLL in a background thread with a timeout; AC analysis and integrator states for the frequency analysis. `ltspice.py` is the reference solver.
- `steady.py`: steady-state start. The forcing `.ic` lines are removed, the operating point settles the fast part and a root finder sets the free integrators so their inputs are zero; stocks (capital, debt, wage index) keep their start values. Without it the netlist's own start makes inflation spike in the first months.
- `scenario.py`: scenario inputs (open-loop rate path, rule gains Kp/Ki/Kd, derivative filter, R*, target, start time), output series and metrics. 120 model time units = 1 year (from the /120 in the interest flows).
- `frequency.py`: plant rate -> inflation from ngspice's AC analysis, linearised at the steady state or a chosen year; loop, margins, Ms, Nyquist, S/T, plant poles by vector fitting, closed-loop poles and linear step response.
- `schematic.py`: parses the `.asc`, rebuilds the nets from the drawing, checks them against the netlist (53 nodes) and gives each element its sector and the links between sectors.
- `flows.py`: flows between sectors. At every node shared by two or more sectors, the current each sector's elements push in (I(x) enters the element's second node) is summed per sector; these sums add up to zero (Kirchhoff, tested). Goods, labour and money nodes are mixed, so the page shows them per node.
- `frequency.sweep`: robustness map over Ki × Kd at the current Kp (Ms, phase margin, linear verdict per cell) from the cached plant and fit, without extra simulations. In closed loop at a later year the plant itself depends on Ki and Kd; the map then keeps the current plant (flagged `approx`).
- `server.py`: FastAPI (`/api/catalogue`, `/api/runs`, `/api/analysis`, `/api/sweep`, `/api/flows`, `/api/model/map`, `/api/trace`), serves `monetary_frontend/dist`.
- `monetary_frontend/`: React + Plotly with four tabs. Circuit map (the start page, `ModelMap.tsx`): layers that unfold in place as in the housing app: the policy loop (central bank → interest rates → economy → CPI values → back, shock), the economy opened into its sectors with the flows and signals between them, and any block opened to its own circuit from the `.asc` drawing (click an element for its equation and trace). Layers 0 and 1 are laid out by hand (`TOP`, `INNER`); layer 2 is the drawing. Wheel/pinch zoom (native non-passive listener), drag, zoom buttons, Fit, breadcrumbs, 'Whole circuit'. Then Simulation (KPI tiles with sparkline and delta, inflation gap with ±1 pt band, rates along the chain, transmission small multiples with a "compare sizes" index mode, balance sheets, run library with compare), Frequency analysis (robustness map, Bode, Nyquist, S/T, poles, step), Sector flows (Sankey per year, node table, node over time) and Model map.

### Charts
Colours live in `monetary_frontend/src/viz.ts` and follow the quantity, not the chart: inflation blue, rates orange, real economy aqua; the four rates are one orange ramp from the policy rate outwards; reference lines (target, Φ) are ink; compared runs grey dashed; red/green only for the stability verdict, always with ✓/✕. The sets were checked with the dataviz skill's `validate_palette.js` (categorical: all pairs, light and dark; ramps: `--ordinal`); re-run it when a colour changes. Light and dark themes follow the OS or the Theme selector. Every chart has Table and CSV; time charts share a crosshair.

## Limits
- Calendar anchor 1996.46 comes from the thesis figure scripts and needs confirmation.
- ZN and H-infinity gains come from the linear design and were not retuned on this nonlinear circuit.

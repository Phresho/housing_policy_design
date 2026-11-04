# Housing Policy Lab

Web front end and API for the 19 Oct 2026 LTspice housing market model. Structure follows the DynaBI app by a fellow student (used with permission).

## Run
`./start.sh`, then open http://127.0.0.1:8001. Needs LTspice for Mac and the conda env `housing`.

After front-end edits: `cd frontend && npm run build` with the env's Node on PATH. After Python edits: restart.

## Check
- Backend: `/opt/anaconda3/envs/housing/bin/python -m pytest -q tests`
- Browser: start a server, then `node frontend/e2e/verify.mjs <port>` from `frontend/` (uses installed Chrome)

## How it works
`model/19okt_housing_market.net` is never edited. `backend/housing/netlist.py` changes exact asserted lines per run, `ltspice.py` runs LTspice in batch, `scenario.py` validates inputs and computes results, `server.py` is the API, `frontend/` is React and Plotly.

- Model map (`backend/housing/topology.py`, `frontend/src/ModelMap.tsx`, `Schematic.tsx`): one canvas, as in Quenten's DynaBI app. The control loop follows the slides (reference, controller, housing market, sensor). Clicking + opens a block in place and zooms to it: Housing Market shows the agents, an agent shows its components. Agents connect through port pairs (flow rail and return rail, f and e marks, name along the rails); shocks and subsidies are single signal arrows (d, u). The government is the controller, outside the system; the subsidy sources are drawn inside Households. Circuit drawings are hand-laid in `LAYOUTS`; tests compare every wire with the netlist and require that agents only touch through declared ports.
- Open loop: `I§Owner_occupied_subsidies` drives N031, B§PID disconnected.
- Closed loop: B§PID drives N031. Default netlist preset is identical to the source file.
- Raw time = model time - 6.01 because of `.tran 0.01 180 6.01`.
- Year-on-year is computed from price, because the `delay()` readout jitters by up to about 0.2 points.

## Limits
- LTspice batch means Mac only, so local use. Hosting needs a Linux solver (ngspice) and a translation validated against LTspice.
- Calendar anchor 1996.46 comes from the thesis figure scripts and needs confirmation.
- ZN and H-infinity gains come from the linear design and were not retuned on this nonlinear circuit.

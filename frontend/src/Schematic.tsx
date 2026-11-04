import type { Element, Flow, MapData, Scenario, Selection } from './types';

export const STATE_NOTE: Record<string, string> = {
  readout: 'Read-out only. It computes a signal and carries no flow in the circuit.',
  signal: 'Separate from the main circuit. Its value is read by another source.',
  unused: 'Not connected in this run, so it has no effect on the results.',
};
export const CHAIN = ['B§Reference', 'B§Error', 'B§PID_P', 'B§PID_D', 'B§PID_I_Robust'];
export function stateOf(e: Element, s: Scenario): string {
  if (e.name === 'I§Owner_occupied_subsidies') return s.feedback ? 'unused' : 'active';
  if (e.name === 'B§PID' || CHAIN.includes(e.name)) return s.feedback ? 'active' : 'unused';
  return e.state;
}
const LABEL_OFFSET: Record<string, [number, number]> = {
  'I§Rental_subsidies1': [-24, 56], 'I§Owner_occupied_subsidies': [-24, 56], 'B§PID': [-24, 56], 'L§Supply_owner_occupied': [-142, 0], 'C3': [-14, 62], 'C2': [-14, 62], 'R20': [-74, 0], 'L§Supply_rent': [-132, 0], 'B§Housing_services': [-30, 205], 'Interest_Rates': [-176, 0], 'V§Shock_covid': [0, -6], 'V§Shock_financialcrisis': [0, -6], 'L§F_Consumption': [18, -6], 'C7': [0, 0],
};
const DISPLAY: Record<string, string> = {
  'L§Supply_owner_occupied': 'Supply owner', 'L§Supply_rent': 'Supply rent', 'L§Gross_imputed_rent': 'Gross imp.', 'V§Maintenance_costs': 'Maintenance', 'L§Demand_owner_occupied': 'Demand owner', 'I§Owner_occupied_subsidies': 'Owner subsidies', 'I§Rental_subsidies1': 'Rental subsidies', 'B§PID': 'PID output', 'B§PID_I_Robust': 'PID I', 'V§Shock_financialcrisis': 'Crisis shock', 'V§Shock_covid': 'Covid shock', 'L§Supply_consumption': 'Supply goods', 'L§Demand_consumption': 'Demand goods', 'I§Mortgages': 'Mortgages', 'B§Mortgage_interest': 'Mortgage interest', 'Interest_Rates': 'Interest rates', 'Incomeactual': 'Income (historical)', 'V§Construction_cost': 'Construction cost',
};
const short = (e: Element) => DISPLAY[e.name] ?? e.name.split('§').pop()!.replace(/_/g, ' ');

function Glyph({ type, length }: { type: string; length: number }) {
  const mid = length / 2, half = Math.min(26, length / 2 - 6);
  const leads = (gap: number) => <path d={`M0 0H${mid - gap}M${mid + gap} 0H${length}`}/>;
  if (type === 'res') { const n = 6, s = (2 * half) / n; return <path d={`M0 0H${mid - half}` + Array.from({ length: n }, (_, i) => `L${mid - half + s * (i + .5)} ${i % 2 ? 11 : -11}`).join('') + `L${mid + half} 0H${length}`}/>; }
  if (type === 'ind' || type === 'ind2') { const n = 4, s = (2 * half) / n; return <path d={`M0 0H${mid - half}` + Array.from({ length: n }, () => `a${s / 2} ${s / 2} 0 0 1 ${s} 0`).join('') + `H${length}`}/>; }
  if (type === 'cap') return <>{leads(6)}<path d={`M${mid - 6} -15V15M${mid + 6} -15V15`}/></>;
  const diamond = <path d={`M${mid - 21} 0L${mid} -21L${mid + 21} 0L${mid} 21Z`}/>, ring = <circle cx={mid} cy={0} r={19}/>;
  if (type === 'voltage' || type === 'bv') return <>{leads(type === 'bv' ? 21 : 19)}{type === 'bv' ? diamond : ring}<path d={`M${mid - 12} 0h7M${mid - 8.5} -3.5v7M${mid + 5} 0h7`}/></>;
  return <>{leads(type === 'current' ? 19 : 21)}{type === 'current' ? ring : diamond}<path d={`M${mid - 10} 0H${mid + 9}M${mid + 3} -5L${mid + 10} 0L${mid + 3} 5`}/></>;
}

function ElementView({ e, state, selected, pick, menu }: { e: Element; state: string; selected: boolean; pick: () => void; menu?: (ev: React.MouseEvent) => void }) {
  const [[ax, ay], [bx, by]] = e.pins, length = Math.hypot(bx - ax, by - ay), angle = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
  const vertical = Math.abs(by - ay) > Math.abs(bx - ax), mx = (ax + bx) / 2, my = (ay + by) / 2, shift = LABEL_OFFSET[e.name] ?? [0, 0];
  return <g className={`element ${state}${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${e.name}, ${e.role}${state === 'active' ? '' : `. ${STATE_NOTE[state] ?? ''}`}`} onClick={ev => { ev.stopPropagation(); pick(); }} onContextMenu={ev => { if (menu) { ev.preventDefault(); ev.stopPropagation(); menu(ev); } }} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); k.stopPropagation(); pick(); } }}>
    <rect className="hit" x={Math.min(ax, bx) - (vertical ? 26 : 2)} y={Math.min(ay, by) - (vertical ? 2 : 26)} width={Math.abs(bx - ax) + (vertical ? 52 : 4)} height={Math.abs(by - ay) + (vertical ? 4 : 52)} rx={5}/>
    <g className="glyph" transform={`translate(${ax} ${ay}) rotate(${angle})`}><Glyph type={e.type} length={length}/></g>
    <text x={(vertical ? mx + 26 : mx) + shift[0]} y={(vertical ? my + 7 : my - 28) + shift[1]} textAnchor={vertical ? 'start' : 'middle'}>{short(e)}</text>
  </g>;
}

/** Terminal pair on the agent border: flow rail with ammeter, return rail, voltmeter between them. */
function PortMark({ x, y, w, h, flow, selected, pick, ret }: { x: number; y: number; w: number; h: number; flow: Flow; selected: boolean; pick: () => void; ret?: number[] }) {
  const out: [number, number] = x === 0 ? [-1, 0] : x === w ? [1, 0] : y === 0 ? [0, -1] : [0, 1];
  const side: [number, number] = out[0] ? [0, 1] : [1, 0], rail = 30, reach = 56;
  const px = (t: number, s = 0): [number, number] => [x + out[0] * t + side[0] * s, y + out[1] * t + side[1] * s];
  const line = (a: [number, number], b: [number, number]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  const [lx, ly] = px(reach + 14, rail / 2), anchor = out[0] < 0 ? 'end' : out[0] > 0 ? 'start' : 'middle';
  const end = px(reach), retStart = ret ?? px(0, rail), retEnd = px(reach, rail), A = px(24), V = px(40, rail / 2);
  return <g className={`port ${flow.kind}${selected ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Port ${flow.label}`} onClick={pick} onKeyDown={k => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); pick(); } }}>
    <path className="rail" d={line([x, y], end)}/><path className="return" d={line(retStart as [number, number], retEnd)}/><path className="return" d={line(px(40), px(40, rail))}/>
    <circle className="dot" cx={end[0]} cy={end[1]} r={5}/><circle className="open" cx={retEnd[0]} cy={retEnd[1]} r={5}/>
    <circle className="meter" cx={A[0]} cy={A[1]} r={11}/><text className="m" x={A[0]} y={A[1] + 5}>A</text><circle className="meter" cx={V[0]} cy={V[1]} r={11}/><text className="m" x={V[0]} y={V[1] + 5}>V</text>
    <text className="port-name" x={lx} y={out[1] < 0 ? ly - 6 : out[1] > 0 ? ly + 20 : ly + 6} textAnchor={anchor}>{flow.short}</text>
  </g>;
}

const BREADBOARD = <defs><pattern id="breadboard" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1.6" fill="#c9bb9c"/></pattern></defs>;

export function AgentCircuit({ map, agent, scenario, selection, pick, menu }: { map: MapData; agent: string; scenario: Scenario; selection: Selection; pick: (s: Selection) => void; menu?: (s: Selection, ev: React.MouseEvent) => void }) {
  const layout = map.layouts[agent], [w, h] = layout.size;
  const hidden = (e: Element) => (e.name === 'I§Owner_occupied_subsidies' && scenario.feedback) || (e.name === 'B§PID' && !scenario.feedback);
  const elements = map.elements.filter(e => e.agent === agent && !hidden(e));
  const flow = (id: string) => map.flows.find(f => f.id === id)!;
  const line = (w: number[]) => `M${w[0]} ${w[1]}L${w[2]} ${w[3]}`;
  return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${map.agents[agent].label} circuit`}>
    {BREADBOARD}<rect x={0} y={0} width={w} height={h} fill="url(#breadboard)"/>
    <g className="return-wires">{[...layout.return_wires, ...layout.common_returns].map((r, i) => <path key={i} d={line(r)}/>)}{layout.dots.map(([x, y], i) => <circle key={`d${i}`} className="return-dot" cx={x} cy={y} r={5}/>)}</g>
    <g className="wires">{layout.wires.map((r, i) => <path key={i} d={line(r)}/>)}</g>
    <g className="grounds">{layout.grounds.map(([x, y], i) => <path key={i} d={`M${x - 14} ${y}H${x + 14}L${x} ${y + 16}Z`}/>)}</g>
    {layout.signals.map(sig => <g key={sig.flow} className={`u-signal${selection.kind === 'flow' && selection.id === sig.flow ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Control signal ${flow(sig.flow).label}`} onClick={ev => { ev.stopPropagation(); pick({ kind: 'flow', id: sig.flow }); }} onContextMenu={ev => { if (menu) { ev.preventDefault(); ev.stopPropagation(); menu({ kind: 'flow', id: sig.flow }, ev); } }}>
      <path d={sig.path.map(([x, y], j) => `${j ? 'L' : 'M'}${x} ${y}`).join('')}/></g>)}
    {elements.map(e => <ElementView key={e.name} e={e} state={stateOf(e, scenario)} selected={selection.kind === 'element' && selection.id === e.name} pick={() => pick({ kind: 'element', id: e.name })} menu={menu && (ev => menu({ kind: 'element', id: e.name }, ev))}/>)}
  </svg>;
}

/** Controller with its ports where the outside arrows meet it: e in at mid-left, u2 out at mid-right, u1 out lower right. */
export const CONTROLLER_SIZE: [number, number] = [1100, 480];
export function ControllerCircuit({ map, scenario, selection, pick }: { map: MapData; scenario: Scenario; selection: Selection; pick: (s: Selection) => void }) {
  const [w, h] = CONTROLLER_SIZE, closed = scenario.feedback, el = (name: string) => map.elements.find(e => e.name === name);
  const box = (name: string, x: number, y: number, bw: number, title: string, sub: string, active: boolean) => {
    const e = el(name), on = selection.kind === 'element' && selection.id === name;
    return <g className={`ctrl-box${active ? '' : ' off'}${on ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${name}, ${title}`} onClick={ev => { ev.stopPropagation(); if (e) pick({ kind: 'element', id: name }); }}>
      <rect x={x} y={y - 42} width={bw} height={84} rx={8}/><text className="t" x={x + bw / 2} y={y - 4}>{title}</text><text className="s" x={x + bw / 2} y={y + 28}>{sub}</text></g>;
  };
  const path = (pts: number[][], active: boolean, key: string) => <path key={key} className={active ? 'sig on' : 'sig off'} d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}/>;
  return <svg className="circuit embedded" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Controller circuit">
    {BREADBOARD}<rect x={0} y={0} width={w} height={h} fill="url(#breadboard)"/>
    {path([[0, 240], [160, 240]], closed, 'e')}{path([[160, 240], [160, 100], [330, 100]], closed, 'p')}{path([[160, 240], [330, 240]], closed, 'i')}{path([[160, 240], [160, 380], [330, 380]], closed, 'd')}
    {path([[610, 100], [700, 100], [700, 216]], closed, 'po')}{path([[610, 240], [676, 240]], closed, 'io')}{path([[610, 380], [700, 380], [700, 264]], closed, 'do')}
    {path([[724, 240], [930, 240]], closed, 'pid-out')}{path([[930, 140], [930, 240]], !closed, 'hist-out')}{path([[930, 240], [1100, 240]], true, 'u2')}{path([[1060, 400], [1100, 400]], true, 'u1')}
    <circle className={closed ? 'sum-mark' : 'sum-mark off'} cx={700} cy={240} r={24}/><circle cx={930} cy={240} r={7} className="junction"/>
    {box('B§PID_P', 330, 100, 280, 'P', `Kp ${scenario.kp}`, closed)}{box('B§PID_I_Robust', 330, 240, 280, 'I', `Ki ${scenario.ki}`, closed)}{box('B§PID_D', 330, 380, 280, 'D', `Kd ${scenario.kd}${scenario.derivative_filter ? ', filtered' : ''}`, closed)}
    {box('I§Owner_occupied_subsidies', 800, 98, 260, 'Owner path', 'historical', !closed)}{box('I§Rental_subsidies1', 800, 400, 260, 'Rental path', 'historical', true)}
    <text className="port-label" x={10} y={222}>e</text><text className="port-label" x={1090} y={222} textAnchor="end">u2</text><text className="port-label" x={1090} y={382} textAnchor="end">u1</text>
  </svg>;
}

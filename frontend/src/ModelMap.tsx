import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronRight, Maximize2, Minus, Plus } from 'lucide-react';
import { api } from './api';
import { Chart, type Line } from './Chart';
import { AgentCircuit, CONTROLLER_SIZE, ControllerCircuit, STATE_NOTE, stateOf } from './Schematic';
import type { Element, Flow, MapData, Result, Scenario, Selection } from './types';
import { TransferPanel, type Pick } from './Analysis';

type Point = [number, number];
type Side = 'L' | 'R' | 'T' | 'B';
type Rect = { x: number; y: number; w: number; h: number };
const COLOR = { money: '#4f9a4f', real: '#c98a1b', policy: '#6a4fb3' };
const SHOCK = '#3f5f8f', LOOP = '#3f9a1f';
const NONE: Selection = { kind: 'none', id: '' };
const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3);

export function readTrace(result: Result, signal: string): number[] | undefined {
  if (signal === 'owner_subsidy') return result.series.owner_subsidy;
  if (signal === 'yoy') return result.series.yoy;
  const lookup = (name: string) => { const wanted = name.toLowerCase(); const key = Object.keys(result.traces).find(k => k.toLowerCase() === wanted); return key ? result.traces[key] : undefined; };
  const pair = /^V\(([^,]+),([^)]+)\)$/.exec(signal);
  if (pair) {
    const a = pair[1] === '0' ? undefined : lookup(`V(${pair[1]})`), b = pair[2] === '0' ? undefined : lookup(`V(${pair[2]})`);
    const base = a ?? b; if (!base) return undefined;
    return base.map((_, i) => (a?.[i] ?? 0) - (b?.[i] ?? 0));
  }
  return lookup(signal);
}
function Spark({ y, color, at }: { y?: number[]; color: string; at: number }) {
  if (!y) return null;
  const lo = Math.min(...y), hi = Math.max(...y), span = hi - lo || 1, w = 64, h = 20, sx = (i: number) => i / (y.length - 1) * w, sy = (v: number) => h - 2 - (v - lo) / span * (h - 4);
  return <svg className="spark" width={w} height={h} aria-hidden="true"><path d={y.filter((_, i) => i % 4 === 0).map((v, i) => `${i ? 'L' : 'M'}${sx(i * 4).toFixed(1)} ${sy(v).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={1.5}/><circle cx={sx(at)} cy={sy(y[at])} r={2.4} fill={color}/></svg>;
}

// ---------- geometry
const SCALE = { collapsed: 0.22, expanded: 0.5, controller: 0.34 };
const len = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const along = (a: Point, b: Point, t: number): Point => { const l = len(a, b) || 1; return [a[0] + (b[0] - a[0]) / l * t, a[1] + (b[1] - a[1]) / l * t]; };
const toPath = (pts: Point[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
function offset(points: Point[], d: number): Point[] {
  const normal = (a: Point, b: Point): Point => { const l = len(a, b) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
  return points.map((p, i) => {
    const n1 = i > 0 ? normal(points[i - 1], p) : normal(p, points[i + 1]), n2 = i < points.length - 1 ? normal(p, points[i + 1]) : n1;
    const same = Math.abs(n1[0] - n2[0]) + Math.abs(n1[1] - n2[1]) < 1e-6;
    return same ? [p[0] + n1[0] * d, p[1] + n1[1] * d] : [p[0] + (n1[0] + n2[0]) * d, p[1] + (n1[1] + n2[1]) * d];
  });
}
function crossings(a: Point[], b: Point[]) {
  let n = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
    const av = p[0] === q[0], bv = r[0] === s[0];
    if (av === bv) continue;
    const [v1, v2, h1, h2] = av ? [p, q, r, s] : [r, s, p, q];
    const x = v1[0], y = h1[1];
    if (x > Math.min(h1[0], h2[0]) + .5 && x < Math.max(h1[0], h2[0]) - .5 && y > Math.min(v1[1], v2[1]) + .5 && y < Math.max(v1[1], v2[1]) - .5) n++;
  }
  return n;
}
function permutations<T>(xs: T[]): T[][] { return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r])); }
/** Orthogonal route from P to Q, with the jog on the given lane coordinate. */
function route(P: Point, sp: Side, Q: Point, lane: number): Point[] {
  if ((sp === 'L' || sp === 'R')) return Math.abs(P[1] - Q[1]) < .5 ? [P, Q] : [P, [lane, P[1]], [lane, Q[1]], Q];
  return Math.abs(P[0] - Q[0]) < .5 ? [P, Q] : [P, [P[0], lane], [Q[0], lane], Q];
}
type Wire = { id: string; P: Point; sp: Side; Q: Point; channel: string };
function assignLanes(wires: Wire[], channels: Record<string, [number, number]>) {
  const out: Record<string, Point[]> = {};
  for (const [name, [lo, hi]] of Object.entries(channels)) {
    const group = wires.filter(w => w.channel === name);
    if (!group.length) continue;
    const lanes = group.map((_, i) => lo + (hi - lo) * (i + .5) / group.length);
    let best: Point[][] = [], score = Infinity;
    for (const order of permutations(group.map((_, i) => i)).slice(0, 720)) {
      const paths = group.map((w, i) => route(w.P, w.sp, w.Q, lanes[order[i]]));
      let c = 0;
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) c += crossings(paths[i], paths[j]) + crossings(offset(paths[i], 12), paths[j]) + crossings(paths[i], offset(paths[j], 12));
      if (c < score) { score = c; best = paths; }
    }
    group.forEach((w, i) => { out[w.id] = best[i]; });
  }
  return out;
}

// ---------- nodes
type BlockData = { label: string; sub?: string; tone: string; width: number; height: number; selected?: boolean; children?: React.ReactNode; toggle?: () => void; open?: boolean; tab?: 'tl' | 'br' | 'bl' | 'above' };
function Block({ data }: NodeProps<Node<BlockData>>) {
  const button = data.toggle && <button className="toggle nodrag" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} onClick={e => { e.stopPropagation(); data.toggle!(); }}>{data.open ? <Minus size={13}/> : <Plus size={13}/>}</button>;
  return <div className={`map-node ${data.tone}${data.open ? ' open' : ''}${data.selected ? ' selected' : ''}`} style={{ width: data.width, height: data.height }}>
    <Handle type="target" position={Position.Left} className="hidden-handle"/><Handle type="source" position={Position.Right} className="hidden-handle"/>
    {data.open ? <>{data.children}<div className={`node-tab ${data.tab ?? 'tl'}`}><strong>{data.label}</strong>{button}</div></> : <>{button}{data.label && <strong>{data.label}</strong>}{data.sub && <span>{data.sub}</span>}{data.children}</>}
  </div>;
}
const nodeTypes = { block: Block };

// ---------- edges
type RailData = { points: Point[]; color: string; name: string; value?: string; selected?: boolean; labelT: number; side: number; pick: () => void; menu?: (e: React.MouseEvent) => void };
function PortPair({ a, b, ra, rb, color }: { a: Point; b: Point; ra: Point; rb: Point; color: string }) {
  const e1 = along(a, b, 11), e2 = along(ra, rb, 11), em: Point = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], f = along(a, b, 27), t1 = along(a, b, 39), t2 = along(ra, rb, 39);
  return <g className="pair-mark"><path d={`M${e1[0]} ${e1[1]}L${e2[0]} ${e2[1]}`} stroke={color} strokeWidth={1.2}/>
    <circle cx={em[0]} cy={em[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={em[0]} y={em[1] + 3} fill={color}>e</text>
    <circle cx={f[0]} cy={f[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={f[0]} y={f[1] + 3} fill={color}>f</text>
    <circle cx={t1[0]} cy={t1[1]} r={2.6} fill="#fff" stroke={color}/><circle cx={t2[0]} cy={t2[1]} r={2.6} fill="#fff" stroke={color}/></g>;
}
function longest(points: Point[]) { let k = 1; for (let i = 2; i < points.length; i++) if (len(points[i - 1], points[i]) > len(points[k - 1], points[k])) k = i; return k; }
function Rail({ id, data }: EdgeProps<Edge<RailData>>) {
  const d = data!, back = offset(d.points, 12 * d.side), n = d.points.length, k = longest(d.points);
  const [p, q] = [d.points[k - 1], d.points[k]], mid = along(p, q, len(p, q) * d.labelT), dir = along([0, 0], [q[0] - p[0], q[1] - p[1]], 1), vertical = Math.abs(dir[1]) > .5;
  const tri = along(p, q, len(p, q) * (d.labelT < .5 ? .62 : .38)), angle = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  // Name on the flow-rail side, away from the return rail.
  const lx = vertical ? mid[0] - 8 * Math.sign(back[k][0] - p[0] || 1) : mid[0], ly = vertical ? mid[1] : mid[1] - 8 * Math.sign(back[k][1] - p[1] || 1) + (Math.sign(back[k][1] - p[1]) > 0 ? 0 : 9);
  const labelAngle = vertical ? -90 : 0;
  // Horizontal names sit at alternating ends of their segment, so parallel pairs never collide.
  // Horizontal names go to the far left or far right of the whole connection, at that end's height.
  const near = d.labelT < .5, ends = [d.points[0], d.points[n - 1]], flat = !vertical && d.points[0][1] === d.points[1][1] && d.points[n - 1][1] === d.points[n - 2][1];
  const pick = flat ? (near ? ends.reduce((a, b) => a[0] < b[0] ? a : b) : ends.reduce((a, b) => a[0] > b[0] ? a : b)) : null;
  const left = Math.min(p[0], q[0]), right = Math.max(p[0], q[0]);
  const anchor = vertical ? 'middle' : near ? 'start' : 'end';
  const tx = vertical ? lx : pick ? pick[0] + (near ? 48 : -48) : near ? left + 48 : right - 48;
  const ty = pick ? pick[1] - 8 * Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1] || 1) + (Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1]) > 0 ? 0 : 9) : ly;
  return <g className={'rail' + (d.selected ? ' selected' : '')}>
    <path d={toPath(back)} fill="none" stroke={d.color} strokeWidth={1.4} strokeOpacity={.75}/>
    <BaseEdge id={id} path={toPath(d.points)} style={{ stroke: d.color, strokeWidth: d.selected ? 4.2 : 2.4 }}/>
    <path d="M-6 -5L5 0L-6 5Z" fill={d.color} transform={`translate(${tri[0]} ${tri[1]}) rotate(${angle})`}/>
    <PortPair a={d.points[0]} b={d.points[1]} ra={back[0]} rb={back[1]} color={d.color}/><PortPair a={d.points[n - 1]} b={d.points[n - 2]} ra={back[n - 1]} rb={back[n - 2]} color={d.color}/>
    <text className="rail-name" transform={`translate(${tx} ${ty}) rotate(${labelAngle})`} textAnchor={anchor} fill={d.color}>{d.name}{d.value && <tspan className="rail-value" dx={5}>{d.value}</tspan>}</text>
    <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/><path className="rail-hit" d={toPath(back)} onClick={d.pick} onContextMenu={d.menu}/>
  </g>;
}
type SignalData = { points: Point[]; color: string; letter: string; name?: string; value?: string; markAt?: number; markDist?: number; dashed?: boolean; selected?: boolean; pick?: () => void; labelSide?: 'right' | 'left' | 'above' | 'below'; target?: Selection; menu?: (e: React.MouseEvent) => void };
function Signal({ id, data }: EdgeProps<Edge<SignalData>>) {
  const d = data!, k = d.markAt ?? 1, [p, q] = [d.points[k - 1], d.points[k]], m = along(p, q, d.markDist ?? Math.min(len(p, q) / 2, 60));
  const side = d.labelSide ?? (Math.abs(q[0] - p[0]) < .5 ? 'right' : 'above');
  const lx = side === 'right' ? m[0] + 13 : side === 'left' ? m[0] - 13 : m[0], ly = side === 'above' ? m[1] - (d.value ? 26 : 13) : side === 'below' ? m[1] + 22 : m[1] - 2;
  return <g className={'signal' + (d.selected ? ' selected' : '')}>
    <defs><marker id={`s-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 10 5 0 10z" fill={d.color}/></marker></defs>
    <BaseEdge id={id} path={toPath(d.points)} markerEnd={`url(#s-${id})`} style={{ stroke: d.color, strokeWidth: d.selected ? 3.2 : 1.6, strokeDasharray: d.dashed ? '6 5' : undefined }}/>
    <circle cx={m[0]} cy={m[1]} r={8} fill="#fff" stroke={d.color} strokeWidth={1.3}/><text className="sig-letter" x={m[0]} y={m[1] + 3.6} fill={d.color}>{d.letter}</text>
    {d.name && <text className="sig-name" x={lx} y={ly} textAnchor={side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'} fill={d.color}>{d.name}{d.value && <tspan className="sig-value" x={lx} dy={13}>{d.value}</tspan>}</text>}
    {d.pick && <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/>}
  </g>;
}
const edgeTypes = { rail: Rail, signal: Signal };

const TAB: Record<string, 'tl' | 'br' | 'bl'> = { households: 'br', investors: 'br', firms: 'br', bank: 'br', constructors: 'bl' };
const SHORT_SUMMARY: Record<string, string> = { households: 'Budget, housing services', investors: 'Housing stock, price', constructors: 'New construction', firms: 'Income, goods', bank: 'Mortgages, loans' };

function Inspector({ map, selection, pick, result, pinned, scenario, enter, layer, tf, setTf }: { map: MapData; selection: Selection; pick: (s: Selection) => void; result: Result | null; pinned: Result | null; scenario: Scenario; enter: (id: string) => void; layer: string; tf: TfPicks; setTf: (t: TfPicks) => void }) {
  const lines = (signal: string, name: string, color: string): Line[] => {
    if (!result) return [];
    const own = readTrace(result, signal), other = pinned && readTrace(pinned, signal);
    return [...(other ? [{ name: 'Comparison', x: pinned!.year, y: other, color: '#8a9692', dash: 'dash', width: 2 }] : []), ...(own ? [{ name, x: result.year, y: own, color }] : [])];
  };
  const hint = (what: string) => <p className="run-hint">Run the simulation to see {what}.</p>;
  const name = (id: string) => id === 'controller' ? 'Controller' : map.agents[id]?.label ?? id;
  const go = (id: string) => pick({ kind: 'agent', id });
  if (selection.kind === 'tf') return <TransferPanel input={tf.input} output={tf.output} feedback={scenario.feedback} K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} swap={() => setTf({ input: tf.output, output: tf.input })} clear={() => setTf({})}/>;
  if (selection.kind === 'flow') {
    const f = map.flows.find(x => x.id === selection.id) as Flow;
    const chain = f.chain.filter(n => f.id !== 'owner_subsidy' || (scenario.feedback ? n === 'B§PID' : n !== 'B§PID'));
    return <>
      <p className="eyebrow">{f.kind === 'real' ? 'Goods port' : f.kind === 'policy' ? 'Control signal' : 'Money port'}</p><h3>{f.label}</h3>
      <p className="direction"><button className="link" onClick={() => go(f.source)}>{name(f.source)}</button> → <button className="link" onClick={() => go(f.target)}>{name(f.target)}</button>{f.port && <> · node {f.port.node}</>}</p>
      <p className="muted">{f.description}</p>
      {result ? <><Chart title="A · Flow" unit={f.unit} height={210} lines={lines(f.signal, f.label, COLOR[f.kind])}/>{f.port && <Chart title="V · Incentive at the port" unit="Model units" height={200} lines={lines(`V(${f.port.node.toLowerCase()},${f.port.ret.toLowerCase()})`, 'Incentive', '#a8660c')}/>}</> : hint('this flow')}
      <h4>Components along this flow</h4><div className="chain">{chain.map(n => <button key={n} onClick={() => pick({ kind: 'element', id: n })}>{n}</button>)}</div>
    </>;
  }
  if (selection.kind === 'signal') {
    const s = [...map.disturbances, ...map.outputs].find(x => x.id === selection.id)!;
    return <><p className="eyebrow">{selection.id.startsWith('d_') ? 'Historical shock or input' : 'Signal'}</p><h3>{s.label}</h3>
      {result ? <Chart title="" unit={s.unit} height={250} lines={lines(s.signal, s.label, s.id === 'y_yoy' ? '#3f9a1f' : selection.id.startsWith('d_') ? '#b3322a' : '#3c6e4e')}/> : hint('this signal')}
      {s.element && <><h4>Component</h4><div className="chain"><button onClick={() => pick({ kind: 'element', id: s.element! })}>{s.element}</button></div></>}</>;
  }
  if (selection.kind === 'shocks') {
    return <><p className="eyebrow">Disturbances d</p><h3>Historical shocks and inputs</h3><p className="muted">Six signals act on the system. Open the Housing Market System to see where each one enters.</p>
      <div className="sensor-list">{map.disturbances.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#3f5f8f" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'sensor') {
    return <><p className="eyebrow">Sensor</p><h3>Reporting sensor</h3><p className="muted">Read-outs from the model. The controller uses the measured price.</p>
      <div className="sensor-list">{map.outputs.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#3f9a1f" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'element') {
    const e = map.elements.find(x => x.name === selection.id) as Element, state = stateOf(e, scenario);
    return <><p className="eyebrow">{e.role}</p><h3>{e.name}</h3>
      {state !== 'active' && <p className="state-note">{STATE_NOTE[state]}</p>}
      <p className="direction">Nodes {e.a} → {e.b}{e.agent && layer !== e.agent ? <> · <button className="link" onClick={() => enter(e.agent!)}>Open {name(e.agent)}</button></> : null}</p>
      {result ? <><Chart title="Flow" unit="Model units" height={200} lines={lines(e.trace, 'Flow', '#3f8f4f')}/>{e.a !== e.b && <Chart title="Incentive across" unit="Model units" height={200} lines={lines(`V(${e.a.toLowerCase()},${e.b.toLowerCase()})`, 'Incentive across', '#a8660c')}/>}</> : hint('this component')}
      <details className="netlist-line"><summary>Netlist line</summary><code>{e.netlist}</code></details>
      {e.flows.length > 0 && <><h4>Part of</h4><div className="chain">{e.flows.map(id => <button key={id} onClick={() => pick({ kind: 'flow', id })}>{map.flows.find(f => f.id === id)?.label}</button>)}</div></>}</>;
  }
  const id = selection.kind === 'agent' ? selection.id : layer;
  if (id === 'controller') {
    return <><p className="eyebrow">Outside the system</p><h3>Controller</h3><p className="muted">{map.controller.description}</p>
      <h4>Sends</h4><div className="chain">{map.flows.filter(f => f.source === 'controller').map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div>
      {layer !== 'controller' && <button className="secondary open-agent" onClick={() => enter('controller')}>Show inside <ChevronRight size={15}/></button>}</>;
  }
  const agent = map.agents[id];
  if (!agent) return <><h3>Model</h3><p className="muted">Click the Housing Market to open it in place, then an agent to see its components. Click any arrow, port pair or component to plot it.</p></>;
  const inFlows = map.flows.filter(f => f.target === id), outFlows = map.flows.filter(f => f.source === id), layout = map.layouts[id];
  return <><p className="eyebrow">Agent</p><h3>{agent.label}</h3><p className="muted">{agent.description}</p>
    {layer !== id && <button className="secondary open-agent" onClick={() => enter(id)}>Show components <ChevronRight size={15}/></button>}
    {inFlows.length > 0 && <><h4>Receives</h4><div className="chain">{inFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {outFlows.length > 0 && <><h4>Sends</h4><div className="chain">{outFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {layout.not_drawn.length > 0 && <p className="not-drawn">Not drawn, not in the circuit: {layout.not_drawn.join(', ')}</p>}</>;
}

type View = { system: boolean; cpb: boolean; finance: boolean; controller: boolean; agents: string[] };
const CPB_AGENTS = ['constructors', 'investors', 'firms', 'households'];
const CHANNEL: Record<string, string> = {
  construction_cost: 'c12', houses: 'c12', consumption: 'c12', income: 'c12', goods: 'c12',
  rental_services: 'row', owner_services: 'row', rent: 'row', imputed_rent: 'row',
  mortgages: 'c23', mortgage_interest: 'c23', savings: 'c23', savings_interest: 'c23', loans: 'bottom', loan_interest: 'bottom',
};
// Collapsed CPB box: where the six financial pairs leave it (px offsets), return rail 12 px on the +y / +x side.
const CPB_BOX: [number, number] = [300, 230];
const CPB_PORTS: Record<string, { p: Point; side: Side }> = {
  mortgages: { p: [300, 46], side: 'R' }, mortgage_interest: { p: [300, 92], side: 'R' }, savings: { p: [300, 138], side: 'R' }, savings_interest: { p: [300, 184], side: 'R' },
  loans: { p: [100, 230], side: 'B' }, loan_interest: { p: [200, 230], side: 'B' },
};
// Collapsed agents all have one size; the financial sector is as tall as the collapsed CPB box,
// so its four left ports line up with the CPB's four right ports.
const AGENT_BOX: Point = [250, 160], FIN_BOX: Point = [250, 230];
/** Port of a collapsed block: ports keep their side and order from the drawing, evenly spaced along that side. */
function evenPort(l: MapData['layouts'][string], flow: string, [W, H]: Point): { p: Point; side: Side; ret: Point } {
  const [w, h] = l.size, sideOf = ([x, y]: number[]): Side => x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B';
  const side = sideOf(l.ports[flow]), vertical = side === 'L' || side === 'R', k = vertical ? 1 : 0;
  const same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][k] - l.ports[b][k]);
  const t = (same.indexOf(flow) + 1) / (same.length + 1), sign = Math.sign(l.returns[flow][k] - l.ports[flow][k]) || 1;
  const p: Point = side === 'L' ? [0, H * t] : side === 'R' ? [W, H * t] : side === 'T' ? [W * t, 0] : [W * t, H];
  return { p, side, ret: vertical ? [p[0], p[1] + 12 * sign] : [p[0] + 12 * sign, p[1]] };
}

function useModelGraph(map: MapData | undefined, view: View, toggle: (k: string) => void, scenario: Scenario, result: Result | null, at: number, selection: Selection, select: (s: Selection) => void, menu: (s: Selection, e: React.MouseEvent) => void) {
  return useMemo(() => {
    if (!map) return { nodes: [] as Node[], edges: [] as Edge[] };
    const value = (signal: string) => { const t = result && readTrace(result, signal); return t ? fmt(t[at]) : undefined; };
    const on = (s: Selection) => selection.kind === s.kind && selection.id === s.id;
    const nodes: Node[] = [], edges: Edge[] = [];
    const block = (id: string, r: Rect, data: Partial<BlockData>, z = 1) => nodes.push({ id, type: 'block', position: { x: r.x, y: r.y }, draggable: false, zIndex: z, data: { label: '', tone: '', width: r.w, height: r.h, ...data } });
    const sig = (id: string, points: Point[], data: Omit<SignalData, 'points'>) => edges.push({ id, source: 'anchor', target: 'anchor', type: 'signal', zIndex: 5, data: { points, ...data, menu: data.target ? (e: React.MouseEvent) => menu(data.target!, e) : undefined } });
    const GX = 640, GY = 300;
    const R: Record<string, Rect> = {}, scale: Record<string, number> = {};
    const shift = (dx: number, dy: number, ids: string[]) => ids.forEach(i => { R[i].x += dx; R[i].y += dy; });
    const sized = (id: string) => { const open = view.agents.includes(id), [w, h] = map.layouts[id].size; scale[id] = open ? SCALE.expanded : 0; R[id] = open ? { x: 0, y: 0, w: w * SCALE.expanded, h: h * SCALE.expanded } : { x: 0, y: 0, w: AGENT_BOX[0], h: AGENT_BOX[1] }; };
    // Port of a flow on a block: agent (from its drawing), collapsed CPB box, or collapsed financial sector (drawn like Bank).
    const portOf = (node: string, flow: string): { p: Point; side: Side; ret: Point } => {
      const r = R[node];
      if (node === 'cpb') { const c = CPB_PORTS[flow]; const p: Point = [r.x + c.p[0], r.y + c.p[1]]; return { p, side: c.side, ret: c.side === 'R' ? [p[0], p[1] + 12] : [p[0] + 12, p[1]] }; }
      const l = map.layouts[node === 'finance' ? 'bank' : node], [w, h] = l.size, s = scale[node] ?? 0;
      if (!s) { const e = evenPort(l, flow, node === 'finance' ? FIN_BOX : AGENT_BOX); return { p: [r.x + e.p[0], r.y + e.p[1]], side: e.side, ret: [r.x + e.ret[0], r.y + e.ret[1]] }; }
      const [x, y] = l.ports[flow], [rx, ry] = l.returns[flow];
      return { p: [r.x + x * s, r.y + y * s], side: x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B', ret: [r.x + rx * s, r.y + ry * s] };
    };
    let group: Rect = { x: GX, y: GY, w: 330, h: 230 }, cpbRegion: Rect | null = null, finRegion: Rect | null = null;
    const g12 = 340, rowGap = 340, g23 = 340, framePad = 34;
    if (view.system) {
      // ---- CPB model
      if (view.cpb) {
        CPB_AGENTS.forEach(sized);
        const rel = (a: string, f: string) => { const q = portOf(a, f).p; return [q[0] - R[a].x, q[1] - R[a].y]; };
        const A = R, col1 = Math.max(A.constructors.w, A.firms.w);
        A.investors.x = col1 + g12; A.investors.y = 0;
        A.households.x = A.investors.x; A.households.y = A.investors.h + rowGap;
        A.constructors.x = A.investors.x - g12 - A.constructors.w; A.constructors.y = rel('investors', 'construction_cost')[1] - rel('constructors', 'construction_cost')[1];
        A.firms.x = A.households.x - g12 - A.firms.w; A.firms.y = A.households.y + rel('households', 'consumption')[1] - rel('firms', 'consumption')[1];
        const x0 = Math.min(...CPB_AGENTS.map(i => A[i].x)), y0 = Math.min(...CPB_AGENTS.map(i => A[i].y));
        const x1 = Math.max(...CPB_AGENTS.map(i => A[i].x + A[i].w)), y1 = Math.max(...CPB_AGENTS.map(i => A[i].y + A[i].h));
        R.cpb = { x: x0 - framePad, y: y0 - framePad - 24, w: x1 - x0 + 2 * framePad, h: y1 - y0 + 2 * framePad + 24 };
      } else R.cpb = { x: 0, y: 0, w: CPB_BOX[0], h: CPB_BOX[1] };
      cpbRegion = R.cpb;
      // ---- Financial sector, aligned so the mortgage pair runs straight where possible
      const cpbMort = view.cpb ? portOf('investors', 'mortgages').p[1] : R.cpb.y + CPB_PORTS.mortgages.p[1];
      if (view.finance) {
        sized('bank');
        R.bank.x = R.cpb.x + R.cpb.w + g23 + framePad; R.bank.y = cpbMort - portOf('bank', 'mortgages').p[1];
        R.finance = { x: R.bank.x - framePad, y: R.bank.y - framePad - 24, w: R.bank.w + 2 * framePad, h: R.bank.h + 2 * framePad + 24 };
      } else {
        R.finance = { x: R.cpb.x + R.cpb.w + g23, y: cpbMort - evenPort(map.layouts.bank, 'mortgages', FIN_BOX).p[1], w: FIN_BOX[0], h: FIN_BOX[1] };
      }
      finRegion = R.finance;
      // ---- place the system frame
      const inside = Object.keys(R), padL = 130, padT = 70, padR = 60, padB = 150;
      const minX = Math.min(...inside.map(i => R[i].x)), minY = Math.min(...inside.map(i => R[i].y));
      shift(GX + padL - minX, GY + padT - minY, inside);
      const maxX = Math.max(...inside.map(i => R[i].x + R[i].w)), maxY = Math.max(...inside.map(i => R[i].y + R[i].h));
      group = { x: GX, y: GY, w: maxX + padR - GX, h: maxY + padB - GY };
      // ---- port pairs
      const ends = (f: Flow) => {
        const map1 = (a: string) => CPB_AGENTS.includes(a) ? (view.cpb ? a : 'cpb') : a === 'bank' ? (view.finance ? 'bank' : 'finance') : a;
        return [map1(f.source), map1(f.target)];
      };
      const shown = map.flows.filter(f => f.port && (CHANNEL[f.id] === 'c23' || CHANNEL[f.id] === 'bottom' || view.cpb));
      const inv = R.investors, hh = R.households, cpb = R.cpb, fin = R.finance;
      const channels: Record<string, [number, number]> = { c23: [cpb.x + cpb.w + 50, fin.x - 50], bottom: [maxY + 50, maxY + 105] };
      if (view.cpb) { channels.c12 = [inv.x - g12 + 55, inv.x - 55]; channels.row = [inv.y + inv.h + 55, hh.y - 160]; }
      const info: Record<string, { a: ReturnType<typeof portOf>; b: ReturnType<typeof portOf> }> = {};
      const wires: Wire[] = shown.map(f => { const [s1, t1] = ends(f), a = portOf(s1, f.id), b = portOf(t1, f.id); info[f.id] = { a, b }; return { id: f.id, P: a.p, sp: a.side, Q: b.p, channel: CHANNEL[f.id] }; });
      const paths = assignLanes(wires, channels), nth: Record<string, number> = {};
      shown.forEach(f => {
        const pts = paths[f.id], { a } = info[f.id], n0 = along([0, 0], [-(pts[1][1] - pts[0][1]), pts[1][0] - pts[0][0]], 1);
        const side = Math.sign(n0[0] * (a.ret[0] - a.p[0]) + n0[1] * (a.ret[1] - a.p[1])) || 1;
        nth[CHANNEL[f.id]] = (nth[CHANNEL[f.id]] ?? -1) + 1;
        edges.push({ id: f.id, source: 'anchor', target: 'anchor', type: 'rail', zIndex: 4, data: { points: pts, side, color: COLOR[f.kind], name: f.short, value: value(f.signal), labelT: nth[CHANNEL[f.id]] % 2 ? .7 : .3, selected: on({ kind: 'flow', id: f.id }), pick: () => select({ kind: 'flow', id: f.id }), menu: (e: React.MouseEvent) => menu({ kind: 'flow', id: f.id }, e) } });
      });
    }
    const gc = group.y + group.h / 2;
    // ---- controller, its ports set the subsidy and error heights
    const ctrlSize: Point = view.controller ? [CONTROLLER_SIZE[0] * SCALE.controller, CONTROLLER_SIZE[1] * SCALE.controller] : [210, 150];
    const target = view.system ? (view.cpb ? null : R.cpb) : group;
    const u2y = target ? target.y + target.h / 2 - .17 * ctrlSize[1] : R.households.y - 140;
    const ctrl: Rect = { x: group.x - 250 - ctrlSize[0], y: u2y - ctrlSize[1] / 2, w: ctrlSize[0], h: ctrlSize[1] };
    const u1y = ctrl.y + ctrlSize[1] * 5 / 6;
    const sum: Rect = { x: ctrl.x - 130, y: u2y - 22, w: 44, h: 44 }, parl: Rect = { x: sum.x - 260, y: u2y - 55, w: 180, h: 110 };
    const sensor: Rect = { x: group.x + group.w + 190, y: gc - 60, w: 180, h: 120 };
    block('anchor', { x: group.x, y: group.y, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    block('parliament', parl, { label: 'Parliament', sub: 'Reference governor', tone: 'reference', selected: on({ kind: 'signal', id: 'y_reference' }) });
    block('sum', sum, { tone: 'summing' });
    block('controller', ctrl, view.controller
      ? { label: 'Government · Controller', tone: 'controller', open: true, tab: 'above', toggle: () => toggle('controller'), children: <ControllerCircuit map={map} scenario={scenario} selection={selection} pick={select}/> }
      : { label: 'Government', sub: scenario.feedback ? 'Controller' : 'Historical subsidy paths', tone: 'controller', toggle: () => toggle('controller'), selected: on({ kind: 'agent', id: 'controller' }) });
    block('sensor', sensor, { label: 'Reporting', sub: 'Sensor', tone: 'sensor', selected: selection.kind === 'sensor' });
    if (!view.system) block('system', group, { label: 'Housing Market System', tone: 'system-closed', toggle: () => toggle('system') });
    else {
      block('system', group, { label: 'Housing Market System', tone: 'system-group', open: true, tab: 'tl', toggle: () => toggle('system') }, 0);
      block('cpb', R.cpb, view.cpb ? { label: 'CPB housing model', tone: 'sub-group', open: true, tab: 'tl', toggle: () => toggle('cpb') } : { label: 'CPB housing model', sub: 'Households · Investors · Firms · Constructors', tone: 'sub-closed', toggle: () => toggle('cpb') }, view.cpb ? 1 : 2);
      block('finance', R.finance, view.finance ? { label: 'Financial sector', tone: 'sub-group', open: true, tab: 'tl', toggle: () => toggle('finance') } : { label: 'Financial sector', sub: 'Bank', tone: 'sub-closed', toggle: () => toggle('finance') }, view.finance ? 1 : 2);
      const agentBlock = (id: string) => {
        const open = view.agents.includes(id), a = map.agents[id];
        block(id, R[id], open ? { label: a.label, tone: 'agent', open, tab: TAB[id], toggle: () => toggle(id), children: <AgentCircuit map={map} agent={id} scenario={scenario} selection={selection} pick={select} menu={menu}/> }
          : { label: a.label, sub: SHORT_SUMMARY[id], tone: 'agent', toggle: () => toggle(id), selected: on({ kind: 'agent', id }) }, 3);
      };
      if (view.cpb) CPB_AGENTS.forEach(agentBlock);
      if (view.finance) agentBlock('bank');
    }
    // ---- loop signals
    sig('r', [[parl.x + parl.w, u2y], [sum.x, u2y]], { color: '#2b6599', letter: 'r', name: 'Target', value: value('I(Reference)'), labelSide: 'above', selected: on({ kind: 'signal', id: 'y_reference' }), pick: () => select({ kind: 'signal', id: 'y_reference' }) });
    sig('e', [[sum.x + sum.w, u2y], [ctrl.x, u2y]], { color: scenario.feedback ? '#1f2a26' : '#b8c2bd', letter: 'e', name: 'Error', value: scenario.feedback ? value('I(Error)') : undefined, dashed: !scenario.feedback, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_error' }), pick: () => select({ kind: 'signal', id: 'y_error' }) });
    const subsidy = (id: string) => map.flows.find(f => f.id === id)!;
    ([['owner_subsidy', 'u2', u2y], ['rental_subsidy', 'u1', u1y]] as const).forEach(([id, letter, y], i) => {
      const f = subsidy(id);
      let points: Point[] = [[ctrl.x + ctrl.w, y], [(target ?? group).x, y]];
      if (view.system && view.cpb) { const entry = map.layouts.households.signals.find(s => s.flow === id)!.path[0], x = R.households.x + entry[0] / map.layouts.households.size[0] * R.households.w; points = [[ctrl.x + ctrl.w, y], [x, y], [x, R.households.y]]; }
      sig(letter, points, { color: COLOR.policy, letter, markDist: view.system ? 110 : len(points[0], points[1]) / 2, name: f.label, value: value(f.signal), labelSide: i === 0 ? 'above' : 'below', selected: on({ kind: 'flow', id }), pick: () => select({ kind: 'flow', id }), target: { kind: 'flow', id } });
    });
    sig('z', [[group.x + group.w, gc], [sensor.x, gc]], { color: '#e0782a', letter: 'z', name: 'House price', value: value('I(Construction_cost)'), labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: () => select({ kind: 'signal', id: 'y_price' }), target: { kind: 'signal', id: 'y_price' } });
    // y always leaves the sensor; the feedback branch exists only with feedback on.
    sig('yout', [[sensor.x + sensor.w, gc], [sensor.x + sensor.w + 170, gc]], { color: LOOP, letter: 'y', name: 'Reported price', value: value('I(Construction_cost)'), labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: () => select({ kind: 'signal', id: 'y_price' }), target: { kind: 'signal', id: 'y_price' } });
    if (scenario.feedback) {
      const fbY = group.y + group.h + 90, tap = sensor.x + sensor.w + 60;
      sig('y', [[tap, gc], [tap, fbY], [sum.x + sum.w / 2, fbY], [sum.x + sum.w / 2, sum.y + sum.h]], { color: LOOP, letter: 'y', markAt: 2, name: 'Feedback: reported price', labelSide: 'above', pick: () => select({ kind: 'signal', id: 'y_price' }) });
    }
    // Invisible corners so 'Whole model' also fits the arrows outside the blocks.
    const fbBottom = group.y + group.h + 130;
    block('edgeL', { x: parl.x - 30, y: u2y, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeR', { x: sensor.x + sensor.w + 230, y: gc, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    block('edgeT', { x: group.x, y: group.y - 270, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeB', { x: group.x, y: fbBottom, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    // ---- disturbances
    const top = group.y - 250, firmD = map.disturbances.filter(d => d.target === 'firms'), bankD = map.disturbances.filter(d => d.target === 'bank');
    const place = (d: typeof firmD[number], side: 'left' | 'right', pts: Point[]) => sig(d.id, pts, { color: SHOCK, letter: 'd', name: d.label, value: value(d.signal), markAt: 1, labelSide: side, selected: on({ kind: 'signal', id: d.id }), pick: () => select({ kind: 'signal', id: d.id }), target: { kind: 'signal', id: d.id } });
    if (!view.system) {
      const x = group.x + group.w / 2;
      sig('shocks', [[x, top + 60], [x, group.y]], { color: SHOCK, letter: 'd', name: 'Shocks (6)', markAt: 1, labelSide: 'right', selected: selection.kind === 'shocks', pick: () => select({ kind: 'shocks', id: '' }) });
    } else {
      if (view.cpb) { const F = R.firms; firmD.forEach((d, i) => { const x = group.x + 26 + i * 30, y = F.y + F.h * (i + 1) / (firmD.length + 1); place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, y], [F.x, y]]); }); }
      else firmD.forEach((d, i) => { const x = cpbRegion!.x + 40 + i * 45; place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, cpbRegion!.y]]); });
      const B = view.finance ? R.bank : finRegion!;
      bankD.forEach((d, i) => { const x = B.x + B.w * (i + 1) / (bankD.length + 1); place(d, 'right', [[x, top + i * 70], [x, B.y]]); });
    }
    return { nodes, edges };
  }, [map, view, scenario, result, at, selection, menu]);
}

function Canvas({ map, view, setView, scenario, result, at, selection, select, focus, menu }: { map: MapData; view: View; setView: (v: View) => void; scenario: Scenario; result: Result | null; at: number; selection: Selection; select: (s: Selection) => void; focus: { id: string; n: number }; menu: (s: Selection, e: React.MouseEvent) => void }) {
  const flow = useReactFlow();
  const toggle = (k: string) => {
    if (k === 'system') setView({ system: !view.system, cpb: false, finance: false, controller: view.controller, agents: [] });
    else if (k === 'controller') setView({ ...view, controller: !view.controller });
    else if (k === 'cpb') setView({ ...view, cpb: !view.cpb, agents: view.agents.filter(a => !CPB_AGENTS.includes(a)) });
    else if (k === 'finance') setView({ ...view, finance: !view.finance, agents: view.agents.filter(a => a !== 'bank') });
    else setView({ ...view, agents: view.agents.includes(k) ? view.agents.filter(a => a !== k) : [...view.agents, k] });
  };
  const graph = useModelGraph(map, view, toggle, scenario, result, at, selection, select, menu);
  useEffect(() => {
    const id = focus.id;
    const t = window.setTimeout(() => { void (id ? flow.fitView({ nodes: [{ id }], duration: 600, padding: .12 }) : flow.fitView({ duration: 600, padding: .04 })); }, 40);
    return () => clearTimeout(t);
  }, [focus.n]);
  return <ReactFlow nodes={graph.nodes} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .04 }} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} minZoom={.1} maxZoom={4} proOptions={{ hideAttribution: true }}
    onNodeClick={(_, n) => {
      if (n.id === 'sensor') select({ kind: 'sensor', id: '' });
      else if (n.id === 'parliament') select({ kind: 'signal', id: 'y_reference' });
      else if (n.id === 'sum') select({ kind: 'signal', id: 'y_error' });
      else if (n.id === 'controller') { select({ kind: 'agent', id: 'controller' }); if (!view.controller) toggle('controller'); }
      else if (['system', 'cpb', 'finance'].includes(n.id)) { const k = n.id as 'system' | 'cpb' | 'finance'; if (!view[k]) toggle(k); }
      else if (map.agents[n.id]) { select({ kind: 'agent', id: n.id }); if (!view.agents.includes(n.id)) toggle(n.id); }
    }}><Controls showInteractive={false}/></ReactFlow>;
}

const CLOSED: View = { system: false, cpb: false, finance: false, controller: false, agents: [] };
type TfPicks = { input?: Pick; output?: Pick };
type MenuState = { x: number; y: number; target: Selection; label: string };
export function ModelMap({ scenario, result, pinned, busy, run, setFeedback }: { scenario: Scenario; result: Result | null; pinned: Result | null; busy: boolean; run: () => void; setFeedback: (on: boolean) => void }) {
  const [map, setMap] = useState<MapData>();
  const [error, setError] = useState('');
  const [view, setViewState] = useState<View>(CLOSED);
  const [focus, setFocus] = useState({ id: '', n: 0 });
  const [selection, setSelection] = useState<Selection>(NONE);
  const [index, setIndex] = useState<number>();
  const [tf, setTf] = useState<TfPicks>({});
  const [menuAt, setMenuAt] = useState<MenuState | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelOf = (t: Selection) => !map ? t.id : t.kind === 'flow' ? map.flows.find(f => f.id === t.id)?.label ?? t.id : t.kind === 'signal' ? [...map.disturbances, ...map.outputs].find(o => o.id === t.id)?.label ?? t.id : t.id;
  const openMenu = useCallback((target: Selection, e: React.MouseEvent) => {
    e.preventDefault(); const r = canvasRef.current!.getBoundingClientRect();
    setMenuAt({ x: e.clientX - r.left, y: e.clientY - r.top, target, label: '' });
  }, []);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAt(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const choose = (role: 'input' | 'output') => {
    if (!menuAt) return; const t = menuAt.target as { kind: Pick['kind']; id: string };
    setTf(old => ({ ...old, [role]: { kind: t.kind, id: t.id, label: labelOf(t) } })); setSelection({ kind: 'tf', id: '' }); setMenuAt(null);
  };
  useEffect(() => { api<MapData>('/model/map').then(setMap).catch(e => setError(e.message)); }, []);
  const at = result ? Math.min(index ?? Math.floor(result.year.length / 2), result.year.length - 1) : 0;
  const setView = (next: View) => {
    const opened = next.agents.find(a => !view.agents.includes(a)) ?? (next.controller && !view.controller ? 'controller' : next.cpb && !view.cpb ? 'cpb' : next.finance && !view.finance ? 'finance' : next.system && !view.system ? 'system' : '');
    const parent = (a: string) => CPB_AGENTS.includes(a) ? 'cpb' : a === 'bank' ? 'finance' : 'system';
    const closedAgent = view.agents.find(a => !next.agents.includes(a));
    const closed = closedAgent ? parent(closedAgent) : (view.cpb && !next.cpb) || (view.finance && !next.finance) ? 'system' : '';
    setViewState(next); setFocus(f => ({ id: opened || (next.system ? closed : ''), n: f.n + 1 }));
  };
  const enter = (id: string) => setView(id === 'controller' ? { ...view, controller: true } : { ...view, system: true, cpb: view.cpb || CPB_AGENTS.includes(id), finance: view.finance || id === 'bank', agents: view.agents.includes(id) ? view.agents : [...view.agents, id] });
  if (error) return <div role="alert" className="notice bad">{error}</div>;
  if (!map) return <section className="panel"><p className="muted">Loading the model map…</p></section>;
  return <section className="panel map-panel">
    <div className="map-head"><div className="row">
      <button className="ghost" onClick={() => setFocus(f => ({ id: '', n: f.n + 1 }))}><Maximize2 size={14}/> Whole model</button>
      <button className="ghost" disabled={!view.system && !view.controller} onClick={() => setView(CLOSED)}><Minus size={14}/> Collapse all</button>
    </div>
      <div className="segmented small" role="group" aria-label="Feedback"><button className={!scenario.feedback ? 'active' : ''} aria-pressed={!scenario.feedback} onClick={() => setFeedback(false)}>Open loop</button><button className={scenario.feedback ? 'active' : ''} aria-pressed={scenario.feedback} onClick={() => setFeedback(true)}>Closed loop</button></div>
      {result ? <label className="year-slider">Values in <output>{result.year[at].toFixed(1)}</output><input type="range" aria-label="Year for the values on the map" min={0} max={result.year.length - 1} value={at} onChange={e => setIndex(Number(e.target.value))}/></label> : <button className="primary" disabled={busy} onClick={run}>Run to show values</button>}</div>
    <div className="map-body">
      <div className="map-canvas" ref={canvasRef} onClick={() => setMenuAt(null)}><ReactFlowProvider><Canvas map={map} view={view} setView={setView} scenario={scenario} result={result} at={at} selection={selection} select={setSelection} focus={focus} menu={openMenu}/></ReactFlowProvider>
        {menuAt && <div className="ctx-menu" role="menu" style={{ left: menuAt.x, top: menuAt.y }} onClick={e => e.stopPropagation()}>
          <p>{labelOf(menuAt.target)}</p>
          <button role="menuitem" disabled={menuAt.target.kind === 'element' && !/^(I|V)/.test(menuAt.target.id) || (menuAt.target.kind === 'signal' && !menuAt.target.id.startsWith('d_'))} onClick={() => choose('input')}>Use as input</button>
          <button role="menuitem" disabled={menuAt.target.kind === 'signal' && menuAt.target.id.startsWith('d_')} onClick={() => choose('output')}>Use as output</button>
          <button role="menuitem" onClick={() => { setSelection(menuAt.target); setMenuAt(null); }}>Plot over time</button>
        </div>}
        <div className="map-key"><span className="k money">Money port pair</span><span className="k real">Goods port pair</span><span className="k shock">d: shock</span><span className="k policy">u: subsidy</span><span className="muted">f: flow, e: incentive. Click + or a block to open it in place. Right-click two flows for a transfer function.</span></div>
      </div>
      <aside className="inspector" aria-live="polite"><Inspector map={map} selection={selection} pick={setSelection} result={result} pinned={pinned} scenario={scenario} enter={enter} layer="" tf={tf} setTf={setTf}/></aside>
    </div>
  </section>;
}

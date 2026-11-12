import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MousePointerClick, X } from 'lucide-react';
import type { Scenario } from './types';
import type { Probe } from './ModelMap';
import { CPB_PEAKS, FLAT, GROWTH, NO_SUBSIDY, ONE_STEP, PHASE, QUIET, SHOCKS_CBS, TREND_TARGET } from './Tour';

// Guided tour (Jesse, 12 Nov 2026): takes a visitor by the hand on the canvas. Each step is a short story; each
// sub-step points at one thing to click (pulsing ring + speech bubble) and moves on once the click has happened.
// "Show me" does the click. Everything happens on the canvas: the scenario panel stays closed.
// The presenter tour (Tour.tsx) is the same story without the hand-holding, for the slides.

/** What the canvas reports to the guide after every change (ModelMap → App). */
export type Snap = { n: number; playing: boolean; finance: boolean; agents: string[]; system: boolean; cpb: boolean; controller: boolean; formulas: boolean; hl: string | null; pins: string[]; charts: string[]; plays: number; stepping: boolean; sel: string; stepInput: string; showZn: boolean };
export type GState = { snap: Snap; s: Scenario; runs: number };
/** One-off canvas commands from the guide (App → ModelMap). */
export type GuideCmd = { n: number; fit?: boolean; focus?: string; view?: { system?: boolean; cpb?: boolean; finance?: boolean; formulas?: boolean; controller?: boolean; agents?: string[] }; stepInput?: string; dock?: boolean };
type Sub = {
  target?: string; text: string;
  side?: boolean;                               // bubble beside the target (left or right), not above or below
  opt?: string;                                 // inside the target (an open picker): ring this option
  avoid?: string;                               // keep the bubble off this block too (e.g. the agent around a + button)
  done?: (g: GState, b: GState) => boolean;     // the click has happened (b: the state when this sub-step began)
  show?: { click?: string; patch?: Partial<Scenario>; cmd?: Omit<GuideCmd, 'n'> };
  enter?: Omit<GuideCmd, 'n'>;                  // canvas command when the sub-step begins
  cont?: boolean;                               // no click to wait for: a Continue button
};
export type GuideStep = { title: string; goal: string; setup: Partial<Scenario>; pins: Probe[]; robustOnly?: boolean; compare?: boolean; cbs?: boolean; compareOpen?: boolean; rejectSize?: boolean; zn?: boolean; cpbOverlay?: boolean; subs: Sub[]; end?: string };  // no end: straight on to the next step

// Canvas targets (CSS selectors)
const node = (id: string) => `.react-flow__node[data-id="${id}"]`, edge = (id: string) => `.react-flow__edge[data-id="${id}"] .rail-hit`;
const T = {
  market: node('system'), households: `${node('households')} .formulas .eq`, anyEq: '.react-flow__node .formulas', cbs: node('sensor'), ctrl: node('controller'),
  u: edge('u2'), y: edge('yout'), play: 'button.play', loop: '.loop-switch', kpUp: '[aria-label="kp up"]', card: '.pin-card',
  chipSub: '[data-guide="chip-subsidy"]', chipIncome: '[data-guide="chip-income"]', chipShocks: '[data-guide="chip-shocks"]', chipBank: '[data-guide="chip-bank"]', chipCtrl: '[data-guide="chip-controller"]',
  ident: '[data-guide="ident"]', robust: '[data-guide="robust"]', stepMode: '[data-guide="plot-step"]', zn: '[data-guide="zn-compare"]', dock: '.inspector:not(.left-dock)',
};
const played = (g: GState, b: GState) => g.snap.plays > b.snap.plays && !g.snap.playing;  // after the playback has finished
const pinned = (key: string) => (g: GState) => g.snap.pins.includes(key);
const PLAY = (text: string): Sub => ({ target: T.play, text, done: played, show: { click: T.play } });
const price: Probe = { flow: 'y_price', q: 's' }, subsidy: Probe = { flow: 'owner_subsidy', q: 's' }, income: Probe = { flow: 'd_income', q: 's' }, yoy: Probe = { flow: 'y_yoy', q: 's' };
const START = { ...QUIET, ...FLAT, ...NO_SUBSIDY };
// Closed-loop steps: the target is the trend of the fitted price (flat in real terms) and the fitted 4.47% inflation is
// added on the year-on-year card. (A target growing 2.5% a year was tried on 11 Nov and dropped on 12 Nov: the rule
// then needed a subsidy of about 250 by 2025.)
const LOOP = { ...SHOCKS_CBS, ...TREND_TARGET, feedback: false, controller: 'zn', equilibrium_start: true } as Partial<Scenario>;

export const GUIDE: GuideStep[] = [
  { title: 'The market as a circuit', goal: 'See how the model is built.', setup: START, pins: [], subs: [
    { target: T.market, text: 'Money flows from the Tax Authority into the Housing Market as a subsidy; CBS measures the house price that comes out. Click the Housing Market to open it.', done: g => g.snap.system, show: { click: T.market } },
    { target: `${node('households')} button.toggle`, enter: { view: { system: true, cpb: true, formulas: true } }, text: 'Inside: the CPB model, its agents in four quadrants, each with its CPB equations. Open Households down to its elements, the breadboard: click + on Households.', done: g => g.snap.agents.includes('households'), show: { click: `${node('households')} button.toggle` } },
    { target: T.households, text: 'Every element here belongs to a CPB equation. Click the Utility equation: the flows and elements it describes light up, with a short explanation.', done: g => !!g.snap.hl, show: { click: T.households } },
    { text: 'Click the other equations, Budget and Subsidy, to see what each one describes. Scroll to zoom, drag to move the canvas; Whole model (toolbar, top left) shows everything again. Continue when you are ready.', cont: true },
  ] },
  { title: 'One push on the subsidy', goal: 'Raise the subsidy once and watch the market respond.', setup: START, pins: [subsidy, price], subs: [
    { target: T.chipSub, opt: 'One step', text: 'Open “Subsidy path” under the Tax Authority and choose One step: from 0 to 20 in 2005.', done: (g, b) => g.s.subsidy_path === 'step', show: { patch: ONE_STEP } },
    PLAY('Press ▶. The price overshoots, turns and settles: the market’s own dynamics.'),
    { target: T.ident, text: 'More analysis sits in the side panel: click Identify system for the market’s poles and its step response. Change the adjustment time or the cycle there to see other dynamics.', done: g => g.snap.sel === 'ident:', show: { click: T.ident } },
    { target: T.dock, text: 'Top: the poles of the market, each cross one of its own movements. Further left: it dies out faster; higher up: a shorter cycle. The green pair dominates the price. Below: the price after a subsidy of +1, with when it peaks, when it reaches its trough and the full adjustment time, summed up under the plot.', cont: true },
    { target: T.dock, text: 'These can be changed: under “Change the model”, type another full adjustment time (and, if you like, a cycle), tick the circuit values that may change and press Fit parameters. The new market shows blue dashed; “Use in the simulation” keeps it. Close the panel with − when you are done.', cont: true },
  ] },
  { title: 'A growing economy', goal: 'The same push, now on a trend.', setup: { ...START, ...ONE_STEP }, pins: [income, subsidy, price], subs: [
    { target: T.chipIncome, opt: 'Grows 2% a year', text: 'Open “Income” under the Housing Market and choose Grows 2% a year.', done: (g, b) => g.s.income_path === 'stable' && g.s.income_growth_pct === 2, show: { patch: GROWTH } },
    PLAY('Press ▶. The subsidy step still shows against the trend.'),
  ] },
  { title: 'Phase out a subsidy', goal: 'Remove a subsidy of 30 between 2005 and 2015: in many small steps or in a few big ones?', setup: { ...START, ...GROWTH, ...ONE_STEP }, pins: [income, subsidy, price], compare: true, subs: [
    { target: T.chipSub, opt: 'Phase-out', text: 'Open “Subsidy path” and choose Phase-out. A “Steps” slider appears next to it, starting at 20 small steps.', done: (g, b) => g.s.subsidy_path === 'staircase', show: { patch: PHASE(20) } },
    PLAY('Press ▶. Each step is small, so the price glides.'),
    { target: T.chipSub, opt: 'steps', text: 'Now the same cut in 3 big steps: set the “Steps” slider to 3. The previous run stays on the plots, grey dashed.', done: (g, b) => g.s.subsidy_path === 'staircase' && g.s.phase_steps <= 5, show: { patch: PHASE(3) } },
    PLAY('Press ▶. Each big step starts its own cycle.'),
    { target: T.chipSub, opt: 'steps', text: 'Try other numbers on the “Steps” slider: 1 step (one cut) or 10. Each time the previous run stays grey dashed, for comparison.', cont: true },
  ] },
  { title: 'The CPB’s own history', goal: 'Feed the model the historical subsidies, as the CPB did.', setup: { ...START, ...GROWTH, ...PHASE(3) }, pins: [subsidy, price], cpbOverlay: true, subs: [
    { target: T.chipSub, opt: 'CPB history', text: 'Open “Subsidy path” and choose CPB history.', done: g => g.s.subsidy_path === 'historical' && g.s.subsidy_scale === 10, show: { patch: CPB_PEAKS } },
    { target: T.cbs, text: 'Click CBS (right) for the year-on-year price change. Green dashed: the CPB model.', done: g => g.snap.charts.includes('cbs'), show: { click: T.cbs } },
    PLAY('Press ▶ and watch the year-on-year card.'),
    { target: '.pin-card.chart-card.cbs', side: true, enter: { focus: 'cbs-card' }, text: 'In the CPB model (green dashed, one value a year) the price jumps to its new level at once. The circuit adds the market’s own dynamics, found in step 2 with Identify system, so its price moves gradually, with overshoot and cycles. The match with the CBS index (grey bars) is not exact yet, but matching it was never the aim of the original CPB model. Making the model dynamic is not the whole answer; it opens doors. The multiports are modular, so a sector can be added: to follow the year-on-year house price better, the next step adds one, the financial sector.', cont: true },
  ] },
  { title: 'The real world: bank and shocks', goal: 'Add the financial sector and every historical shock.', setup: CPB_PEAKS, pins: [subsidy, price], cbs: true, cpbOverlay: true, subs: [
    { target: T.chipBank, text: 'Switch the bank on (under the Housing Market): mortgages, interest and savings now run through a financial sector.', done: g => g.s.bank, show: { patch: { bank: true } } },
    { target: T.market, text: 'Open the Housing Market to see the new flows: the financial sector sits beside the CPB quadrants, with mortgages, mortgage interest, savings, savings interest and loans to firms.', done: g => g.snap.system, show: { click: T.market } },
    { target: `${node('finance')} button.toggle`, text: 'Open the financial sector down to its elements: click + on Financial sector.', done: g => g.snap.finance, show: { click: `${node('finance')} button.toggle` } },
    { enter: { view: { finance: true, agents: ['bank'] }, focus: 'bank' }, text: 'The bank on the breadboard: mortgages, interest and savings run through its elements, built the same way as the CPB agents. Continue when you are ready.', cont: true },
    { target: T.chipShocks, opt: 'Historical', enter: { fit: true }, text: 'Open “Shocks” and choose Historical: the crisis, Covid, interest rates, mortgage lending and income, fitted to CBS.', done: (g, b) => g.s.crisis_scale > 0 && g.s.mortgage_scale === SHOCKS_CBS.mortgage_scale, show: { patch: SHOCKS_CBS } },
    { target: edge('d_income'), enter: { focus: 'system' }, text: 'Each red arrow is one disturbance entering the market. Click the Income arrow to plot it; the plot fills in when you press ▶.', done: pinned('d_income:s'), show: { click: edge('d_income') } },
    { target: edge('d_interest'), text: 'Now the Mortgage interest rate arrow, at the financial sector.', done: pinned('d_interest:s'), show: { click: edge('d_interest') } },
    { target: edge('d_crisis'), text: 'And the Financial crisis shock (firms). The other red arrows can be clicked in the same way.', done: pinned('d_crisis:s'), show: { click: edge('d_crisis') } },
    { ...PLAY('Press ▶ and compare the model (green) with the CBS index (grey bars).'), enter: { focus: 'cbs-card' } },
  ] },
  { title: 'Close the loop', goal: 'Let a rule set the subsidy from the measured price.', setup: LOOP, pins: [subsidy, yoy], compareOpen: true, subs: [
    { target: T.loop, text: 'Until now the subsidy followed a fixed path, whatever happened to the price: open loop. Closing the loop allows closed-loop feedback: the measured price goes back to the government, so the subsidy can react to what the market does. Click the switch on the feedback line to close it.', done: g => g.s.feedback, show: { click: T.loop } },
    { target: edge('shocks'), text: 'Click the red disturbance arrow (d): all six disturbances open as plots at once.', done: g => g.snap.pins.filter(k => k.startsWith('d_')).length >= 6, show: { click: edge('shocks') } },
    PLAY('Press ▶. The rule now sets the subsidy from the measured price, and the price follows. Grey dashed: history without the rule.'),
    { target: '.pin-card[data-pin="y_yoy:s"]', side: true, enter: { focus: 'card:y_yoy:s' }, text: 'The year-on-year price change in closed loop (green: the subsidy follows the measured price) and in open loop (grey dashed: the historical subsidies, whatever the price does).', cont: true },
    { target: T.ctrl, enter: { fit: true }, text: 'Click the Tax Authority to open the rule. It is a PID controller, tuned with the classic Ziegler–Nichols recipe. It looks at the gap between Parliament’s target price and the measured price, and sets the subsidy from it in three ways: P (proportional) reacts to the gap now; I (integral) to the gap added up over time, so a lasting gap is removed; D (derivative) to how fast the gap changes, so it acts early.', done: g => g.snap.controller, show: { click: T.ctrl } },
    { target: T.kpUp, avoid: T.ctrl, enter: { dock: true }, text: 'Press ▲ on P: each click makes the rule act 20% harder on the gap (more aggressive).', done: (g, b) => g.s.kp !== b.s.kp, show: { click: T.kpUp } },
    { ...PLAY('Press ▶ to run the more aggressive rule.'), enter: { fit: true } },
    { target: '.pin-card[data-pin="y_yoy:s"]', side: true, enter: { focus: 'card:y_yoy:s' }, text: 'The year-on-year price change with the more aggressive rule (green) against the open loop (grey dashed). Try ▼ on P, or I and D, each time followed by ▶.', cont: true },
    { target: T.dock, text: 'For the control details and deeper analysis, look at the side panel: the gains, the root locus with its admissible region, and a search for gains that meet your own limits.', cont: true },
  ] },
  { title: 'Absorb a shock', goal: 'Hit the market with one shock and see what the rule does.', setup: { ...LOOP, feedback: true }, pins: [price, subsidy], cbs: true, rejectSize: true, subs: [
    { target: T.stepMode, text: 'A step is a sudden change in one input that then stays, for example the mortgage interest rate rising by one percentage point and staying there. The step response shows how the market, and the rule, react to it over the following years. Switch the plots to Step response (toolbar).', done: g => g.snap.stepping, show: { click: T.stepMode } },
    { target: T.chipShocks, opt: 'd_interest', text: 'Open “Step in” under the Housing Market and choose Mortgage interest rate: a rise of one percentage point.', done: g => g.snap.stepInput === 'd_interest', show: { cmd: { stepInput: 'd_interest' } } },
    PLAY('Press ▶. Solid: with the rule. Grey dashed: the same shock without it.'),
    { target: T.chipShocks, text: 'Pick another shock, such as the financial crisis, and press ▶ to compare.', done: (g, b) => g.snap.stepInput !== b.snap.stepInput, show: { cmd: { stepInput: 'd_crisis' } } },
  ] },
  { title: 'What if the model is wrong?', goal: 'Check the rule against model error.', setup: { ...LOOP, feedback: true }, pins: [price, subsidy], robustOnly: true, subs: [
    { target: T.robust, text: 'Click Robustness (toolbar): S, T and KS of the rule against their limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
    { target: T.dock, text: 'S: shock rejection. T: robustness to model error. KS: policy effort. Ziegler–Nichols crosses the shaded limits: fast, but it trusts the model too much and pushes hard.', cont: true },
  ] },
  { title: 'A robust rule: H∞', goal: 'Replace the fast rule with one designed for model error.', setup: { ...LOOP, feedback: true }, pins: [subsidy, yoy], compareOpen: true, zn: true, subs: [
    { target: T.chipCtrl, opt: 'hinf', text: 'H∞ (H-infinity) designs the rule for the worst case. Ziegler–Nichols tunes for the model as it is; H∞ chooses the gains so the loop still behaves when the model is wrong (here: every circuit value off by up to ±20%), while it still damps shocks and does not push the subsidy too hard. It is again a PID, only with other gains. Switch the rule to H∞ (under the Tax Authority).', done: (g, b) => g.s.controller === 'hinf', show: { patch: { controller: 'hinf' } } },
    PLAY('Press ▶. Grey dashed: history without a rule.'),
    { target: T.robust, text: 'Open Robustness again: H∞ (dark green) next to Ziegler–Nichols (light green dotted). H∞ stays within all three limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
  ], end: 'Calmer, and robust to model error. The canvas is yours: explore on your own.' },
];

// Click a canvas target as a visitor would (React handlers listen to bubbling clicks; the card position uses the pointer).
export function clickTarget(sel: string) {
  const el = document.querySelector(sel) as HTMLElement | SVGElement | null; if (!el) return;
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
}

/** Top bar of the guided tour: the steps, the goal of this one, Back / Next / leave. */
export function GuideBar({ step, go, exit, busy }: { step: number; go: (i: number) => void; exit: () => void; busy: boolean }) {
  const t = GUIDE[step];
  return <div className="tour-bar guide-bar" role="region" aria-label="Guided tour" data-no-shot>
    <div className="tour-steps">{GUIDE.map((x, i) => <button key={i} className={i === step ? 'on' : i < step ? 'done' : ''} disabled={busy} title={x.title} aria-label={`Guide step ${i + 1}: ${x.title}`} onClick={() => go(i)}>{i + 1}</button>)}</div>
    <div className="tour-text"><strong>{step + 1}. {t.title}</strong><span>{t.goal}</span></div>
    <div className="tour-nav"><button className="ghost" disabled={busy || step === 0} onClick={() => go(step - 1)}><ChevronLeft size={15}/> Back</button>
      <button className="ghost" disabled={busy || step === GUIDE.length - 1} onClick={() => go(step + 1)}>Skip step <ChevronRight size={15}/></button>
      <button className="ghost" aria-label="Leave the guided tour" title="Leave the guided tour" onClick={exit}><X size={15}/></button></div>
  </div>;
}

/** Pulsing ring on the target and a speech bubble next to it (fixed to the window, follows the canvas). */
export function Coach({ step, sub, busy, onShow, onContinue, onNext, onExit }: { step: number; sub: number; busy: boolean; onShow: () => void; onContinue: () => void; onNext: () => void; onExit: () => void }) {
  const t = GUIDE[step], s = t.subs[sub], last = step === GUIDE.length - 1;
  const [rect, setRect] = useState<DOMRect | null>(null), [area, setArea] = useState<DOMRect | null>(null);
  // the bubble's own height, so a long text never runs off the bottom (or top) of the window
  const bubble = useRef<HTMLDivElement>(null), [bh, setBh] = useState(220);
  useLayoutEffect(() => { const h = bubble.current?.offsetHeight; if (h && Math.abs(h - bh) > 2) setBh(h); });
  useEffect(() => {
    const sel = s?.target; if (!sel) { setRect(null); setArea(null); return; }
    // every frame, so the ring stays on the target while the canvas moves; an open picker menu counts as part of it
    let raf = 0, last = '';
    const measure = () => {
      const el = document.querySelector(sel), o = s?.opt ? el?.querySelector(`[data-opt="${s.opt}"]`)?.getBoundingClientRect() : null;
      const r = el?.getBoundingClientRect(), m = el?.querySelector('.chip-menu')?.getBoundingClientRect();
      const u = r && m ? new DOMRect(Math.min(r.left, m.left), Math.min(r.top, m.top), Math.max(r.right, m.right) - Math.min(r.left, m.left), Math.max(r.bottom, m.bottom) - Math.min(r.top, m.top)) : r;
      const ok = u && u.width + u.height > 0 && u.bottom > 0 && u.top < window.innerHeight ? u : null, k = ok ? [ok.left, ok.top, ok.width, ok.height].map(Math.round).join() : '';
      // the bubble keeps off the target and, when set, the block around it
      const a = s?.avoid ? document.querySelector(s.avoid)?.getBoundingClientRect() : null;
      const v = ok && a ? new DOMRect(Math.min(ok.left, a.left), Math.min(ok.top, a.top), Math.max(ok.right, a.right) - Math.min(ok.left, a.left), Math.max(ok.bottom, a.bottom) - Math.min(ok.top, a.top)) : ok;
      const kk = k + (v ? [v.left, v.top, v.width, v.height].map(Math.round).join() : '');
      const ringAt = o && o.width > 0 ? o : ok, k2 = kk + (ringAt ? [ringAt.left, ringAt.top].map(Math.round).join() : '');
      if (k2 !== last) { last = k2; setRect(ringAt); setArea(v); }
      raf = requestAnimationFrame(measure);
    };
    measure(); return () => cancelAnimationFrame(raf);
  }, [s?.target, step, sub]);
  // the bubble can be dragged by its header (out of the way of what you are looking at); a new step resets it
  const [off, setOff] = useState({ x: 0, y: 0 });
  useEffect(() => { setOff({ x: 0, y: 0 }); }, [step]);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const x0 = e.clientX - off.x, y0 = e.clientY - off.y, el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setOff({ x: m.clientX - x0, y: m.clientY - y0 });
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const W = 340, pad = 14, vw = window.innerWidth, vh = window.innerHeight;
  // bubble below the target when there is room, otherwise above it; docked at the bottom when there is no target
  let pos: React.CSSProperties = { left: 24, bottom: 84 };  // no target: out of the way, bottom left
  const box = area ?? rect;
  if (box && s) {
    const left = Math.min(Math.max(box.left + box.width / 2 - W / 2, 12), vw - W - 12);
    const besideL = box.left - W - pad, besideR = box.right + pad, top = Math.max(Math.min(box.top, vh - 260), 12);
    if (s.side && (besideL >= 12 || besideR + W < vw)) pos = { left: besideL >= 12 ? besideL : besideR, top };
    else pos = box.bottom + 200 < vh ? { left, top: box.bottom + pad } : box.top > 220 ? { left, bottom: vh - box.top + pad }
      : { left: box.right + W + pad < vw ? box.right + pad : Math.max(box.left - W - pad, 12), top: Math.max(Math.min(box.top, vh - 240), 12) };
  }
  const fit = (p: React.CSSProperties): React.CSSProperties => {
    const top = typeof p.top === 'number' ? p.top : typeof p.bottom === 'number' ? vh - p.bottom - bh : 12;
    return { left: p.left, top: Math.max(8, Math.min(top, vh - bh - 8)) };
  };
  return <>
    {rect && s?.target && <div className="coach-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}/>}
    <div ref={bubble} className="coach" role="dialog" aria-label="Guided tour hint" style={{ ...fit(pos), width: W, transform: `translate(${off.x}px, ${off.y}px)` }} data-no-shot>
      <div className="coach-head" onPointerDown={drag} title="Drag to move"><MousePointerClick size={15}/><b>Step {step + 1} · {s ? `${sub + 1} of ${t.subs.length}` : 'done'}</b><button className="ghost coach-x" aria-label="Leave the guided tour" onClick={onExit}><X size={14}/></button></div>
      {s ? <p>{s.text}</p> : t.end ? <p><b>{t.end}</b></p> : null}
      <div className="coach-actions">
        {s?.show && <button className="ghost" disabled={busy} onClick={onShow}>Show me</button>}
        {s?.cont && <button className="primary" disabled={busy} onClick={onContinue}>Continue</button>}
        {s && !s.cont && <button className="ghost" disabled={busy} onClick={onContinue} title="Skip this click">Skip</button>}
        {!s && (last ? <button className="primary" onClick={onExit}>Explore on my own</button> : <button className="primary" disabled={busy} onClick={onNext}>Next step <ChevronRight size={15}/></button>)}
      </div>
    </div>
  </>;
}

/** First visit: offer the guided tour. */
export function Welcome({ start, close }: { start: () => void; close: () => void }) {
  return <div className="backdrop"><section className="modal welcome" role="dialog" aria-modal="true" aria-label="Welcome">
    <h2>Housing Policy Lab</h2>
    <p>The Dutch housing market as an electrical circuit, built on the CPB model, and a government rule that steers the house price.</p>
    <p className="muted">New here? The guided tour shows you where to click, one step at a time (about 5 minutes, {GUIDE.length} steps).</p>
    <div className="row"><button className="primary" onClick={start}>Start the guided tour</button><button className="ghost" onClick={close}>Explore on my own</button></div>
  </section></div>;
}

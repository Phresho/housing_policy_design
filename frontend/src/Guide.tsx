import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, MousePointerClick, X } from 'lucide-react';
import type { Scenario } from './types';
import type { Probe } from './ModelMap';
import { CPB_PEAKS, FLAT, GROWTH, NO_SUBSIDY, ONE_STEP, PHASE, QUIET, SHOCKS_CBS, TREND_TARGET } from './Tour';

// Guided tour (Jesse, 12 Nov 2026): takes a visitor by the hand on the canvas. Each step is a short story; each
// sub-step points at one thing to click (pulsing ring + speech bubble) and moves on once the click has happened.
// "Show me" does the click. Everything happens on the canvas: the scenario panel stays closed.
// The presenter tour (Tour.tsx) is the same story without the hand-holding, for the slides.

/** What the canvas reports to the guide after every change (ModelMap → App). */
export type Snap = { n: number; agents: string[]; system: boolean; cpb: boolean; controller: boolean; formulas: boolean; hl: string | null; pins: string[]; charts: string[]; plays: number; stepping: boolean; sel: string; stepInput: string; showZn: boolean };
export type GState = { snap: Snap; s: Scenario; runs: number };
/** One-off canvas commands from the guide (App → ModelMap). */
export type GuideCmd = { n: number; fit?: boolean; view?: { system?: boolean; cpb?: boolean; formulas?: boolean; controller?: boolean; agents?: string[] }; stepInput?: string; dock?: boolean };
type Sub = {
  target?: string; text: string;
  done?: (g: GState, b: GState) => boolean;     // the click has happened (b: the state when this sub-step began)
  show?: { click?: string; patch?: Partial<Scenario>; cmd?: Omit<GuideCmd, 'n'> };
  enter?: Omit<GuideCmd, 'n'>;                  // canvas command when the sub-step begins
  cont?: boolean;                               // no click to wait for: a Continue button
};
export type GuideStep = { title: string; goal: string; setup: Partial<Scenario>; pins: Probe[]; cbs?: boolean; compareOpen?: boolean; rejectSize?: boolean; zn?: boolean; cpbOverlay?: boolean; subs: Sub[]; end: string };

// Canvas targets (CSS selectors)
const node = (id: string) => `.react-flow__node[data-id="${id}"]`, edge = (id: string) => `.react-flow__edge[data-id="${id}"] .rail-hit`;
const T = {
  market: node('system'), households: `${node('households')} .formulas .eq`, anyEq: '.react-flow__node .formulas', cbs: node('sensor'), ctrl: node('controller'),
  u: edge('u2'), y: edge('yout'), play: 'button.play', loop: '.loop-switch', kpUp: '[aria-label="kp up"]', card: '.pin-card',
  chipSub: '[data-guide="chip-subsidy"]', chipIncome: '[data-guide="chip-income"]', chipShocks: '[data-guide="chip-shocks"]', chipBank: '[data-guide="chip-bank"]', chipCtrl: '[data-guide="chip-controller"]',
  ident: '[data-guide="ident"]', robust: '[data-guide="robust"]', stepMode: '[data-guide="plot-step"]', zn: '[data-guide="zn-compare"]', dock: '.inspector:not(.left-dock)',
};
const played = (g: GState, b: GState) => g.snap.plays > b.snap.plays;
const ran = (g: GState, b: GState) => g.runs > b.runs;
const pinned = (key: string) => (g: GState) => g.snap.pins.includes(key);
const PLAY = (text: string): Sub => ({ target: T.play, text, done: played, show: { click: T.play } });
const price: Probe = { flow: 'y_price', q: 's' }, subsidy: Probe = { flow: 'owner_subsidy', q: 's' }, income: Probe = { flow: 'd_income', q: 's' }, yoy: Probe = { flow: 'y_yoy', q: 's' };
const START = { ...QUIET, ...FLAT, ...NO_SUBSIDY };
const LOOP = { ...SHOCKS_CBS, ...TREND_TARGET, feedback: false, controller: 'zn', equilibrium_start: true } as Partial<Scenario>;

export const GUIDE: GuideStep[] = [
  { title: 'The market as a circuit', goal: 'See how the model is built.', setup: START, pins: [], subs: [
    { target: T.market, text: 'Money flows from the Tax Authority into the Housing Market as a subsidy; CBS measures the house price that comes out. Click the Housing Market to open it.', done: g => g.snap.system, show: { click: T.market } },
    { target: T.households, enter: { view: { system: true, cpb: true, formulas: true } }, text: 'Inside: the CPB model, its agents in four quadrants, each with its CPB equations. Click an equation of Households: the flows it describes light up, with a short explanation.', done: g => !!g.snap.hl, show: { click: T.households } },
    { target: `${node('households')} button.toggle`, text: 'Now open Households down to its elements, the breadboard: click + on Households.', done: g => g.snap.agents.includes('households'), show: { click: `${node('households')} button.toggle` } },
    { target: T.anyEq, text: 'Click other equations, on any agent, to see what each one describes. Continue when you are ready.', cont: true },
  ], end: 'Every element of the circuit is one CPB equation.' },
  { title: 'Plot any flow', goal: 'Click a line: its plot stays on the canvas.', setup: START, pins: [], subs: [
    { target: T.u, text: 'Click the owner-occupied subsidy arrow (u): its plot opens and stays on the canvas.', done: pinned('owner_subsidy:s'), show: { click: T.u } },
    { target: T.y, text: 'Click the house price index leaving the market (y): a second plot.', done: pinned('y_price:s'), show: { click: T.y } },
    PLAY('Press ▶ to run the plots through time. Nothing pushes the market yet, so nothing moves.'),
    { target: T.card, enter: { view: { system: true, cpb: true, agents: ['households', 'investors', 'constructors'] } }, text: 'Everything can be plotted: here is the whole Housing Market, every agent open. Click any line or port to plot it. Drag a plot by its title, resize it from its corner, close it with ×.', cont: true },
  ], end: 'Any flow, incentive or signal can be plotted.' },
  { title: 'One push on the subsidy', goal: 'Raise the subsidy once and watch the market respond.', setup: START, pins: [subsidy, price], subs: [
    { target: T.chipSub, text: 'Open “Subsidy path” under the Tax Authority and choose One step: from 0 to 20 in 2005.', done: (g, b) => g.s.subsidy_path === 'step' && ran(g, b), show: { patch: ONE_STEP } },
    PLAY('Press ▶. The price overshoots, turns and settles: the market’s own dynamics.'),
    { target: T.ident, text: 'More analysis sits in the side panel: click Identify system for the market’s poles and its step response. Change the adjustment time or the cycle there to see other dynamics.', done: g => g.snap.sel === 'ident:', show: { click: T.ident } },
    { target: T.dock, text: 'Close the side panel with − when you are done.', cont: true },
  ], end: 'The overshoot comes from the market itself, not from the policy.' },
  { title: 'A growing economy', goal: 'The same push, now on a trend.', setup: { ...START, ...ONE_STEP }, pins: [income, subsidy, price], subs: [
    { target: T.chipIncome, text: 'Open “Income” under the Housing Market and choose Grows 2% a year.', done: (g, b) => g.s.income_path === 'stable' && g.s.income_growth_pct === 2 && ran(g, b), show: { patch: GROWTH } },
    PLAY('Press ▶. The subsidy step still shows against the trend.'),
  ], end: 'Income growth sets the trend; the subsidy moves the price around it.' },
  { title: 'Phase out a subsidy', goal: 'Remove a subsidy of 30 between 2005 and 2015: in many small steps or in a few big ones?', setup: { ...START, ...GROWTH, ...ONE_STEP }, pins: [subsidy, price], subs: [
    { target: T.chipSub, text: 'Open “Subsidy path” and choose Phase-out. It starts at 20 small steps.', done: (g, b) => g.s.subsidy_path === 'staircase' && ran(g, b), show: { patch: PHASE(20) } },
    PLAY('Press ▶. Each step is small, so the price glides.'),
    { target: T.chipSub, text: 'Now the same cut in 3 big steps: open “Subsidy path” and set the slider to 3. The previous run stays on the plots, grey dashed.', done: (g, b) => g.s.subsidy_path === 'staircase' && g.s.phase_steps <= 5 && ran(g, b), show: { patch: PHASE(3) } },
    PLAY('Press ▶. Each big step starts its own cycle.'),
    { target: T.chipSub, text: 'Try other numbers: 1 step (one cut) or 10. Each time the previous run stays grey dashed, for comparison.', cont: true },
  ], end: 'How a subsidy is phased out matters, not only how much is removed.' },
  { title: 'The CPB’s own history', goal: 'Feed the model the historical subsidies, as the CPB did.', setup: { ...START, ...GROWTH, ...PHASE(3) }, pins: [subsidy, price], cpbOverlay: true, subs: [
    { target: T.chipSub, text: 'Open “Subsidy path” and choose CPB history: the historical subsidies, with income scaled so the model’s two peaks fall where the CPB’s do (Claude’s fit).', done: (g, b) => g.s.subsidy_path === 'historical' && g.s.subsidy_scale === 10 && ran(g, b), show: { patch: CPB_PEAKS } },
    { target: T.cbs, text: 'Click CBS (right) for the year-on-year price change. Green dashed: the CPB model.', done: g => g.snap.charts.includes('cbs'), show: { click: T.cbs } },
    PLAY('Press ▶ and compare the two peaks.'),
  ], end: 'The circuit follows the CPB model’s own path.' },
  { title: 'The real world: bank and shocks', goal: 'Add the financial sector and every historical shock.', setup: CPB_PEAKS, pins: [price], cbs: true, cpbOverlay: true, subs: [
    { target: T.chipBank, text: 'Switch the bank on (under the Housing Market): mortgages, interest and savings now run through a financial sector.', done: (g, b) => g.s.bank && ran(g, b), show: { patch: { bank: true } } },
    { target: T.chipShocks, text: 'Open “Shocks” and choose Historical: the crisis, Covid, interest rates, mortgage lending and income, fitted to CBS.', done: (g, b) => g.s.crisis_scale > 0 && g.s.mortgage_scale === SHOCKS_CBS.mortgage_scale && ran(g, b), show: { patch: SHOCKS_CBS } },
    PLAY('Press ▶ and compare the model (green) with the CBS index (grey bars).'),
  ], end: 'History as it was, without a policy rule: the starting point.' },
  { title: 'Close the loop', goal: 'Let a rule set the subsidy from the measured price.', setup: LOOP, pins: [subsidy, yoy], compareOpen: true, subs: [
    { target: T.loop, text: 'Now the loop: CBS sends the measured price back, Parliament compares it with its target, and the Tax Authority sets the subsidy from the gap. Click the switch on the feedback line to close the loop.', done: (g, b) => g.s.feedback && ran(g, b), show: { click: T.loop } },
    PLAY('Press ▶. A PID rule (Ziegler–Nichols tuning) now sets the subsidy. Grey dashed: history without the rule.'),
    { target: T.ctrl, text: 'Click the Tax Authority to open the rule: P reacts to the gap, I to its sum over time, D to its change.', done: g => g.snap.controller, show: { click: T.ctrl } },
    { target: T.kpUp, text: 'Press ▲ on P: each click makes the rule 1.5 times stronger. The canvas runs again at once.', done: (g, b) => g.s.kp !== b.s.kp && ran(g, b), show: { click: T.kpUp } },
    { ...PLAY('Press ▶ to see the effect on the plots. Try ▼, or I and D, too.'), enter: { fit: true } },
  ], end: 'The rule reacts to the gap between the price and its target.' },
  { title: 'Absorb a shock', goal: 'Hit the market with one shock and see what the rule does.', setup: { ...LOOP, feedback: true }, pins: [price, subsidy], cbs: true, rejectSize: true, subs: [
    { target: T.stepMode, text: 'Switch the plots to Step response (toolbar): each plot shows the response to one shock.', done: g => g.snap.stepping, show: { click: T.stepMode } },
    { target: T.chipShocks, text: 'Open “Step in” under the Housing Market and choose Financial crisis shock (firms): one shock of −10.', done: g => g.snap.stepInput === 'd_crisis', show: { cmd: { stepInput: 'd_crisis' } } },
    PLAY('Press ▶. Solid: with the rule. Grey dashed: the same shock without it.'),
    { target: T.chipShocks, text: 'Pick other shocks, such as the interest rate, and compare.', cont: true },
  ], end: 'The rule damps the shock.' },
  { title: 'What if the model is wrong?', goal: 'Check the rule against model error.', setup: { ...LOOP, feedback: true }, pins: [price, subsidy], subs: [
    { target: T.robust, text: 'Click Robustness (toolbar): S, T and KS of the rule against their limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
    { target: T.dock, text: 'S: shock rejection. T: robustness to model error. KS: policy effort. Ziegler–Nichols crosses the shaded limits: fast, but it trusts the model too much and pushes hard.', cont: true },
  ], end: 'Fast is not the same as safe.' },
  { title: 'A robust rule: H∞', goal: 'Replace the fast rule with one designed for model error.', setup: { ...LOOP, feedback: true }, pins: [subsidy, yoy, price], compareOpen: true, zn: true, subs: [
    { target: T.chipCtrl, text: 'Switch the rule to H∞ (under the Tax Authority).', done: (g, b) => g.s.controller === 'hinf' && ran(g, b), show: { patch: { controller: 'hinf' } } },
    PLAY('Press ▶. Grey dashed: history without a rule.'),
    { target: T.zn, text: 'Click “⋯ Ziegler–Nichols PID” (toolbar) to add the fast rule, light green dotted.', done: g => g.snap.showZn, show: { click: T.zn } },
    { target: T.robust, text: 'Open Robustness again: H∞ stays within all three limits.', done: g => g.snap.sel === 'robust:', show: { click: T.robust } },
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
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const sel = s?.target; if (!sel) { setRect(null); return; }
    // every frame, so the ring stays on the target while the canvas moves; an open picker menu counts as part of it
    let raf = 0, last = '';
    const measure = () => {
      const el = document.querySelector(sel), r = el?.getBoundingClientRect(), m = el?.querySelector('.chip-menu')?.getBoundingClientRect();
      const u = r && m ? new DOMRect(Math.min(r.left, m.left), Math.min(r.top, m.top), Math.max(r.right, m.right) - Math.min(r.left, m.left), Math.max(r.bottom, m.bottom) - Math.min(r.top, m.top)) : r;
      const ok = u && u.width + u.height > 0 && u.bottom > 0 && u.top < window.innerHeight ? u : null, k = ok ? [ok.left, ok.top, ok.width, ok.height].map(Math.round).join() : '';
      if (k !== last) { last = k; setRect(ok); }
      raf = requestAnimationFrame(measure);
    };
    measure(); return () => cancelAnimationFrame(raf);
  }, [s?.target, step, sub]);
  const W = 340, pad = 14, vw = window.innerWidth, vh = window.innerHeight;
  // bubble below the target when there is room, otherwise above it; docked at the bottom when there is no target
  let pos: React.CSSProperties = { left: vw / 2 - W / 2, bottom: 84 };
  if (rect && s) {
    const left = Math.min(Math.max(rect.left + rect.width / 2 - W / 2, 12), vw - W - 12);
    pos = rect.bottom + 200 < vh ? { left, top: rect.bottom + pad } : rect.top > 220 ? { left, bottom: vh - rect.top + pad }
      : { left: rect.right + W + pad < vw ? rect.right + pad : Math.max(rect.left - W - pad, 12), top: Math.max(rect.top, 12) };
  }
  return <>
    {rect && s && <div className="coach-ring" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}/>}
    <div className="coach" role="dialog" aria-label="Guided tour hint" style={{ ...pos, width: W }} data-no-shot>
      <div className="coach-head"><MousePointerClick size={15}/><b>Step {step + 1} · {s ? `${sub + 1} of ${t.subs.length}` : 'done'}</b><button className="ghost coach-x" aria-label="Leave the guided tour" onClick={onExit}><X size={14}/></button></div>
      <p>{s ? s.text : <><b>{t.end}</b></>}</p>
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
    <p className="muted">New here? The guided tour shows you where to click, one step at a time (about 10 minutes, 11 steps).</p>
    <div className="row"><button className="primary" onClick={start}>Start the guided tour</button><button className="ghost" onClick={close}>Explore on my own</button></div>
  </section></div>;
}

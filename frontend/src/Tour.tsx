import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Scenario } from './types';
import type { Probe } from './ModelMap';

// Guided tour for economists (supervisor, 7 Nov 2026): start from an empty market and add one thing per step.
// Step sizes, years and the feedback target are Claude's choices. Every step starts from the site's start values.
const QUIET: Partial<Scenario> = { bank: false, crisis_scale: 0, covid_scale: 0, crisis_w: false, rental_subsidy: false, share_control: false, feedback: false, param_scale: {}, subsidy_path: 'historical', subsidy_scale: 1 };
// The "Fitted to CBS" inputs (also the preset button in the left column): open loop, bank on, all shocks.
// The "CPB fit (peaks)" inputs (also the preset button): the CPB structure with its own path, Claude's fit to the two
// CPB peaks and the level (5 Nov 2026): income x0.10 growing 5% a year, historical subsidies x10.
export const CPB_PEAKS: Partial<Scenario> = { feedback: false, bank: false, crisis_scale: 0, covid_scale: 0, income_path: 'stable', income_growth_pct: 5, income_scale: 0.1, subsidy_scale: 10, subsidy_path: 'historical', rental_subsidy: false, inflation_pct: 0, mortgage_scale: 1, mortgage_shift_yr: 0, interest_scale: 1, interest_shift_yr: 0, interest_new_share: 0.1 };
export const FITTED_CBS: Partial<Scenario> = { mortgage_scale: 4.86, mortgage_shift_yr: 2.39, interest_scale: 0.27, interest_shift_yr: 0, interest_new_share: 0.1, inflation_pct: 4.47, covid_on_yr: 1.06, covid_fall_yr: 0.22,
  feedback: false, subsidy_path: 'historical', share_control: false, subsidy_scale: 1, rental_subsidy: true, income_path: 'historical', income_scale: 1, income_growth_pct: 1.53, bank: true, crisis_scale: 2, covid_scale: 1, crisis_start_yr: 2011.1, crisis_w: false, reference_base: 120, target_growth_pct: 0.9 };
// Stable growth path: income starts at 80 (the historical start 259.056 scaled) and grows 2% a year (Jesse, 10 Nov 2026).
const INCOME_START = 80;
const GROWTH: Partial<Scenario> = { income_path: 'stable', income_growth_pct: 2, income_scale: INCOME_START / 259.056 };
const FLAT: Partial<Scenario> = { income_path: 'stable', income_growth_pct: 0, income_scale: 1 };
const STEP: Partial<Scenario> = { subsidy_path: 'step', subsidy_base: 0, subsidy_step: 20, subsidy_step_yr: 2005 };
export type TourStep = { title: string; text: string; patch: Partial<Scenario>; pins: Probe[]; ident?: boolean; tuning?: boolean; compare?: boolean; cbs?: boolean; expand?: boolean; formulas?: boolean; reject?: string; robust?: boolean; keepGains?: boolean; cpbOverlay?: boolean; carry?: Partial<Scenario> };
const price: Probe = { flow: 'y_price', q: 's' }, subsidy: Probe = { flow: 'owner_subsidy', q: 's' }, income: Probe = { flow: 'd_income', q: 's' }, yoy: Probe = { flow: 'y_yoy', q: 's' };
export const TOUR: TourStep[] = [
  { title: 'The backbone: the CPB model', text: 'The circuit is built on the CPB housing-market model (Groot & Möhlmann, 2020): the four quadrants of DiPasquale and Wheaton. Each agent carries its CPB equations (numbers refer to the CPB document): click one to light up the flows and elements it describes. Open an agent with + to see its elements; the equations stay above them. No shocks, no subsidy, constant income, no bank: nothing pushes the market, so the price stays where it is.',
    patch: { ...QUIET, ...FLAT, subsidy_scale: 0 }, pins: [{ flow: 'y_price', q: 's' }], formulas: true },
  { title: 'One step on the governor', text: 'The Tax Authority raises the subsidy once, from 0 to 20 in 2005; nothing else moves. The price overshoots, turns and settles: the market’s own dynamics. The side panel (right) holds its poles and step response; change the full adjustment or the cycle there to see other dynamics. Click a line to plot it.',
    patch: { ...QUIET, ...FLAT, ...STEP }, pins: [subsidy, price], ident: true },
  { title: 'A stable growth path', text: 'The settings of the previous step stay (including model parameters you fitted there); a stable growth path is added: income starts at 80 and grows 2% a year. The subsidy step of 20 in 2005 still shows against the trend.',
    patch: { ...QUIET, ...GROWTH, ...STEP }, pins: [income, subsidy, price], carry: GROWTH },
  { title: 'Phase-out in 20 small steps', text: 'On the growth path (income from 80, +2% a year), a subsidy of 30 is removed over 10 years (2005–2015) in 20 small steps. Each step is small, so the price glides.',
    patch: { ...QUIET, ...GROWTH, subsidy_path: 'staircase', phase_from: 30, phase_start_yr: 2005, phase_years: 10, phase_steps: 20 }, pins: [subsidy, price] },
  { title: 'Phase-out in 3 big steps', text: 'The same total in 3 steps. Each big step starts its own overshoot: the cycles show.',
    patch: { ...QUIET, ...GROWTH, subsidy_path: 'staircase', phase_from: 30, phase_start_yr: 2005, phase_years: 10, phase_steps: 3 }, pins: [subsidy, price] },
  { title: 'Historical subsidies: the CPB path', text: 'The CPB model’s own historical path (the “CPB fit (peaks)” preset): historical subsidies ×10, income at a tenth growing 5% a year, so the model’s two peaks line up with the CPB’s (click CBS for the year-on-year card, CPB green dashed). Claude’s fit.',
    patch: { ...QUIET, ...CPB_PEAKS }, pins: [subsidy, price], cbs: true, cpbOverlay: true },
  { title: 'Bank and disturbances: the real path', text: 'Now the banking sector and all historical inputs and shocks (crisis, Covid, interest, mortgages, income), fitted to CBS. Click CBS to compare the model’s year-on-year change with the CBS index.',
    patch: { ...FITTED_CBS }, pins: [price], cbs: true },
  { title: 'PID control, tuned by hand', text: 'Same historical set, loop closed with the Ziegler–Nichols PID. Use the arrows on P, I and D in the Tax Authority, or the pole plot in the side panel (right); each change runs at once. Click a line to plot it; grey dashed: the open loop with the historical subsidies.',
    patch: { ...FITTED_CBS, feedback: true, controller: 'zn', equilibrium_start: true }, pins: [subsidy, yoy], tuning: true, compare: true },
  { title: 'Disturbance rejection', text: 'The PID from the previous step (its gains carry over), hit by one unit shock: the financial crisis by default; pick another shock, such as the interest rate, in the side panel (right). Click the price or the subsidy to plot its step response with the controller; grey dashed: the same shock without it. Linear model, loop closed.',
    patch: { ...FITTED_CBS, feedback: true, controller: 'zn', equilibrium_start: true }, pins: [price, subsidy], reject: 'd_crisis', keepGains: true },
  { title: 'H∞ control', text: 'Same historical set with the bank, now the robust H∞ PID. Click a line to plot it (grey dashed: the open loop with the historical subsidies; the “⋯ Ziegler–Nichols PID” button in the toolbar adds the fast PID, dotted). The side panel (right): robustness (S, T, KS against their limits, random markets) and the Nyquist plot with gain and phase margin.',
    patch: { ...FITTED_CBS, feedback: true, controller: 'hinf', equilibrium_start: true }, pins: [subsidy, yoy, price], compare: true, robust: true },
];

export function TourBar({ step, go, exit, busy }: { step: number; go: (i: number) => void; exit: () => void; busy: boolean }) {
  const t = TOUR[step];
  return <div className="tour-bar" role="region" aria-label="Guided tour">
    <div className="tour-steps">{TOUR.map((x, i) => <button key={i} className={i === step ? 'on' : i < step ? 'done' : ''} disabled={busy} title={x.title} aria-label={`Step ${i + 1}: ${x.title}`} onClick={() => go(i)}>{i + 1}</button>)}</div>
    <div className="tour-text"><strong>{step + 1}. {t.title}</strong><span>{t.text}</span></div>
    <div className="tour-nav"><button className="ghost" disabled={busy || step === 0} onClick={() => go(step - 1)}><ChevronLeft size={15}/> Back</button>
      <button className="primary" disabled={busy || step === TOUR.length - 1} onClick={() => go(step + 1)}>Next <ChevronRight size={15}/></button>
      <button className="ghost" aria-label="Leave the tour" title="Leave the tour" onClick={exit}><X size={15}/></button></div>
  </div>;
}

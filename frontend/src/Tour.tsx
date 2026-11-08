import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Scenario } from './types';
import type { Probe } from './ModelMap';

// Guided tour for economists (supervisor, 7 Nov 2026): start from an empty market and add one thing per step.
// Step sizes, years and the feedback target are Claude's choices. Every step starts from the site's start values.
const QUIET: Partial<Scenario> = { bank: false, crisis_scale: 0, covid_scale: 0, crisis_w: false, rental_subsidy: false, share_control: false, feedback: false, param_scale: {}, subsidy_path: 'historical', subsidy_scale: 1 };
// Low growth (0.3% a year), so a subsidy change stands out against the trend (Jesse, 8 Nov 2026).
const GROWTH: Partial<Scenario> = { income_path: 'stable', income_growth_pct: 0.3, income_scale: 1 };
const FLAT: Partial<Scenario> = { income_path: 'stable', income_growth_pct: 0, income_scale: 1 };
export type TourStep = { title: string; text: string; patch: Partial<Scenario>; pins: Probe[]; ident?: boolean };
const price: Probe = { flow: 'y_price', q: 's' }, subsidy: Probe = { flow: 'owner_subsidy', q: 's' }, income: Probe = { flow: 'd_income', q: 's' };
export const TOUR: TourStep[] = [
  { title: 'An empty market', text: 'No shocks, no subsidy, constant income, no bank (the CPB model). Nothing pushes the market: the price stays where it is.',
    patch: { ...QUIET, ...FLAT, subsidy_scale: 0 }, pins: [price] },
  { title: 'One step on the governor', text: 'The Tax Authority raises the subsidy once, from 0 to 10 in 2005; nothing else moves. The price overshoots, turns and settles: the market’s own dynamics. Right: its poles and step response (+1 in the subsidy).',
    patch: { ...QUIET, ...FLAT, subsidy_path: 'step', subsidy_base: 0, subsidy_step: 10, subsidy_step_yr: 2005 }, pins: [subsidy, price], ident: true },
  { title: 'A stable growth path', text: 'Income grows 0.3% a year, no subsidy. The price follows slowly and smoothly: a steady push gives no cycles.',
    patch: { ...QUIET, ...GROWTH, subsidy_scale: 0 }, pins: [income, price] },
  { title: 'Phase-out in 20 small steps', text: 'On the growth path, a subsidy of 30 is removed over 10 years (2005–2015) in 20 small steps. Each step is small, so the price glides.',
    patch: { ...QUIET, ...GROWTH, subsidy_path: 'staircase', phase_from: 30, phase_start_yr: 2005, phase_years: 10, phase_steps: 20 }, pins: [subsidy, price] },
  { title: 'Phase-out in 3 big steps', text: 'The same total in 3 steps. Each big step starts its own overshoot: the cycles show.',
    patch: { ...QUIET, ...GROWTH, subsidy_path: 'staircase', phase_from: 30, phase_start_yr: 2005, phase_years: 10, phase_steps: 3 }, pins: [subsidy, price] },
  { title: 'Historical subsidies', text: 'The historical owner-occupied subsidy path of the model, on the same growth path.',
    patch: { ...QUIET, ...GROWTH }, pins: [subsidy, price] },
  { title: 'Feedback', text: 'The loop closes: the Tax Authority (H∞ PID) sets the subsidy from the gap between Parliament’s target (100, +0.3% a year) and the CBS index.',
    patch: { ...QUIET, ...GROWTH, feedback: true, controller: 'hinf', equilibrium_start: true, reference_base: 100, target_growth_pct: 0.3 }, pins: [{ flow: 'y_reference', q: 's' }, subsidy, price] },
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

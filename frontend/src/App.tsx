import { useEffect, useMemo, useState } from 'react';
import { Camera, ChevronRight, Download, FolderOpen, GitCompare, LoaderCircle, Pin, Play, RotateCcw, Save, X } from 'lucide-react';
import { api } from './api';
import { savePng } from './shot';
import { Chart, type Line } from './Chart';
import { ModelMap } from './ModelMap';
import { TOUR, TourBar } from './Tour';
import { Robustness, type Design } from './Analysis';
import type { Catalogue, ControllerKey, Kpis, Result, SavedRow, Scenario } from './types';

const GREEN = '#3f9a1f', BLUE = '#1f6fc4', GREY = '#8a9692', INK = '#1f2a26', AMBER = '#b9770e';
const num = (v: number, d = 2) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const key = (s: Scenario) => { const { name: _ignored, ...rest } = s; return JSON.stringify(rest); };
const SHOCKS = ['interest_scale', 'income_scale', 'mortgage_scale', 'crisis_scale', 'covid_scale'] as const;

// Foldable group in the left column: arrow, title, one-line summary of the setting, dot when it differs from the start values.
function Group({ title, summary, dirty, open, children }: { title: string; summary?: React.ReactNode; dirty?: boolean; open?: boolean; children: React.ReactNode }) {
  return <details className="lgroup" open={open}><summary><ChevronRight className="lg-arrow" size={15}/><span className="lg-title">{title}</span>{dirty && <i className="lg-dirty" title="Changed from the start values"/>}{summary !== undefined && <small className="lg-sum">{summary}</small>}</summary><div className="lg-body">{children}</div></details>;
}
function Slider({ label, hint, value, min, max, step, onChange, format }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return <label className="slider"><span className="slider-head"><span>{label}</span><output>{format(value)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))}/>{hint && <small>{hint}</small>}</label>;
}
const times = (v: number) => `× ${num(v)}`;
const yrs = (v: number) => `${v > 0 ? '+' : ''}${num(v, 1)} yr`;

function runLabel(s: Scenario, c: Catalogue) {
  if (!s.feedback) return s.subsidy_scale === 1 ? 'Open loop · historical subsidies' : `Open loop · subsidies × ${num(s.subsidy_scale)}`;
  return `Closed loop · ${c.presets[s.controller]?.label ?? 'Custom PID'}${s.share_control ? ' + rental share loop' : ''}`;
}

function Kpi({ label, value, unit, other, note }: { label: string; value: number; unit: string; other?: number; note?: string }) {
  return <div className="kpi"><span>{label}</span><strong>{num(value)}<em>{unit}</em></strong>{other !== undefined ? <small>Comparison: {num(other)}{unit}</small> : note ? <small>{note}</small> : null}</div>;
}

export default function App() {
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [s, setS] = useState<Scenario>();
  const [robust, setRobust] = useState(false);
  type FitResult = { inputs: Partial<Scenario>; before: { rmse: number; corr: number; inflation_pct: number }; after: { rmse: number; corr: number; inflation_pct: number; model_std: number; data_std: number }; note: string };
  const [fitting, setFitting] = useState(false), [fitRes, setFitRes] = useState<FitResult | null>(null), [fixInfl, setFixInfl] = useState<number | null>(null);
  const fitToCbs = async () => {
    if (!s) return; setFitting(true); setError('');
    try { const r = await api<FitResult>('/fit', { scenario: s, inflation_pct: fixInfl }); setFitRes(r); update(r.inputs); setNotice('Inputs fitted to CBS. Run the simulation to see them.'); }
    catch (e) { setError((e as Error).message); } finally { setFitting(false); }
  };
  const [result, setResult] = useState<Result | null>(null);
  const [pinned, setPinned] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [library, setLibrary] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [showResults, setShowResults] = useState(() => { try { return localStorage.getItem('hpl.results') === 'open'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('hpl.results', showResults ? 'open' : 'closed'); } catch { /* storage blocked */ } }, [showResults]);
  const [cbs, setCbs] = useState<{ year: number[]; yoy: number[]; lag_months: number; corr: number; corr_zero: number; source: string }>();
  const [lag, setLag] = useState<number | null>(null);
  const [cpb, setCpb] = useState<{ year: number[]; yoy: number[]; source: string }>();
  const [showCpb, setShowCpb] = useState(false);
  const [cpbScale, setCpbScale] = useState(1);
  const [cpbShift, setCpbShift] = useState(0);  // years the CPB path is moved on the plots (display only)  // display scale of the CPB path (as in the presentation); the CPB fit aims at the scaled path
  const cpbShown = cpb && showCpb ? { ...cpb, year: cpb.year.map(y => y + cpbShift), yoy: cpb.yoy.map(v => v * cpbScale) } : undefined;
  type Feat = { peaks: number[]; peak_years: number[]; level: number };
  type CpbFit = { inputs: { income_scale: number; subsidy_scale: number; income_growth_pct: number }; target: { peaks: number[]; level: number }; before: Feat; after: Feat };
  const [cpbFitting, setCpbFitting] = useState(false), [cpbFit, setCpbFit] = useState<CpbFit | null>(null);
  const fitToCpb = async () => {
    if (!s) return; setCpbFitting(true); setError('');
    try { const r = await api<CpbFit>('/fit_cpb', { scenario: s, cpb_scale: cpbScale }); setCpbFit(r); update({ ...r.inputs, feedback: false, income_path: 'stable' }); setNotice('Income and subsidies fitted to the CPB peaks. Run the simulation to see them.'); }
    catch (e) { setError((e as Error).message); } finally { setCpbFitting(false); }
  };
  useEffect(() => { api<NonNullable<typeof cpb>>('/data/cpb').then(setCpb).catch(() => setCpb(undefined)); }, []);  // months the CBS overlay is moved; null = the estimate
  useEffect(() => { api<NonNullable<typeof cbs>>('/data/cbs').then(setCbs).catch(() => setCbs(undefined)); }, []);
  const [design, setDesign] = useState<Design>({ K: [1.131, 0.666, 2.839], filtered: true, settling: 4, overshoot: 25 });
  const refresh = () => api<SavedRow[]>('/scenarios').then(setSaved);
  useEffect(() => { api<Catalogue>('/catalogue').then(c => { setCatalogue(c); setS(c.defaults); }).catch(e => setError(e.message)); refresh().catch(e => setError(e.message)); }, []);
  const stale = !!result && !!s && key(s) !== key(result.scenario);
  const update = (patch: Partial<Scenario>) => { setS(old => old && { ...old, ...patch }); setNotice(''); };
  const guard = async (fn: () => Promise<void>) => { setError(''); setNotice(''); setBusy(true); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const simulate = () => guard(async () => { const r = await api<Result>('/runs', s); setResult(r); setS(r.scenario); });
  // Guided tour: each step loads its scenario (from the start values), runs it and tells the canvas what to show.
  const [tour, setTour] = useState<{ step: number; n: number } | null>(null);
  const goTour = (i: number) => guard(async () => {
    if (!catalogue) return;
    const next = { ...catalogue.defaults, name: `Tour ${i + 1}: ${TOUR[i].title}`, ...TOUR[i].patch } as Scenario;
    setS(next); setPinned(null); const r = await api<Result>('/runs', next); setResult(r); setS(r.scenario);
    setTour(t => ({ step: i, n: (t?.n ?? 0) + 1 }));
  });
  // In the tour, new model parameters (Use in the simulation / Back to the netlist values) run at once, so the
  // canvas shows the new dynamics without pressing Run.
  const paramKey = JSON.stringify(s?.param_scale ?? {});
  useEffect(() => {
    if (tour && result && !busy && paramKey !== JSON.stringify(result.scenario.param_scale ?? {})) void simulate();
  }, [paramKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const both = () => guard(async () => {
    const [open, closed] = await Promise.all([api<Result>('/runs', { ...s, feedback: false }), api<Result>('/runs', { ...s, feedback: true })]);
    setPinned(open); setResult(closed); setS(closed.scenario); setNotice('Showing closed loop against open loop with the same scenario.');
  });
  const save = () => guard(async () => {
    const matching = result && !stale ? result : null;
    await api('/scenarios', { scenario: s, result: matching }); await refresh();
    setNotice(matching ? 'Saved with results.' : 'Inputs saved. Run and save again to include results.');
  });
  const load = (id: string) => guard(async () => {
    const found = await api<{ scenario: Scenario; result: Result | null }>(`/scenarios/${id}`);
    setS(found.scenario); setResult(found.result); setLibrary(false); setNotice(`Opened ${found.scenario.name}.`);
  });
  const exportRun = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), result, comparison: pinned }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'housing-policy-run.json'; a.click(); URL.revokeObjectURL(url);
  };
  const charts = useMemo(() => {
    if (!result || !catalogue) return null;
    const label = runLabel(result.scenario, catalogue);
    const other = pinned ? runLabel(pinned.scenario, catalogue) + ' (comparison)' : '';
    const plus = (r: Result, field: string) => field === 'yoy' && r.scenario.inflation_pct ? r.series.yoy.map(v => v + r.scenario.inflation_pct) : r.series[field];
    const tag = (r: Result, field: string) => field === 'yoy' && r.scenario.inflation_pct ? ` + ${num(r.scenario.inflation_pct, 1)}% inflation/trend` : '';
    const pair = (field: string, color: string): Line[] => [
      ...(pinned ? [{ name: other + tag(pinned, field), x: pinned.year, y: plus(pinned, field), color: GREY, dash: 'dash', width: 2 }] : []),
      { name: label + tag(result, field), x: result.year, y: plus(result, field), color },
    ];
    const target = result.scenario.target_growth_pct;
    const cumulative = (r: Result) => { let sum = 0; return r.series.owner_subsidy.map((u, i) => { if (i) sum += (u + r.series.owner_subsidy[i - 1]) / 2 * (r.year[i] - r.year[i - 1]); return sum; }); };
    return {
      yoy: [...(cpbShown ? [{ name: `CPB model (one value a year${cpbScale !== 1 ? `, × ${num(cpbScale)}` : ''})`, x: [...cpbShown.year, cpbShown.year[cpbShown.year.length - 1] + 1], y: [...cpbShown.yoy, cpbShown.yoy[cpbShown.yoy.length - 1]], color: GREEN, dash: 'dash', width: 2, step: true }] : []), ...(cbs ? [{ name: `CBS house price index${(lag ?? cbs.lag_months) ? `, moved ${lag ?? cbs.lag_months} month${Math.abs(lag ?? cbs.lag_months) === 1 ? '' : 's'}` : ''}`, x: cbs.year.map(y => y + (lag ?? cbs.lag_months) / 12), y: cbs.yoy, color: '#c4c9c6', bar: true }] : []), ...pair('yoy', GREEN), { name: `Target ${num(target, 1)}%`, x: [result.year[0], result.year[result.year.length - 1]], y: [target, target], color: INK, dash: 'dot', width: 1.5 }],
      // With an inflation/trend rate set, the price is also shown in nominal terms: price x (1 + rate)^(years since the start).
      price: [...pair('price', GREEN), ...(result.scenario.inflation_pct ? [{ name: `${label} · nominal (+ ${num(result.scenario.inflation_pct, 1)}% a year)`, x: result.year, y: result.series.price.map((v, i) => v * (1 + result.scenario.inflation_pct / 100) ** (result.year[i] - result.year[0])), color: '#1d6b10', dash: 'dash', width: 2.5 }] : []), { name: 'Target path', x: result.year, y: result.series.reference, color: INK, dash: 'dot', width: 1.5 }],
      subsidy: pair('owner_subsidy', BLUE),
      rental: pair('rental_subsidy', BLUE),
      share: [...pair('rental_share', AMBER), ...(result.scenario.feedback && result.scenario.share_control ? [{ name: `Target ${num(result.scenario.share_target_pct, 1)}%`, x: [result.year[0], result.year[result.year.length - 1]], y: [result.scenario.share_target_pct, result.scenario.share_target_pct], color: INK, dash: 'dot', width: 1.5 }] : [])],
      cumulative: [...(pinned ? [{ name: other, x: pinned.year, y: cumulative(pinned), color: GREY, dash: 'dash', width: 2 }] : []), { name: label, x: result.year, y: cumulative(result), color: BLUE }],
      pair,
    };
  }, [result, pinned, catalogue, cbs, lag, cpb, showCpb, cpbScale, cpbShift]);
  if (!s || !catalogue) return <main className="startup"><h1>Housing Policy Lab</h1><p>{error || 'Loading…'}</p></main>;
  const label = catalogue.presets[s.controller]?.label ?? 'Custom PID';
  // Scenario inputs: in the left dock of the model canvas.
  // true when one of these settings differs from the start values (catalogue defaults)
  const dirty = (keys: (keyof Scenario)[]) => keys.some(k => JSON.stringify(s[k]) !== JSON.stringify(catalogue.defaults[k]));
  const scenarioControls = <>
        <Group title="Presets" summary="Historical, no shocks, CPB, CBS fit" open>
        <div className="chips"><button onClick={() => update({ interest_scale: 1, income_scale: 1, mortgage_scale: 1, crisis_scale: 1, covid_scale: 1, income_path: 'historical', bank: true, mortgage_shift_yr: 0, interest_shift_yr: 0, inflation_pct: 0, interest_new_share: 0.1, covid_on_yr: 2.5, covid_fall_yr: 50 / 6, crisis_start_yr: 2011.46, crisis_w: false, reference_base: 80, target_growth_pct: 2.5 })}>Historical</button><button onClick={() => update({ crisis_scale: 0, covid_scale: 0 })}>No crisis or Covid shock</button><button onClick={() => update({ crisis_scale: 2, covid_scale: 1 })}>Double crisis shock</button><button onClick={() => update({ bank: false })}>Original CPB model (no bank)</button><button title="The CPB model's structure only: open loop, bank off, no crisis or Covid shock, stable income growth 1.53%, historical owner-occupied subsidy, no rental subsidy, inflation/trend 0. CPB path at its own size" onClick={() => { setShowCpb(true); setCpbScale(1); setCpbShift(0); update({ feedback: false, bank: false, crisis_scale: 0, covid_scale: 0, income_path: 'stable', income_growth_pct: 1.53, income_scale: 1, subsidy_scale: 1, rental_subsidy: false, inflation_pct: 0, mortgage_scale: 1, mortgage_shift_yr: 0, interest_scale: 1, interest_shift_yr: 0, interest_new_share: 0.1 }); }}>CPB comparison</button><button title="Claude's fit to the two CPB peaks and the level (5 Nov 2026), CPB structure, CPB path at its own size: income x0.10, historical subsidies x10, income growth 5% a year. All three at their limits. Peaks 8.7 / 7.1 (CPB 9.2 / 9.4), level 0.4 (CPB 2.2)" onClick={() => { setShowCpb(true); setCpbScale(1); setCpbShift(0); update({ feedback: false, bank: false, crisis_scale: 0, covid_scale: 0, income_path: 'stable', income_growth_pct: 5, income_scale: 0.1, subsidy_scale: 10, rental_subsidy: false, inflation_pct: 0, mortgage_scale: 1, mortgage_shift_yr: 0, interest_scale: 1, interest_shift_yr: 0, interest_new_share: 0.1 }); }}>CPB fit (peaks)</button><button title="Claude's least-squares fit to CBS (5 Nov 2026): mortgages ×4.86, 2.39 yr later; Covid shock on 1.06 yr, fading over 0.22 yr; interest rate as in the netlist rule, ×0.27; inflation/trend 4.47%; crisis shock x2 from 2011.1 (RMSE 3.33, correlation 0.88; a W-shaped crisis did not improve it). For feedback runs: reference from 120, growing 0.9% a year (Claude's choice, close to the market's own path), so the subsidy starts near 25 instead of at its -60 limit" onClick={() => { setLag(null); update({
            // the fitted inputs
            mortgage_scale: 4.86, mortgage_shift_yr: 2.39, interest_scale: 0.27, interest_shift_yr: 0, interest_new_share: 0.1, inflation_pct: 4.47, covid_on_yr: 1.06, covid_fall_yr: 0.22,
            // everything else exactly as in the fit: open loop, historical subsidies and income, bank on, all shocks at x1
            feedback: false, share_control: false, subsidy_scale: 1, rental_subsidy: true, income_path: 'historical', income_scale: 1, income_growth_pct: 1.53, bank: true, crisis_scale: 2, covid_scale: 1, crisis_start_yr: 2011.1, crisis_w: false, reference_base: 120, target_growth_pct: 0.9 }); setNotice('All inputs set to the best fit to CBS (open loop). Run the simulation to see it.'); }}>Fitted to CBS</button></div>
        </Group>
        <Group title="Interest rate" summary={`× ${num(s.interest_scale)}, shift ${num(s.interest_shift_yr, 1)} yr`} dirty={dirty(['interest_scale', 'interest_new_share', 'interest_shift_yr'])}><div className="sliders">
          <Slider label="Interest rates" value={s.interest_scale} min={.25} max={3} step={.01} format={times} onChange={v => update({ interest_scale: v })}/>
          <Slider label="Interest rate: share of the new-loan rate" hint="Each step of the effective rate mixes the old rate with the rate on new loans. 0.10 is the netlist (90% old, 10% new); 1.00 uses only the new-loan rate." value={s.interest_new_share} min={.02} max={1} step={.01} format={v => num(v)} onChange={v => update({ interest_new_share: v })}/>
          <Slider label="Interest-rate path, time shift" value={s.interest_shift_yr} min={-4} max={4} step={.1} format={yrs} onChange={v => update({ interest_shift_yr: v })}/>
        </div></Group>
        <Group title="Income" summary={`${s.income_path}, × ${num(s.income_scale)}`} dirty={dirty(['income_path', 'income_growth_pct', 'income_scale'])}><div className="sliders">
          <div className="slider"><span className="slider-head"><span>Income path</span></span>
            <div className="segmented small" role="group" aria-label="Income path"><button className={s.income_path === 'historical' ? 'active' : ''} aria-pressed={s.income_path === 'historical'} onClick={() => update({ income_path: 'historical' })}>Historical</button><button className={s.income_path === 'stable' ? 'active' : ''} aria-pressed={s.income_path === 'stable'} onClick={() => update({ income_path: 'stable' })}>Stable growth</button></div></div>
          {s.income_path === 'stable' && <Slider label="Income growth" hint="From the 1996 value. 1.53% is the average growth of the historical path." value={s.income_growth_pct} min={-2} max={5} step={.01} format={v => `${num(v)}% a year`} onChange={v => update({ income_growth_pct: v })}/>}
          <Slider label="Income" value={s.income_scale} min={0} max={2} step={.01} format={times} onChange={v => update({ income_scale: v })}/>
        </div></Group>
        <Group title="Bank and mortgage lending" summary={s.bank ? `bank on, lending × ${num(s.mortgage_scale)}` : 'bank off (CPB model)'} dirty={dirty(['bank', 'mortgage_scale', 'mortgage_shift_yr'])}><div className="sliders">
          <label className="check"><input type="checkbox" checked={s.bank} onChange={e => update({ bank: e.target.checked })}/> <span><strong>Bank (financial sector)</strong><br/><small className="muted">Off: the original CPB model without a bank. All bank ports carry zero, including mortgage lending, the mortgage interest rate and lending to firms.</small></span></label>
          <Slider label="Mortgage lending" value={s.mortgage_scale} min={0} max={10} step={.05} format={times} onChange={v => update({ mortgage_scale: v })}/>
          <Slider label="Mortgage-lending path, time shift" value={s.mortgage_shift_yr} min={-4} max={4} step={.1} format={yrs} onChange={v => update({ mortgage_shift_yr: v })}/>
        </div></Group>
        <Group title="Financial crisis" summary={`× ${num(s.crisis_scale)} from ${s.crisis_start_yr.toFixed(1)}${s.crisis_w ? ', W-shaped' : ''}`} dirty={dirty(['crisis_scale', 'crisis_start_yr', 'crisis_w', 'crisis_w_start_yr', 'crisis_w_scale', 'crisis_w_on_yr'])}><div className="sliders">
          <Slider label="Financial crisis shock (firms)" value={s.crisis_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ crisis_scale: v })}/>
          <Slider label="Financial crisis shock (firms): starts in" hint="Netlist: 2011.46." value={s.crisis_start_yr} min={2000} max={2020} step={.1} format={v => num(v, 1)} onChange={v => update({ crisis_start_yr: v })}/>
          <label className="check"><input type="checkbox" checked={s.crisis_w} onChange={e => update({ crisis_w: e.target.checked })}/> <span><strong>W-shaped crisis</strong><br/><small className="muted">Adds an earlier dip to the crisis shock: 1-year fall, a time at full depth, 1-year recovery. Depth relative to the main crisis pulse. Claude's addition.</small></span></label>
          {s.crisis_w && <>
            <Slider label="First dip: starts in" value={s.crisis_w_start_yr} min={2000} max={2020} step={.1} format={v => num(v, 1)} onChange={v => update({ crisis_w_start_yr: v })}/>
            <Slider label="First dip: depth" value={s.crisis_w_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ crisis_w_scale: v })}/>
            <Slider label="First dip: time at full depth" value={s.crisis_w_on_yr} min={0} max={5} step={.1} format={v => `${num(v, 1)} yr`} onChange={v => update({ crisis_w_on_yr: v })}/>
          </>}
        </div></Group>
        <Group title="Covid" summary={`× ${num(s.covid_scale)}`} dirty={dirty(['covid_scale', 'covid_on_yr', 'covid_fall_yr'])}><div className="sliders">
          <Slider label="Covid shock" value={s.covid_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ covid_scale: v })}/>
          <Slider label="Covid shock: fully on for" hint="From 2021.5. Netlist: 2.5 years." value={s.covid_on_yr} min={.1} max={5} step={.1} format={v => `${num(v, 1)} yr`} onChange={v => update({ covid_on_yr: v })}/>
          <Slider label="Covid shock: fades out over" hint="Netlist: 8.3 years." value={s.covid_fall_yr} min={.1} max={10} step={.1} format={v => `${num(v, 1)} yr`} onChange={v => update({ covid_fall_yr: v })}/>
        </div></Group>
        <Group title="Compare with data (CPB, CBS)" summary="CPB line, inflation, fits" dirty={dirty(['inflation_pct'])}><div className="sliders">
          {cpb && <label className="check"><input type="checkbox" checked={showCpb} onChange={e => setShowCpb(e.target.checked)}/> <span><strong>Show the CPB model (dashed)</strong><br/><small className="muted">Year-on-year change of the original CPB model, in the year-on-year chart and the CBS card. For a like-for-like comparison: bank off, inflation/trend 0.</small></span></label>}
          {cpb && showCpb && <div className="fit-box"><Slider label="CPB path, time shift" hint="Moves the dashed CPB line on the plots only." value={cpbShift} min={-3} max={3} step={.1} format={yrs} onChange={setCpbShift}/><Slider label="CPB path scale" hint="Display scale of the CPB path, as in the presentation. The CPB fit aims at the scaled path." value={cpbScale} min={.1} max={2} step={.05} format={times} onChange={setCpbScale}/>
            <p className="muted small">Fits the income scale, the historical-subsidy scale and the income growth so the two CPB peaks (about 2000.5 and 2011.5) and the level between them match. Open loop; other settings as set here, so press CPB comparison first. Up to a few minutes.</p>
            <button className="secondary" disabled={cpbFitting || busy} onClick={fitToCpb}>{cpbFitting ? <><LoaderCircle className="spin" size={14}/> Fitting…</> : 'Fit to CPB'}</button>
            {cpbFit && <p className="small">Peaks {cpbFit.before.peaks.map(v => num(v, 1)).join(' / ')} → <b>{cpbFit.after.peaks.map(v => num(v, 1)).join(' / ')}</b> (CPB {cpbFit.target.peaks.map(v => num(v, 1)).join(' / ')}), at {cpbFit.after.peak_years.map(v => num(v, 2)).join(' and ')}; level {num(cpbFit.before.level, 1)} → <b>{num(cpbFit.after.level, 1)}</b> (CPB {num(cpbFit.target.level, 1)}). Income × {num(cpbFit.inputs.income_scale, 3)}, growth {num(cpbFit.inputs.income_growth_pct, 2)}%, subsidies × {num(cpbFit.inputs.subsidy_scale, 3)}.</p>}</div>}
          <Slider label="Inflation / trend (CBS comparison only)" hint="Added to the model's year-on-year change where it is compared with the nominal CBS index. Not in the circuit." value={s.inflation_pct} min={0} max={5} step={.05} format={v => `${num(v)}% a year`} onChange={v => update({ inflation_pct: v })}/>
          <div className="fit-box"><strong>Fit the input paths to CBS</strong>
            <p className="muted small">Least squares on the CBS year-on-year change, open loop, with the full circuit simulation in the loop (can take a minute). Fits mortgage lending (scale, time shift), the interest rate (scale, time shift, share of the new-loan rate) and how long the Covid shock lasts. The housing market itself is not fitted.</p>
            <label className="check"><input type="checkbox" checked={fixInfl !== null} onChange={e => setFixInfl(e.target.checked ? 2 : null)}/> Hold inflation/trend fixed{fixInfl !== null && <> at <input type="number" min={0} max={5} step={.1} value={fixInfl} onChange={e => setFixInfl(Math.min(5, Math.max(0, Number(e.target.value) || 0)))}/> %</>}</label>
            <button className="secondary" disabled={fitting || busy} onClick={fitToCbs}>{fitting ? <><LoaderCircle className="spin" size={14}/> Fitting…</> : 'Fit to CBS'}</button>
            {fitRes && <p className="small">Fit error {num(fitRes.before.rmse)} → <b>{num(fitRes.after.rmse)}</b> points, correlation {num(fitRes.before.corr, 3)} → <b>{num(fitRes.after.corr, 3)}</b>. Mortgages × {num(fitRes.inputs.mortgage_scale ?? 1)}, {yrs(fitRes.inputs.mortgage_shift_yr ?? 0)}; interest × {num(fitRes.inputs.interest_scale ?? 1)}, {yrs(fitRes.inputs.interest_shift_yr ?? 0)}; inflation/trend {num(fitRes.after.inflation_pct)}%.</p>}</div>
        </div></Group>
  </>;
  // Policy inputs: target, open-loop path, controller choice, rental-share loop. In the left dock.
  const policyControls = <>
        <Group title="Subsidies" summary={`rental ${s.rental_subsidy ? 'on' : 'off'}${s.feedback ? '' : `, owner path ${s.subsidy_path === 'historical' ? `× ${num(s.subsidy_scale)}` : s.subsidy_path === 'step' ? 'one step' : 'phase-out'}`}`} dirty={dirty(['rental_subsidy', 'subsidy_scale', 'subsidy_path', 'subsidy_base', 'subsidy_step', 'subsidy_step_yr', 'phase_from', 'phase_start_yr', 'phase_years', 'phase_steps'])} open>
        <label className="check"><input type="checkbox" checked={s.rental_subsidy} onChange={e => update({ rental_subsidy: e.target.checked })}/> <span><strong>Rental subsidy</strong><br/><small className="muted">Historical path: 4 until 2023, then 0. Off: 0 for the whole run.{s.share_control && s.feedback ? ' The rental-share loop still moves money to renters.' : ''}</small></span></label>
        {!s.feedback && <>
          <div className="choices" role="radiogroup" aria-label="Owner-occupied subsidy path">{([['historical', 'Historical'], ['step', 'One step'], ['staircase', 'Phase-out']] as const).map(([id, l]) => <label key={id} className={s.subsidy_path === id ? 'choice active' : 'choice'}><input type="radio" name="subsidy_path" checked={s.subsidy_path === id} onChange={() => update({ subsidy_path: id })}/> {l}</label>)}</div>
          <div className="sliders">
          {s.subsidy_path === 'historical' && <Slider label="Historical subsidy path" hint="1.00 is the path in the netlist, 20.98 to 29.34 model units." value={s.subsidy_scale} min={0} max={10} step={.05} format={times} onChange={v => update({ subsidy_scale: v })}/>}
          {s.subsidy_path === 'step' && <>
            <Slider label="Subsidy before the step" value={s.subsidy_base} min={-60} max={200} step={1} format={v => num(v, 0)} onChange={v => update({ subsidy_base: v })}/>
            <Slider label="Step size" value={s.subsidy_step} min={-100} max={100} step={1} format={v => `${v > 0 ? '+' : ''}${num(v, 0)}`} onChange={v => update({ subsidy_step: v })}/>
            <Slider label="Step in" value={s.subsidy_step_yr} min={1997} max={2024} step={.5} format={v => num(v, 1)} onChange={v => update({ subsidy_step_yr: v })}/></>}
          {s.subsidy_path === 'staircase' && <>
            <Slider label="Subsidy before the phase-out" value={s.phase_from} min={0} max={200} step={1} format={v => num(v, 0)} onChange={v => update({ phase_from: v })}/>
            <Slider label="Phase-out starts in" value={s.phase_start_yr} min={1997} max={2024} step={.5} format={v => num(v, 1)} onChange={v => update({ phase_start_yr: v })}/>
            <Slider label="Phase-out takes" value={s.phase_years} min={.5} max={25} step={.5} format={v => `${num(v, 1)} yr`} onChange={v => update({ phase_years: v })}/>
            <Slider label="Number of steps" value={s.phase_steps} min={1} max={40} step={1} format={v => num(v, 0)} onChange={v => update({ phase_steps: Math.round(v) })}/></>}
          </div></>}
        </Group>
        {s.feedback && <>
        <Group title="Controller" summary={catalogue.presets[s.controller]?.label ?? 'Custom PID'} dirty={dirty(['controller', 'kp', 'ki', 'kd', 'target_growth_pct', 'reference_base', 'equilibrium_start', 'derivative_filter'])} open>
          <div className="choices" role="radiogroup" aria-label="Controller">{(['hinf', 'zn', 'netlist', 'custom'] as ControllerKey[]).map(id => { const p = catalogue.presets[id]; return <label key={id} className={s.controller === id ? 'choice active' : 'choice'}><input type="radio" name="controller" checked={s.controller === id} onChange={() => update(p ? { controller: id, kp: p.kp, ki: p.ki, kd: p.kd, derivative_filter: p.filtered } : { controller: id })}/><strong>{p?.label ?? 'Custom PID'}</strong><small>{p ? `Kp ${p.kp} · Ki ${p.ki} · Kd ${p.kd}${p.filtered ? ' · filtered' : ''}` : 'Set your own gains'}</small></label>; })}</div>
          <div className="sliders">
            <Slider label="Target price growth" value={s.target_growth_pct} min={0} max={6} step={.1} format={v => `${num(v, 1)}% a year`} onChange={v => update({ target_growth_pct: v })}/>
            <Slider label="Reference: level in 1996" hint="Netlist: 80. Start it near the market's own price, or the subsidy is pinned at its lower limit (-60) from the start." value={s.reference_base} min={50} max={130} step={1} format={v => num(v, 0)} onChange={v => update({ reference_base: v })}/>
            {s.controller === 'custom' && <>
              <Slider label="Kp" value={s.kp} min={0} max={15} step={.01} format={v => num(v)} onChange={v => update({ kp: v })}/>
              <Slider label="Ki" value={s.ki} min={.01} max={6} step={.01} format={v => num(v)} onChange={v => update({ ki: v })}/>
              <Slider label="Kd" value={s.kd} min={0} max={10} step={.01} format={v => num(v)} onChange={v => update({ kd: v })}/>
              <label className="check" title="Before t = 0 the market sits on the reference with the subsidy at the level that holds it there; the integrator is pre-charged. Off: the netlist's 5-s soft start."><input type="checkbox" checked={s.equilibrium_start} onChange={e => update({ equilibrium_start: e.target.checked })}/> Start in equilibrium (no start-up transient)</label>
              <label className="check"><input type="checkbox" checked={s.derivative_filter} onChange={e => update({ derivative_filter: e.target.checked })}/> Derivative filter, cycle of 0.5 years</label></>}
          </div>
        </Group>
        <Group title="Second goal: rental share (MIMO)" summary={s.share_control ? `on, target ${num(s.share_target_pct, 1)}%` : 'off'} dirty={dirty(['share_control', 'share_target_pct', 'skp', 'ski', 'skd'])}>
          <div className="mimo-box"><label className="check"><input type="checkbox" checked={s.share_control} onChange={e => update({ share_control: e.target.checked })}/> <strong>Second goal: hold the rental share of housing services</strong></label>
            <p className="muted small">Two inputs, two outputs (MIMO). A second PID moves money from the owner-occupied subsidy to the rental subsidy. Both subsidies push the price equally, so the price loop is hardly disturbed.</p>
            {s.share_control && <div className="sliders">
              <Slider label="Target rental share" hint="Share of housing services used by renters. It starts near 20.5% in closed loop and drifts to about 15% without this loop." value={s.share_target_pct} min={10} max={30} step={.1} format={v => `${num(v, 1)}%`} onChange={v => update({ share_target_pct: v })}/>
              <Slider label="Share Kp" value={s.skp} min={0} max={10} step={.01} format={v => num(v)} onChange={v => update({ skp: v })}/>
              <Slider label="Share Ki" value={s.ski} min={0} max={5} step={.01} format={v => num(v)} onChange={v => update({ ski: v })}/>
              <Slider label="Share Kd" value={s.skd} min={0} max={5} step={.01} format={v => num(v)} onChange={v => update({ skd: v })}/>
              <p className="muted small">Default gains 2.11, 1.17, 1.01: Claude's tuning on the linear model with the H∞ price PID (‖W<sub>P</sub>S; KS/8.2‖ = 1.16, so the requirements are just missed). B4 gain −10, linearised.</p>
            </div>}</div>
        </Group></>}
        <Group title="Model parameters" summary={Object.keys(s.param_scale ?? {}).length ? 'changed' : 'netlist values'} dirty={Object.keys(s.param_scale ?? {}).length > 0} open={Object.keys(s.param_scale ?? {}).length > 0}>
          {Object.keys(s.param_scale ?? {}).length ? <><p className="small">Changed in system identification: {Object.entries(s.param_scale).map(([n, f]) => `${n.replace('§', ' ')} × ${num(f)}`).join(', ')}.</p><button className="secondary" onClick={() => update({ param_scale: {} })}>Back to the netlist values</button></>
            : <p className="muted small">The R, L and C values of the netlist. Change them with <b>Identify system</b> on the canvas.</p>}
        </Group>
  </>;
  const k: Kpis | undefined = result?.kpis; const o: Kpis | undefined = pinned?.kpis;
  async function screenshot() {
    setShooting(true);
    try { await savePng(document.body, 'housing-policy-lab'); }
    catch (e) { setError('Screenshot failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setShooting(false); }
  }
  return <>
    <header className="topbar"><div className="brand"><span className="mark">H</span>Housing Policy Lab</div>
      <div className="top-actions"><button className={tour ? "secondary" : "ghost"} data-no-shot title="Step by step from an empty market to feedback" disabled={busy} onClick={() => tour ? setTour(null) : goTour(0)}>{tour ? "Leave tour" : "Guided tour"}</button><span className={'mode ' + (s.feedback ? 'closed' : 'open')}>{s.feedback ? 'Feedback on' : 'Feedback off'}</span><button className="ghost" data-no-shot title="Save the whole page as a high-resolution PNG (3x)" disabled={shooting} onClick={screenshot}>{shooting ? <LoaderCircle className="spin" size={16}/> : <Camera size={16}/>} Screenshot page</button><button className="ghost" onClick={() => setLibrary(true)}><FolderOpen size={16}/> Saved <b>{saved.length}</b></button></div></header>
    <main className="workspace wide">
      {error && <div role="alert" className="notice bad">{error}<button aria-label="Dismiss" onClick={() => setError('')}><X size={15}/></button></div>}
      {notice && <div role="status" className="notice good">{notice}</div>}
      {stale && <div role="status" className="notice warn">Inputs changed since this run. Run again to update the results.</div>}


      {/* One canvas: scenario and policy in the left dock, analyses on the canvas and in the right dock, results below. */}
      {tour && <TourBar step={tour.step} go={goTour} exit={() => setTour(null)} busy={busy}/>}
      <div><ModelMap tour={tour ? { n: tour.n, pins: TOUR[tour.step].pins, ident: TOUR[tour.step].ident } : undefined} scenario={s} result={result} pinned={pinned} busy={busy} run={simulate} setFeedback={feedback => update({ feedback })} update={update} design={design} setDesign={setDesign} cbs={cbs} lag={lag ?? cbs?.lag_months ?? 0} cpb={cpbShown}
        left={<><div className="left-head"><div><p className="eyebrow">Disturbances d</p><h3>Economic scenario</h3></div><button className="ghost small" title="Back to the start values: every slider, switch, controller and model parameter" onClick={() => update({ ...catalogue.defaults, name: s.name })}><RotateCcw size={14}/> Reset all</button></div><p className="muted small">Scales of the historical inputs; 1.00 is the netlist path. Click a group to open it. A dot marks a group that differs from the start values. Run again to see the effect.</p>{scenarioControls}<hr/><p className="eyebrow">Reference r and controller</p><h3>Policy</h3>{policyControls}<button className="primary" disabled={busy} onClick={simulate}><Play size={15}/> Run simulation</button></>}/></div>


      {/* Results fold away below the canvas, so scrolling over the page does not drop you into them by accident. */}
      <button className={'results-toggle' + (showResults ? ' open' : '')} aria-expanded={showResults} onClick={() => setShowResults(v => !v)}><ChevronRight size={18} className="rt-arrow"/><span className="rt-title">Results, policy cost and robustness</span>
        <span className="muted small">{result && k ? `${runLabel(result.scenario, catalogue)} · year-on-year ${num(k.yoy_min, 1)} to ${num(k.yoy_max, 1)}%` : 'no run yet'}</span></button>
      {showResults && <>
      <section className="results-area"><h2 className="area-title">Results</h2>
      {(!result || !k || !charts ? <section className="panel empty"><h2>No results yet</h2><p className="muted">Run the model to see the results.</p><button className="primary" disabled={busy} onClick={simulate}><Play size={16}/> Run simulation</button></section> : <>
        <div className="result-bar"><div><strong>{runLabel(result.scenario, catalogue)}</strong>{pinned && <span className="muted"> compared with {runLabel(pinned.scenario, catalogue)}{SHOCKS.some(f => pinned.scenario[f] !== result.scenario[f]) ? ' under a different economic scenario' : ''}</span>}</div>
          <div className="row">{pinned ? <button className="ghost" onClick={() => setPinned(null)}><X size={15}/> Clear comparison</button> : <button className="ghost" onClick={() => setPinned(result)}><Pin size={15}/> Keep for comparison</button>}</div></div>
        {<>
          <div className="kpis"><Kpi label="Lowest yearly price change" value={k.yoy_min} unit="%" other={o?.yoy_min}/><Kpi label="Highest yearly price change" value={k.yoy_max} unit="%" other={o?.yoy_max}/><Kpi label="Average gap to target growth" value={k.yoy_mean_abs_gap} unit=" pts" other={o?.yoy_mean_abs_gap}/><Kpi label="Final price against target path" value={k.price_gap_final_pct} unit="%" other={o?.price_gap_final_pct}/></div>
          <section className="panel"><Chart title="Yearly house price change" unit="% a year" lines={charts.yoy}/>
            {cbs && <div className="cbs-lag"><label>Time shift of the CBS data <output>{lag ?? cbs.lag_months} month{Math.abs(lag ?? cbs.lag_months) === 1 ? '' : 's'}</output><input type="range" min={-24} max={24} step={1} value={lag ?? cbs.lag_months} aria-label="Time shift of the CBS data in months" onChange={e => setLag(Number(e.target.value))}/></label>
              {lag !== null && lag !== cbs.lag_months && <button className="ghost" onClick={() => setLag(null)}>Back to the estimate ({cbs.lag_months})</button>}
              <p className="muted note">Grey bars: {cbs.source}, year-on-year change of the index, each month at its own date. The housing market is not fitted to them; the "Fitted to CBS" preset and the Fit button fit only the mortgage-lending and interest-rate paths, and the inflation/trend level is added to the model line. The bars are only moved in time. Claude's estimate of the shift: {cbs.lag_months} month{Math.abs(cbs.lag_months) === 1 ? '' : 's'}, the lag with the highest correlation with the open-loop historical run (correlation {cbs.corr.toFixed(3)}, {cbs.corr_zero.toFixed(3)} without a shift). Compare shape and timing, not the level.</p></div>}</section>
          <section className="panel"><Chart title="Owner-occupied subsidy" unit="Model units" lines={charts.subsidy}/><p className="muted note">Closed loop starts near −29 because the target path starts at 80, below the open-loop price of about 109. Model units, not euros.</p></section>
          <section className="panel"><Chart title="House price" unit="Model units" lines={charts.price}/>{result.scenario.inflation_pct > 0 && <p className="muted note">Solid: the model price, in real terms. Dashed: the same price with {num(result.scenario.inflation_pct, 1)}% a year inflation/trend, the counterpart of the year-on-year line compared with CBS. The inflation/trend is not in the circuit.</p>}</section>
          <section className="panel"><Chart title="Rental share of housing services" unit="%" lines={charts.share}/></section>
          <section className="panel"><Chart title="Rental subsidy" unit="Model units" lines={charts.rental}/><p className="muted note">Historical path: 4 until 2023, then 0. With the rental share loop, the money it moves from the owner-occupied subsidy is added here.</p></section>
          <details className="panel more"><summary>Other model signals</summary><div className="grid2">{([['income', 'Income'], ['mortgages', 'Mortgage lending'], ['mortgage_debt', 'Mortgage debt'], ['interest_rate', 'Interest rate input'], ['construction', 'Construction'], ['housing_services', 'Housing services'], ['rent', 'Rent'], ['imputed_rent', 'Imputed rent']] as const).map(([f, t]) => <Chart key={f} title={t} unit="Model units" height={240} lines={charts.pair(f, AMBER)}/>)}</div></details>
        </>}
        {<><h2 className="area-title">Policy cost</h2>
          <div className="kpis"><Kpi label="Cumulative subsidy" value={k.subsidy_total} unit=" unit·yr" other={o?.subsidy_total}/><Kpi label="Lowest subsidy" value={k.subsidy_min} unit="" other={o?.subsidy_min}/><Kpi label="Highest subsidy" value={k.subsidy_max} unit="" other={o?.subsidy_max}/><Kpi label="Largest change within a year" value={k.subsidy_max_change_per_year} unit="" other={o?.subsidy_max_change_per_year}/></div>
          <section className="panel"><Chart title="Cumulative owner-occupied subsidy" unit="Model units × years" lines={charts.cumulative}/><p className="muted note">Model units, not euros. The historical path is a percentage of imputed rent in the thesis, so compare its shape and order with feedback, not its level. A negative value means the input acts as a levy.</p></section>
        </>}
        <p className="provenance">Solver: {result.engine} · model {result.model_version} · netlist {result.netlist_sha256.slice(0, 12)} · calendar years start at {catalogue.time.year_at_raw_zero} as in the thesis figures · model results, not a forecast</p>
      </>)}</section>
      <details className="panel more" onToggle={e => setRobust((e.currentTarget as HTMLDetailsElement).open)}><summary>Robustness: does the policy survive a wrong model?</summary>{robust && <Robustness design={{ ...design, K: [s.kp, s.ki, s.kd], filtered: s.derivative_filter }}/>}</details>
      </>}
      <div className="spacer"/>
    </main>
    <footer className="action-bar"><div className="row"><span className="muted small">One canvas: scenario and policy left, analyses on the canvas and right, results below.</span></div>
      <div className="row"><button className="ghost" disabled={busy} onClick={save}><Save size={15}/> Save</button>{result && <button className="ghost" onClick={exportRun}><Download size={15}/> Export</button>}<button className="secondary" disabled={busy} onClick={both}><GitCompare size={15}/> Run open and closed</button><button className="primary" disabled={busy} onClick={simulate}>{busy ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>} Run simulation</button></div></footer>
    {library && <div className="backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Saved scenarios"><div className="policy-head"><h2>Saved scenarios</h2><button className="ghost" aria-label="Close" onClick={() => setLibrary(false)}><X size={16}/></button></div>
      <label className="name">Name for the next save<input value={s.name} maxLength={80} onChange={e => update({ name: e.target.value })}/></label>
      {!saved.length && <p className="muted">Nothing saved yet.</p>}{saved.map(r => <div className="saved" key={r.id}><div><strong>{r.name}</strong><small>{new Date(r.created_at).toLocaleString('en-GB')} · {r.feedback ? 'Closed loop' : 'Open loop'} · {r.has_result ? 'with results' : 'inputs only'}</small></div><button className="ghost" onClick={() => load(r.id)}>Open</button></div>)}</section></div>}
  </>;
}

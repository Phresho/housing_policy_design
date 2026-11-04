import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FolderOpen, GitCompare, LoaderCircle, Pin, Play, Save, X } from 'lucide-react';
import { api } from './api';
import { Chart, type Line } from './Chart';
import { LoopDiagram } from './LoopDiagram';
import { ModelMap } from './ModelMap';
import { PoleDesign, Robustness, type Design } from './Analysis';
import type { Catalogue, ControllerKey, Kpis, Result, SavedRow, Scenario } from './types';

const GREEN = '#3f9a1f', BLUE = '#1f6fc4', GREY = '#8a9692', INK = '#1f2a26', AMBER = '#b9770e';
const num = (v: number, d = 2) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
const key = (s: Scenario) => { const { name: _ignored, ...rest } = s; return JSON.stringify(rest); };
const SHOCKS = ['interest_scale', 'income_scale', 'mortgage_scale', 'crisis_scale', 'covid_scale'] as const;
const PAGES = ['Scenario', 'Policy', 'Model', 'Results', 'Policy cost', 'Pole design', 'Robustness'];
const LAST = PAGES.length - 1;

function Slider({ label, hint, value, min, max, step, onChange, format }: { label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return <label className="slider"><span className="slider-head"><span>{label}</span><output>{format(value)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={e => onChange(Number(e.target.value))}/>{hint && <small>{hint}</small>}</label>;
}
const times = (v: number) => `× ${num(v)}`;

function runLabel(s: Scenario, c: Catalogue) {
  if (!s.feedback) return s.subsidy_scale === 1 ? 'Open loop · historical subsidies' : `Open loop · subsidies × ${num(s.subsidy_scale)}`;
  return `Closed loop · ${c.presets[s.controller]?.label ?? 'Custom PID'}`;
}

function Kpi({ label, value, unit, other, note }: { label: string; value: number; unit: string; other?: number; note?: string }) {
  return <div className="kpi"><span>{label}</span><strong>{num(value)}<em>{unit}</em></strong>{other !== undefined ? <small>Comparison: {num(other)}{unit}</small> : note ? <small>{note}</small> : null}</div>;
}

export default function App() {
  const [catalogue, setCatalogue] = useState<Catalogue>();
  const [s, setS] = useState<Scenario>();
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [pinned, setPinned] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<SavedRow[]>([]);
  const [library, setLibrary] = useState(false);
  const [design, setDesign] = useState<Design>({ K: [1.131, 0.666, 2.839], filtered: true, settling: 4, overshoot: 25 });
  const refresh = () => api<SavedRow[]>('/scenarios').then(setSaved);
  useEffect(() => { api<Catalogue>('/catalogue').then(c => { setCatalogue(c); setS(c.defaults); }).catch(e => setError(e.message)); refresh().catch(e => setError(e.message)); }, []);
  const stale = !!result && !!s && key(s) !== key(result.scenario);
  const update = (patch: Partial<Scenario>) => { setS(old => old && { ...old, ...patch }); setNotice(''); };
  const guard = async (fn: () => Promise<void>) => { setError(''); setNotice(''); setBusy(true); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const simulate = () => guard(async () => { const r = await api<Result>('/runs', s); setResult(r); setS(r.scenario); setPage(p => p < 2 ? 3 : p); });
  const both = () => guard(async () => {
    const [open, closed] = await Promise.all([api<Result>('/runs', { ...s, feedback: false }), api<Result>('/runs', { ...s, feedback: true })]);
    setPinned(open); setResult(closed); setS(closed.scenario); setPage(p => p === 2 ? 2 : 3); setNotice('Showing closed loop against open loop with the same scenario.');
  });
  const save = () => guard(async () => {
    const matching = result && !stale ? result : null;
    await api('/scenarios', { scenario: s, result: matching }); await refresh();
    setNotice(matching ? 'Saved with results.' : 'Inputs saved. Run and save again to include results.');
  });
  const load = (id: string) => guard(async () => {
    const found = await api<{ scenario: Scenario; result: Result | null }>(`/scenarios/${id}`);
    setS(found.scenario); setResult(found.result); setLibrary(false); setPage(found.result ? 3 : 0); setNotice(`Opened ${found.scenario.name}.`);
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
    const pair = (field: string, color: string): Line[] => [
      ...(pinned ? [{ name: other, x: pinned.year, y: pinned.series[field], color: GREY, dash: 'dash', width: 2 }] : []),
      { name: label, x: result.year, y: result.series[field], color },
    ];
    const target = result.scenario.target_growth_pct;
    const cumulative = (r: Result) => { let sum = 0; return r.series.owner_subsidy.map((u, i) => { if (i) sum += (u + r.series.owner_subsidy[i - 1]) / 2 * (r.year[i] - r.year[i - 1]); return sum; }); };
    return {
      yoy: [...pair('yoy', GREEN), { name: `Target ${num(target, 1)}%`, x: [result.year[0], result.year[result.year.length - 1]], y: [target, target], color: INK, dash: 'dot', width: 1.5 }],
      price: [...pair('price', GREEN), { name: 'Target path', x: result.year, y: result.series.reference, color: INK, dash: 'dot', width: 1.5 }],
      subsidy: pair('owner_subsidy', BLUE),
      cumulative: [...(pinned ? [{ name: other, x: pinned.year, y: cumulative(pinned), color: GREY, dash: 'dash', width: 2 }] : []), { name: label, x: result.year, y: cumulative(result), color: BLUE }],
      pair,
    };
  }, [result, pinned, catalogue]);
  if (!s || !catalogue) return <main className="startup"><h1>Housing Policy Lab</h1><p>{error || 'Loading…'}</p></main>;
  const label = catalogue.presets[s.controller]?.label ?? 'Custom PID';
  const k: Kpis | undefined = result?.kpis; const o: Kpis | undefined = pinned?.kpis;
  return <>
    <header className="topbar"><div className="brand"><span className="mark">H</span>Housing Policy Lab</div>
      <div className="top-actions"><span className={'mode ' + (s.feedback ? 'closed' : 'open')}>{s.feedback ? 'Feedback on' : 'Feedback off'}</span><button className="ghost" onClick={() => setLibrary(true)}><FolderOpen size={16}/> Saved <b>{saved.length}</b></button></div></header>
    <main className={page === 2 || page >= 5 ? 'workspace wide' : 'workspace'}>
      <div className="heading" hidden={page === 2}><h1>What if housing subsidies responded to the market?</h1><p>Run the 19 October housing market circuit with historical subsidies or with feedback, and compare the two.</p></div>
      <nav className="steps" aria-label="Pages">{PAGES.map((p, i) => <button key={p} className={page === i ? 'active' : ''} aria-current={page === i ? 'page' : undefined} onClick={() => setPage(i)}><span aria-hidden="true">{i + 1}</span>{p}</button>)}</nav>
      {error && <div role="alert" className="notice bad">{error}<button aria-label="Dismiss" onClick={() => setError('')}><X size={15}/></button></div>}
      {notice && <div role="status" className="notice good">{notice}</div>}
      {stale && page >= 2 && page <= 4 && <div role="status" className="notice warn">Inputs changed since this run. Run again to update the results.</div>}

      {page === 0 && <section className="panel"><h2>Economic scenario</h2><p className="muted">These scale the historical inputs of the model. 1.00 is the path in the netlist.</p>
        <div className="chips"><button onClick={() => update({ interest_scale: 1, income_scale: 1, mortgage_scale: 1, crisis_scale: 1, covid_scale: 1 })}>Historical</button><button onClick={() => update({ crisis_scale: 0, covid_scale: 0 })}>No crisis or Covid shock</button><button onClick={() => update({ crisis_scale: 2, covid_scale: 1 })}>Double crisis shock</button></div>
        <div className="sliders">
          <Slider label="Interest rates" value={s.interest_scale} min={.25} max={2} step={.05} format={times} onChange={v => update({ interest_scale: v })}/>
          <Slider label="Income" value={s.income_scale} min={.8} max={1.2} step={.01} format={times} onChange={v => update({ income_scale: v })}/>
          <Slider label="Mortgage lending" value={s.mortgage_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ mortgage_scale: v })}/>
          <Slider label="Financial crisis shock" value={s.crisis_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ crisis_scale: v })}/>
          <Slider label="Covid shock" value={s.covid_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ covid_scale: v })}/>
        </div></section>}

      {page === 1 && <section className="panel"><div className="policy-head"><div><h2>Subsidy policy</h2><p className="muted">Choose what drives the owner-occupied subsidy input.</p></div>
        <div className="segmented" role="group" aria-label="Feedback"><button className={!s.feedback ? 'active' : ''} aria-pressed={!s.feedback} onClick={() => update({ feedback: false })}>Open loop</button><button className={s.feedback ? 'active' : ''} aria-pressed={s.feedback} onClick={() => update({ feedback: true })}>Closed loop</button></div></div>
        <LoopDiagram feedback={s.feedback} controller={label}/>
        {!s.feedback ? <div className="sliders"><Slider label="Historical subsidy path" hint="1.00 is the path in the netlist, 20.98 to 29.34 model units." value={s.subsidy_scale} min={0} max={2} step={.05} format={times} onChange={v => update({ subsidy_scale: v })}/></div> : <>
          <div className="choices" role="radiogroup" aria-label="Controller">{(['hinf', 'zn', 'netlist', 'custom'] as ControllerKey[]).map(id => { const p = catalogue.presets[id]; return <label key={id} className={s.controller === id ? 'choice active' : 'choice'}><input type="radio" name="controller" checked={s.controller === id} onChange={() => update(p ? { controller: id, kp: p.kp, ki: p.ki, kd: p.kd, derivative_filter: p.filtered } : { controller: id })}/><strong>{p?.label ?? 'Custom PID'}</strong><small>{p ? `Kp ${p.kp} · Ki ${p.ki} · Kd ${p.kd}${p.filtered ? ' · filtered' : ''}` : 'Set your own gains'}</small></label>; })}</div>
          <div className="sliders">
            <Slider label="Target price growth" value={s.target_growth_pct} min={0} max={6} step={.1} format={v => `${num(v, 1)}% a year`} onChange={v => update({ target_growth_pct: v })}/>
            {s.controller === 'custom' && <>
              <Slider label="Kp" value={s.kp} min={0} max={15} step={.01} format={v => num(v)} onChange={v => update({ kp: v })}/>
              <Slider label="Ki" value={s.ki} min={.01} max={6} step={.01} format={v => num(v)} onChange={v => update({ ki: v })}/>
              <Slider label="Kd" value={s.kd} min={0} max={10} step={.01} format={v => num(v)} onChange={v => update({ kd: v })}/>
              <label className="check"><input type="checkbox" checked={s.derivative_filter} onChange={e => update({ derivative_filter: e.target.checked })}/> Derivative filter, cycle of 0.5 years</label></>}
          </div></>}
      </section>}

      {page === 2 && <ModelMap scenario={s} result={result} pinned={pinned} busy={busy} run={simulate} setFeedback={feedback => update({ feedback })}/>}

      {page === 5 && <PoleDesign design={design} setDesign={setDesign} useInSimulation={() => { update({ feedback: true, controller: 'custom', kp: design.K[0], ki: Math.max(0.01, design.K[1]), kd: design.K[2], derivative_filter: design.filtered }); setNotice('The design gains are set as a custom PID with feedback on. Run the simulation to see them in the full model.'); setPage(1); }}/>}
      {page === 6 && <Robustness design={design}/>}

      {(page === 3 || page === 4) && (!result || !k || !charts ? <section className="panel empty"><h2>No results yet</h2><p className="muted">Run the model to see the results.</p><button className="primary" disabled={busy} onClick={simulate}><Play size={16}/> Run simulation</button></section> : <>
        <div className="result-bar"><div><strong>{runLabel(result.scenario, catalogue)}</strong>{pinned && <span className="muted"> compared with {runLabel(pinned.scenario, catalogue)}{SHOCKS.some(f => pinned.scenario[f] !== result.scenario[f]) ? ' under a different economic scenario' : ''}</span>}</div>
          <div className="row">{pinned ? <button className="ghost" onClick={() => setPinned(null)}><X size={15}/> Clear comparison</button> : <button className="ghost" onClick={() => setPinned(result)}><Pin size={15}/> Keep for comparison</button>}</div></div>
        {page === 3 && <>
          <div className="kpis"><Kpi label="Lowest yearly price change" value={k.yoy_min} unit="%" other={o?.yoy_min}/><Kpi label="Highest yearly price change" value={k.yoy_max} unit="%" other={o?.yoy_max}/><Kpi label="Average gap to target growth" value={k.yoy_mean_abs_gap} unit=" pts" other={o?.yoy_mean_abs_gap}/><Kpi label="Final price against target path" value={k.price_gap_final_pct} unit="%" other={o?.price_gap_final_pct}/></div>
          <section className="panel"><Chart title="Yearly house price change" unit="% a year" lines={charts.yoy}/></section>
          <section className="panel"><Chart title="Owner-occupied subsidy" unit="Model units" lines={charts.subsidy}/><p className="muted note">Closed loop starts near −29 because the target path starts at 80, below the open-loop price of about 109. Model units, not euros.</p></section>
          <section className="panel"><Chart title="House price" unit="Model units" lines={charts.price}/></section>
          <details className="panel more"><summary>Other model signals</summary><div className="grid2">{([['income', 'Income'], ['mortgages', 'Mortgage lending'], ['mortgage_debt', 'Mortgage debt'], ['interest_rate', 'Interest rate input'], ['construction', 'Construction'], ['housing_services', 'Housing services'], ['rent', 'Rent'], ['imputed_rent', 'Imputed rent']] as const).map(([f, t]) => <Chart key={f} title={t} unit="Model units" height={240} lines={charts.pair(f, AMBER)}/>)}</div></details>
        </>}
        {page === 4 && <>
          <div className="kpis"><Kpi label="Cumulative subsidy" value={k.subsidy_total} unit=" unit·yr" other={o?.subsidy_total}/><Kpi label="Lowest subsidy" value={k.subsidy_min} unit="" other={o?.subsidy_min}/><Kpi label="Highest subsidy" value={k.subsidy_max} unit="" other={o?.subsidy_max}/><Kpi label="Largest change within a year" value={k.subsidy_max_change_per_year} unit="" other={o?.subsidy_max_change_per_year}/></div>
          <section className="panel"><Chart title="Cumulative owner-occupied subsidy" unit="Model units × years" lines={charts.cumulative}/><p className="muted note">Model units, not euros. The historical path is a percentage of imputed rent in the thesis, so compare its shape and order with feedback, not its level. A negative value means the input acts as a levy.</p></section>
        </>}
        <p className="provenance">Solver: {result.engine} · model {result.model_version} · netlist {result.netlist_sha256.slice(0, 12)} · calendar years start at {catalogue.time.year_at_raw_zero} as in the thesis figures · model results, not a forecast</p>
      </>)}
      <div className="spacer"/>
    </main>
    <footer className="action-bar"><div className="row">{page > 0 && <button className="ghost" onClick={() => setPage(page - 1)}><ArrowLeft size={15}/> Back</button>}{page < LAST && <button className="ghost" onClick={() => setPage(page + 1)}>Next <ArrowRight size={15}/></button>}</div>
      <div className="row"><button className="ghost" disabled={busy} onClick={save}><Save size={15}/> Save</button>{result && <button className="ghost" onClick={exportRun}><Download size={15}/> Export</button>}<button className="secondary" disabled={busy} onClick={both}><GitCompare size={15}/> Run open and closed</button><button className="primary" disabled={busy} onClick={simulate}>{busy ? <LoaderCircle className="spin" size={15}/> : <Play size={15}/>} Run simulation</button></div></footer>
    {library && <div className="backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Saved scenarios"><div className="policy-head"><h2>Saved scenarios</h2><button className="ghost" aria-label="Close" onClick={() => setLibrary(false)}><X size={16}/></button></div>
      <label className="name">Name for the next save<input value={s.name} maxLength={80} onChange={e => update({ name: e.target.value })}/></label>
      {!saved.length && <p className="muted">Nothing saved yet.</p>}{saved.map(r => <div className="saved" key={r.id}><div><strong>{r.name}</strong><small>{new Date(r.created_at).toLocaleString('en-GB')} · {r.feedback ? 'Closed loop' : 'Open loop'} · {r.has_result ? 'with results' : 'inputs only'}</small></div><button className="ghost" onClick={() => load(r.id)}>Open</button></div>)}</section></div>}
  </>;
}

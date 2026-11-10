import katex from 'katex';
import 'katex/dist/katex.min.css';

// The CPB housing-market model as the backbone of the circuit (guided tour, first step): the equations from
// Groot & Möhlmann (2020), CPB-Woningmarktmodel 2020, CPB Achtergronddocument; equation numbers refer to that
// document, parameter values are its own (beta 0.65, rho 3.95%, sigma 2, delta 0.117).
// flows / elements: what lights up on the canvas when the formula is clicked. Which circuit parts belong to which
// equation is Claude's reading of the netlist (10 Nov 2026), for Jesse to check.
export type Formula = { id: string; title: string; no: string; tex: string; note?: string; flows: string[]; elements: string[] };
export const FORMULAS: Record<string, Formula[]> = {
  constructors: [
    { id: 'construction', title: 'New construction', no: '2.14', tex: 'I_t = (\\gamma+\\omega)\\,\\alpha_t\\,P_m^{\\beta}',
      note: 'γ growth of the stock, ω demolition, β = 0.65 price elasticity of supply',
      flows: ['houses', 'construction_cost'], elements: ['B§Construction', 'V§Construction_cost', 'L2', 'L4', 'B§Housing_services'] },
  ],
  investors: [
    { id: 'price', title: 'Market price of a house', no: '2.17', tex: 'P_m = \\sum_{t=1}^{\\infty} \\frac{w^{*}(t) - \\kappa(t)}{(1+\\rho)^{t}}',
      note: 'w* gross (imputed) rent, κ maintenance, ρ = 3.95% required return',
      flows: ['rent', 'imputed_rent', 'construction_cost'], elements: ['L§Gross_rent', 'L§Gross_imputed_rent', 'V§Maintenance_costs', 'R13', 'C2', 'C3', 'R3', 'R6'] },
  ],
  households: [
    { id: 'utility', title: 'Utility', no: '2.1',
      tex: '\\max\\; u = \\Big[\\big(\\theta(h_k-\\bar h_k)^{\\rho} + (1-\\theta)(h_h-\\bar h_h)^{\\rho}\\big)^{1/\\rho}\\Big]^{\\delta}\\, x^{1-\\delta}',
      note: 'θ preference for owning, σ = 1/(1 − ρ) = 2, δ = 0.117',
      flows: ['rental_services', 'owner_services', 'goods'], elements: ['L§Demand_rent', 'L§Demand_owner_occupied', 'B4', 'L§Demand_consumption'] },
    { id: 'budget', title: 'Budget', no: '2.1', tex: 'b = w_k h_k + w_h h_h + p_x x',
      note: 'every flow into and out of the households',
      flows: ['rent', 'imputed_rent', 'rental_services', 'owner_services', 'consumption', 'income', 'goods', 'savings', 'savings_interest', 'rental_subsidy', 'owner_subsidy'],
      elements: ['L§Income', 'L§Consumption', 'L§Rent', 'L§Imputed_rent', 'I§Owner_occupied_subsidies', 'I§Rental_subsidies1'] },
    { id: 'subsidy', title: 'Subsidy formula', no: '2.6', tex: 'w_{k,h} = w^{*}_{k,h}\\,(1 - s_{k,h})',
      note: 'sₖ owner-occupied, sₕ rental subsidy rate: the Tax Authority’s inputs',
      flows: ['owner_subsidy', 'rental_subsidy', 'rent', 'imputed_rent'], elements: ['I§Owner_occupied_subsidies', 'I§Rental_subsidies1', 'B§PID'] },
  ],
};
// Height of the formula strip above an opened agent's circuit, in canvas (model) units.
export const STRIP_H: Record<string, number> = { constructors: 190, investors: 215, households: 330 };
// Households: strip at the bottom, because the rails from the investors enter its circuit from the top.
export const STRIP_BOTTOM = new Set(['households']);

const html = (tex: string) => katex.renderToString(tex, { throwOnError: false, displayMode: true, output: 'html' });

export function FormulaCards({ agent, active, pick }: { agent: string; active: string | null; pick: (f: Formula | null) => void }) {
  const list = FORMULAS[agent]; if (!list) return null;
  return <div className="formulas nodrag" onClick={e => e.stopPropagation()}>
    {list.map(f => { const toggle = () => pick(active === f.id ? null : f);
      return <div key={f.id} role="button" tabIndex={0} className={'eq' + (active === f.id ? ' on' : '')} aria-pressed={active === f.id} title="Show the flows and elements this equation describes"
        onClick={e => { e.stopPropagation(); toggle(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
        <div className="eq-title">{f.title} <span className="eq-no">({f.no})</span></div>
        <div className="eq-body" dangerouslySetInnerHTML={{ __html: html(f.tex) }}/>
        {f.note && <div className="eq-note">{f.note}</div>}
      </div>; })}
  </div>;
}

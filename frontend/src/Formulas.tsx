// The CPB housing-market model as the backbone of the circuit (guided tour, first step): one card per agent with the
// equations from Groot & Möhlmann (2020), CPB-Woningmarktmodel 2020, CPB Achtergronddocument; equation numbers
// in brackets refer to that document. Parameter values quoted are the document's own (beta 0.65, rho 3.95%,
// sigma 2, delta 0.117).
const Eq = ({ title, no, children, note }: { title: string; no: string; children: React.ReactNode; note?: React.ReactNode }) =>
  <div className="eq"><div className="eq-title">{title} <span className="eq-no">({no})</span></div><div className="eq-body">{children}</div>{note && <div className="eq-note">{note}</div>}</div>;

export function AgentFormulas({ agent }: { agent: string }) {
  if (agent === 'constructors') return <div className="formulas">
    <Eq title="New construction" no="2.14" note={<>γ growth of the stock, ω demolition, β = 0.65 price elasticity of supply</>}>
      I<sub>t</sub> = (γ + ω) α<sub>t</sub> P<sub>m</sub><sup>β</sup></Eq></div>;
  if (agent === 'investors') return <div className="formulas">
    <Eq title="Market price of a house" no="2.17" note={<>w* gross (imputed) rent, κ maintenance, ρ = 3.95% required return</>}>
      P<sub>m</sub> = Σ<sub>t=1…∞</sub> (w*(t) − κ(t)) / (1 + ρ)<sup>t</sup></Eq>
    <Eq title="Owning or renting out yields the same" no="2.5">w<sub>k</sub>* = w<sub>h</sub>*</Eq></div>;
  if (agent === 'households') return <div className="formulas">
    <Eq title="Utility" no="2.1" note={<>θ preference for owning, σ = 1/(1 − ρ) = 2, δ = 0.117 housing share</>}>
      max u = [(θ(h<sub>k</sub> − h̄<sub>k</sub>)<sup>ρ</sup> + (1 − θ)(h<sub>h</sub> − h̄<sub>h</sub>)<sup>ρ</sup>)<sup>1/ρ</sup>]<sup>δ</sup> x<sup>1−δ</sup></Eq>
    <Eq title="Budget" no="2.1">b = w<sub>k</sub>h<sub>k</sub> + w<sub>h</sub>h<sub>h</sub> + p<sub>x</sub>x</Eq>
    <Eq title="Subsidy formula" no="2.6" note={<>s<sub>k</sub> owner-occupied, s<sub>h</sub> rental subsidy rate: the Tax Authority's inputs</>}>
      w<sub>k,h</sub> = w<sub>k,h</sub>* (1 − s<sub>k,h</sub>)</Eq></div>;
  if (agent === 'firms') return <div className="formulas">
    <Eq title="Income and goods" no="2.1" note={<>The CPB model takes income b as given; here firms pay it and sell the other goods x.</>}>
      p<sub>x</sub> = 1, &nbsp; consumption p<sub>x</sub>x = b − w<sub>k</sub>h<sub>k</sub> − w<sub>h</sub>h<sub>h</sub></Eq></div>;
  return null;
}

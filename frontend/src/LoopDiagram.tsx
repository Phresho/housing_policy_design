/** Shows which source drives node N031, following the two netlist wirings. */
export function LoopDiagram({ feedback, controller }: { feedback: boolean; controller: string }) {
  const on = (active: boolean) => active ? 'wire on' : 'wire off';
  const box = (active: boolean) => active ? 'block on' : 'block off';
  return <svg className="loop" viewBox="0 0 760 270" role="img" aria-label={feedback ? 'Closed loop: PID controller drives the subsidy input from the price error' : 'Open loop: historical subsidy path drives the subsidy input'}>
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="context-stroke"/></marker></defs>
    <g className={box(!feedback)}><rect x="170" y="14" width="190" height="56" rx="8"/><text x="265" y="38">Historical subsidies</text><text x="265" y="57" className="sub">PWL source</text></g>
    <g className={box(feedback)}><rect x="170" y="98" width="190" height="56" rx="8"/><text x="265" y="122">{controller}</text><text x="265" y="141" className="sub">B§PID source</text></g>
    <g className={box(feedback)}><circle cx="96" cy="126" r="20"/><text x="96" y="131">e</text></g>
    <g className={box(feedback)}><text x="18" y="104" className="side">Target path</text></g>
    <g className="block on"><rect x="470" y="70" width="170" height="84" rx="8"/><text x="555" y="104">Housing market</text><text x="555" y="125" className="sub">multiport circuit</text></g>
    <path className={on(feedback)} d="M16 126H76" markerEnd="url(#arrow)"/>
    <path className={on(feedback)} d="M116 126H170" markerEnd="url(#arrow)"/>
    {[!feedback, feedback].map((active, i) => ({ active, d: i ? 'M360 126H415V112H470' : 'M360 42H415V112H470' })).sort((a, b) => Number(a.active) - Number(b.active)).map(w => <path key={w.d} className={on(w.active)} d={w.d} markerEnd="url(#arrow)"/>)}
    <text x="418" y="92" className="side">N031</text>
    <path className="wire on" d="M640 112H748" markerEnd="url(#arrow)"/><text x="694" y="100" className="side mid">House price</text>
    <path className={on(feedback)} d="M700 112V226H96V146" markerEnd="url(#arrow)"/>
    <text x="400" y="248" className={feedback ? 'side mid' : 'side mid dim'}>{feedback ? 'Feedback on: price error sets the subsidy' : 'Feedback off: no measurement reaches the subsidy'}</text>
  </svg>;
}

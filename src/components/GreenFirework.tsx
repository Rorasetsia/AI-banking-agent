import { useId } from 'react';

/** Original vector artwork: a quiet green burst, animated only on a saved day. */
export function GreenFirework({ date, animate }: { date: string; animate: boolean }) {
  const id = `green-burst-${useId().replace(/:/g, '')}`;
  return <span className={`green-firework${animate ? ' is-celebrating' : ''}`} role="img" aria-label={`${date} 行动鼓励`}>
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id={id} x1="8" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse"><stop stopColor="#bdd6a2"/><stop offset=".48" stopColor="#5ba58b"/><stop offset="1" stopColor="#235f4d"/></linearGradient></defs>
      <circle className="firework-halo" cx="32" cy="32" r="25" fill={`url(#${id})`} opacity=".1"/>
      <g className="firework-rays" stroke={`url(#${id})`} strokeWidth="2.8" strokeLinecap="round">
        {Array.from({length:10},(_,i)=><path key={i} d="M32 21 Q30 16 32 9" transform={`rotate(${i*36} 32 32)`}/>)}</g>
      <g className="firework-sparks" fill={`url(#${id})`}>
        {Array.from({length:5},(_,i)=><circle key={i} cx="32" cy="3.5" r="1.7" transform={`rotate(${i*72+18} 32 32)`}/>)}</g>
      <path className="firework-core" d="M32 24 Q34 30 40 32 Q34 34 32 40 Q30 34 24 32 Q30 30 32 24Z" fill={`url(#${id})`}/>
    </svg>
  </span>;
}

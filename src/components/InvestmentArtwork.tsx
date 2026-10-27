import { useId } from 'react';

/** An editorial still life of stacked stones and a rising paper ribbon. */
export function InvestmentArtwork() {
  const id=`investment-${useId().replace(/:/g,'')}`;
  return <svg className="investment-artwork" viewBox="0 0 240 160" aria-hidden="true" focusable="false">
    <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#afc6a2"/><stop offset="1" stopColor="#345c49"/></linearGradient></defs>
    <ellipse cx="129" cy="140" rx="83" ry="8" fill="#315943" opacity=".07"/>
    <path d="M29 112 C63 126 69 76 103 88 S151 46 200 35" fill="none" stroke={`url(#${id})`} strokeWidth="15" strokeLinecap="round" opacity=".2"/>
    <path d="M29 109 C63 123 69 73 103 85 S151 43 200 32" fill="none" stroke="#537c60" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5"/>
    <g stroke="#6d8a6b" strokeWidth="1.2"><path d="M55 115 Q50 108 59 105 H91 Q99 108 95 115 L90 135 H61Z" fill="#d2dec5"/><path d="M103 91 Q100 84 110 81 H141 Q151 83 147 91 L142 135 H110Z" fill="#a8bda0"/><path d="M157 61 Q152 54 163 51 H193 Q203 54 200 61 L193 135 H164Z" fill={`url(#${id})`}/></g>
    <path d="M173 34 L200 29 L196 52" fill="none" stroke="#345c49" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="55" cy="59" r="15" fill="#eee9d6" stroke="#c5bd9d"/><path d="M51 53 L55 59 L59 53 M50 59 H60 M50 64 H60 M55 59 V69" stroke="#9b916e" fill="none" strokeWidth="1.5"/>
    <path d="M205 95 Q222 100 217 115 Q202 114 205 95Z M212 138 Q209 119 212 107" fill="#afc3a3" stroke="#6d8a6b" strokeWidth="1.2"/>
  </svg>;
}

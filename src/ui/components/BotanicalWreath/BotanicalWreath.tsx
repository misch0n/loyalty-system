/**
 * BotanicalWreath — decorative brand foliage arranged as a ring: forest leaves,
 * espresso beans, and a coffee-cherry cluster, drawn from the café's artwork.
 *
 * Pure presentation, no data. Sits behind the redeem-QR overlay so claiming a
 * free coffee feels like the brand's illustration. `aria-hidden` — it carries no
 * information. Designed for a portrait panel (viewBox 300×430) and stretched to
 * fill via `preserveAspectRatio="none"`; the centre is kept clear for the QR.
 */
import type { SVGProps } from 'react';

const LEAF = '#2c4a39';
const LEAF_DARK = '#21392b';
const VEIN = '#3a5446';

function Leaf({ x, y, rot, s, fill = LEAF }: { x: number; y: number; rot: number; s: number; fill?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <path d="M0 0 C 16 -14 20 -44 0 -68 C -20 -44 -16 -14 0 0 Z" fill={fill} />
      <path d="M0 -4 L0 -62" stroke={VEIN} strokeWidth={1.4} fill="none" opacity={0.7} />
      <path d="M0 -22 L9 -30 M0 -34 L10 -42 M0 -46 L8 -54" stroke={VEIN} strokeWidth={1} fill="none" opacity={0.5} />
      <path d="M0 -22 L-9 -30 M0 -34 L-10 -42 M0 -46 L-8 -54" stroke={VEIN} strokeWidth={1} fill="none" opacity={0.5} />
    </g>
  );
}

function Bean({ x, y, rot, s }: { x: number; y: number; rot: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${s})`}>
      <ellipse rx={13} ry={19} fill="#3b2316" />
      <path d="M0 -15 C 7 -6 7 6 0 15" stroke="#7a4d2c" strokeWidth={2.2} fill="none" />
    </g>
  );
}

function Cherries({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx={-15} cy={6} r={17} fill="#d98a4f" />
      <circle cx={13} cy={-3} r={15} fill="#c5502f" />
      <circle cx={3} cy={21} r={13} fill="#e2a25f" />
      <circle cx={-6} cy={-12} r={10} fill="#b5482f" />
    </g>
  );
}

export function BotanicalWreath(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 300 430" preserveAspectRatio="none" aria-hidden="true" {...props}>
      {/* left side */}
      <Leaf x={30} y={156} rot={-72} s={0.92} />
      <Leaf x={26} y={252} rot={-114} s={0.9} fill={LEAF_DARK} />
      <Cherries x={42} y={208} s={0.64} />
      <Bean x={32} y={302} rot={-28} s={0.78} />
      {/* right side */}
      <Leaf x={270} y={156} rot={72} s={0.92} />
      <Leaf x={274} y={252} rot={114} s={0.9} fill={LEAF_DARK} />
      <Bean x={268} y={206} rot={30} s={0.78} />
      <Cherries x={258} y={302} s={0.64} />
      {/* top corners — kept wide of the centred title */}
      <Leaf x={52} y={40} rot={-42} s={0.7} fill={LEAF_DARK} />
      <Leaf x={248} y={40} rot={42} s={0.7} />
      <Bean x={150} y={26} rot={8} s={0.62} />
      {/* bottom corners — kept wide of the code */}
      <Leaf x={70} y={416} rot={-150} s={0.7} />
      <Leaf x={230} y={418} rot={150} s={0.7} fill={LEAF_DARK} />
    </svg>
  );
}

export default BotanicalWreath;

import { formatCompactEgp } from '@tpa/core';
import type { Piastres } from '@tpa/types';

import styles from './LineChart.module.css';

export interface LinePoint {
  label: string;
  value: Piastres;
}

/** Round a raw step up to a "nice" 1/2/5 × 10ⁿ value for clean axis ticks. */
function niceStep(v: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}

/**
 * Hand-rolled SVG line chart: a royal line over a gradient fill, with a 4-step
 * y-axis and per-point x labels. All colour comes from tokens via CSS (stroke /
 * stop-color reference var(--*)), so it themes with the rest of the admin and
 * never hardcodes a palette. Values are integer piastres; ticks render compact
 * EGP via @tpa/core.
 */
export function LineChart({ data, height = 240 }: { data: readonly LinePoint[]; height?: number }) {
  const W = 720;
  const H = height;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const rawMax = Math.max(1, ...data.map((d) => d.value as number));
  const step = niceStep(rawMax / 4);
  const yMax = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);

  const x = (i: number) => padL + (data.length <= 1 ? 0 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;

  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${x(0)},${padT + innerH} ${linePts} ${x(data.length - 1)},${padT + innerH}`;

  return (
    <svg className={styles.svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue over time">
      <defs>
        <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className={styles.fillTop} />
          <stop offset="100%" className={styles.fillBottom} />
        </linearGradient>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={styles.grid} />
          <text x={padL - 8} y={y(t)} className={styles.axisLabel} textAnchor="end" dominantBaseline="middle">
            {formatCompactEgp(t as Piastres)}
          </text>
        </g>
      ))}

      <polygon points={areaPts} fill="url(#lineFill)" />
      <polyline points={linePts} className={styles.line} fill="none" />
      {data.map((d, i) => (
        <circle key={d.label} cx={x(i)} cy={y(d.value)} r={3.5} className={styles.dot} />
      ))}
      {data.map((d, i) => (
        <text key={d.label} x={x(i)} y={H - 8} className={styles.axisLabel} textAnchor="middle">
          {d.label}
        </text>
      ))}
    </svg>
  );
}

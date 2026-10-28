// Small, dependency-free SVG charts. Single series each, so one accent color carries the data;
// every mark has a hover tooltip and every chart has a table view for exact numbers.
import type { ReactNode } from "react";

type Point = { label: string; value: number; hint?: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function DataTable({ points, unit }: { points: Point[]; unit: string }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-faint hover:text-muted">Show as table</summary>
      <table className="mt-2 w-full text-left">
        <tbody>
          {points.map((p) => (
            <tr key={p.label} className="border-t border-line">
              <td className="py-1 pr-3 text-muted">{p.label}</td>
              <td className="py-1 text-right tabular-nums text-ivory">
                {p.value}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Vertical bars, e.g. study minutes per day. */
export function BarChart({ points, unit = "", ariaLabel, empty }: { points: Point[]; unit?: string; ariaLabel: string; empty?: ReactNode }) {
  if (!points.length || points.every((p) => p.value === 0)) return <p className="py-8 text-center text-sm text-muted">{empty ?? "No data for this period yet."}</p>;
  const W = 600;
  const H = 180;
  const pad = { l: 34, b: 22, t: 8 };
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const slot = (W - pad.l) / points.length;
  const bw = Math.max(2, Math.min(28, slot - 2));
  const showEvery = Math.ceil(points.length / 8);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map((f) => {
          const y = pad.t + (H - pad.b - pad.t) * (1 - f);
          return (
            <g key={f}>
              <line x1={pad.l} x2={W} y1={y} y2={y} stroke="#26282E" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#6F747C">
                {Math.round(max * f)}
              </text>
            </g>
          );
        })}
        {points.map((p, i) => {
          const h = ((H - pad.b - pad.t) * p.value) / max;
          const x = pad.l + i * slot + (slot - bw) / 2;
          const y = H - pad.b - h;
          return (
            <g key={p.label} className="group">
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={H - pad.b - pad.t} fill="transparent" />
              {p.value > 0 && <path d={`M${x},${H - pad.b} V${y + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)} H${x + bw - Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)} V${H - pad.b} Z`} fill="#D6B36A" className="opacity-85 group-hover:opacity-100" />}
              <title>{`${p.label}: ${p.value}${unit}${p.hint ? ` — ${p.hint}` : ""}`}</title>
              {i % showEvery === 0 && (
                <text x={pad.l + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#6F747C">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <DataTable points={points} unit={unit} />
    </figure>
  );
}

/** A line of percentages over time, e.g. quiz scores. */
export function LineChart({ points, ariaLabel }: { points: Point[]; ariaLabel: string }) {
  if (points.length < 2) return <p className="py-8 text-center text-sm text-muted">Take at least two quizzes to see a trend.</p>;
  const W = 600;
  const H = 180;
  const pad = { l: 34, r: 10, b: 22, t: 10 };
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / (points.length - 1);
  const y = (v: number) => pad.t + (H - pad.b - pad.t) * (1 - v / 100);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#26282E" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="#6F747C">
              {v}%
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="#D6B36A" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent" />
            <circle cx={x(i)} cy={y(p.value)} r={4} fill="#D6B36A" stroke="#141519" strokeWidth={2} />
            <title>{`${p.label}: ${p.value}%${p.hint ? ` — ${p.hint}` : ""}`}</title>
          </g>
        ))}
      </svg>
      <DataTable points={points} unit="%" />
    </figure>
  );
}

/** Horizontal bars with labels, e.g. accuracy by subject. */
export function HBars({ rows, unit = "%" }: { rows: { label: string; value: number; note?: string }[]; unit?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">No graded answers in this period.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value}${unit}${r.note ? ` (${r.note})` : ""}`}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate text-ivory">{r.label}</span>
            <span className="tabular-nums text-muted">
              {r.value}
              {unit}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-raised">
            <div className="h-2 rounded-full bg-gold" style={{ width: `${Math.max(1, Math.min(100, r.value))}%` }} />
          </div>
          {r.note && <div className="mt-0.5 text-xs text-faint">{r.note}</div>}
        </li>
      ))}
    </ul>
  );
}

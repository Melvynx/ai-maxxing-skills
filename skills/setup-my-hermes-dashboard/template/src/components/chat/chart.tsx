import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Generative blocks drawn natively (no frame, no library): a ```chart block becomes a bar, line, area or donut chart,
 * a ```stats block a row of key-number tiles. Hermes writes the JSON (see RICH_HINT in src/server/chat/chat.ts).
 * Colors come only from the theme tokens (--chart … --chart-5, good / warn / bad), so light and dark both work, and
 * nothing uses inline styles (the dashboard's Content-Security-Policy forbids them).
 */

export type ChartType = "bar" | "line" | "area" | "donut";
export type ChartSpec = { type: ChartType; title?: string; unit?: string; labels: string[]; series: { name: string; values: number[] }[] };
export type StatTile = { label: string; value: string; delta?: string; tone?: "good" | "warn" | "bad"; hint?: string };

export const CHART_LANGS = new Set(["chart", "graph"]);
export const STATS_LANGS = new Set(["stats", "kpi", "kpis"]);

/** Full class names (Tailwind only keeps classes it can read in the source). */
const FILL = ["fill-chart", "fill-chart-2", "fill-chart-3", "fill-chart-4", "fill-chart-5"];
const STROKE = ["stroke-chart", "stroke-chart-2", "stroke-chart-3", "stroke-chart-4", "stroke-chart-5"];
const SOFT = ["fill-chart/15", "fill-chart-2/15", "fill-chart-3/15", "fill-chart-4/15", "fill-chart-5/15"];
const DOT = ["bg-chart", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"];

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[\s,]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The JSON of a ```chart block, or null when it cannot be drawn (then the code shows as it is). */
export function parseChart(code: string): ChartSpec | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(code) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const type = (["bar", "line", "area", "donut", "pie"].includes(String(raw.type)) ? String(raw.type).replace("pie", "donut") : "bar") as ChartType;
  let labels: string[] = Array.isArray(raw.labels) ? raw.labels.map(String) : [];
  let series: ChartSpec["series"] = [];
  if (Array.isArray(raw.series)) {
    series = (raw.series as Record<string, unknown>[])
      .filter((s) => s && Array.isArray(s.values))
      .map((s, i) => ({ name: typeof s.name === "string" ? s.name : `Series ${i + 1}`, values: (s.values as unknown[]).map((v) => num(v) ?? 0) }));
  } else if (Array.isArray(raw.data)) {
    // Also accepted: {"data":[{"label":"Mon","value":3}]}
    const rows = (raw.data as Record<string, unknown>[]).filter((r) => r && typeof r === "object");
    labels = rows.map((r) => String(r.label ?? r.name ?? ""));
    series = [{ name: typeof raw.title === "string" ? raw.title : "Value", values: rows.map((r) => num(r.value) ?? 0) }];
  }
  series = series.slice(0, 5);
  const length = Math.max(0, ...series.map((s) => s.values.length));
  if (!series.length || !length) return null;
  if (labels.length < length) labels = [...labels, ...Array.from({ length: length - labels.length }, (_, i) => String(labels.length + i + 1))];
  return { type, title: typeof raw.title === "string" ? raw.title : undefined, unit: typeof raw.unit === "string" ? raw.unit : undefined, labels: labels.slice(0, length), series };
}

/** The JSON of a ```stats block (an array, or {"stats":[…]}), or null. */
export function parseStats(code: string): StatTile[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(code);
  } catch {
    return null;
  }
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { stats?: unknown })?.stats) ? (raw as { stats: unknown[] }).stats : null;
  if (!rows) return null;
  const tiles = (rows as Record<string, unknown>[])
    .filter((r) => r && typeof r === "object" && r.label !== undefined && r.value !== undefined)
    .slice(0, 8)
    .map((r) => ({
      label: String(r.label),
      value: String(r.value),
      delta: r.delta === undefined || r.delta === null || r.delta === "" ? undefined : String(r.delta),
      tone: r.tone === "good" || r.tone === "warn" || r.tone === "bad" ? (r.tone as StatTile["tone"]) : undefined,
      hint: typeof r.hint === "string" ? r.hint : undefined,
    }));
  return tiles.length ? tiles : null;
}

const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const FULL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** « $1.2K », « 45 % » → « 45% », « 3 GB ». */
export function withUnit(n: number, unit: string | undefined, compact = false): string {
  const value = compact ? COMPACT.format(n) : FULL.format(n);
  if (!unit) return value;
  if (["$", "£", "¥"].includes(unit)) return `${n < 0 ? "-" : ""}${unit}${value.replace("-", "")}`;
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

/** A round top for the y axis: 0 → 1, 7 → 8, 430 → 500. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}

/** The width of the box, read in the browser (the server renders a sensible default). */
function useWidth(fallback: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [box, width] = useWidth(560);
  const many = spec.series.length > 1;
  return (
    <figure className="my-3 grid w-full gap-3 rounded-xl border bg-card p-4 first:mt-0" data-testid="chat-chart" data-type={spec.type}>
      {spec.title || many || spec.type !== "donut" ? (
        <figcaption className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          {spec.title ? <span className="text-sm font-semibold">{spec.title}</span> : null}
          {spec.type !== "donut" ? (
            <span className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {hover !== null ? <span className="font-medium text-foreground">{spec.labels[hover]}</span> : null}
              {spec.series.map((s, i) => (
                <span key={s.name} className="inline-flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", DOT[i])} aria-hidden />
                  {many || hover === null ? s.name : null}
                  {hover !== null ? <span className="font-medium text-foreground">{withUnit(s.values[hover] ?? 0, spec.unit)}</span> : null}
                </span>
              ))}
            </span>
          ) : null}
        </figcaption>
      ) : null}
      <div ref={box} className="min-w-0">
        {spec.type === "donut" ? <Donut spec={spec} /> : <Cartesian spec={spec} width={width} hover={hover} onHover={setHover} />}
      </div>
    </figure>
  );
}

function Cartesian({ spec, width, hover, onHover }: { spec: ChartSpec; width: number; hover: number | null; onHover: (i: number | null) => void }) {
  const height = 220;
  const n = spec.labels.length;
  const values = spec.series.flatMap((s) => s.values);
  const min = Math.min(0, ...values);
  const top = niceMax(Math.max(...values, 0));
  const bottom = min < 0 ? -niceMax(-min) : 0;
  const ticks = Array.from({ length: 5 }, (_, i) => bottom + ((top - bottom) * i) / 4);
  const left = Math.max(28, ...ticks.map((t) => withUnit(t, spec.unit, true).length * 6.2 + 8));
  const pad = { top: 8, right: 8, bottom: 24, left };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const y = (v: number) => pad.top + plotH - ((v - bottom) / (top - bottom)) * plotH;
  const band = plotW / n;
  const x = (i: number) => (spec.type === "bar" ? pad.left + band * (i + 0.5) : pad.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1)));
  // Show about one label every 56 px.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const groupW = Math.min(band * 0.72, 18 * spec.series.length + 24);
  const barW = groupW / spec.series.length;
  const zero = y(0);
  const summary = `${spec.title ? `${spec.title}: ` : ""}${spec.series.map((s) => `${s.name} ${s.values.map((v, i) => `${spec.labels[i]} ${withUnit(v, spec.unit)}`).join(", ")}`).join("; ")}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block h-auto w-full overflow-visible select-none" role="img" aria-label={summary} onMouseLeave={() => onHover(null)}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={cn("stroke-border", t !== 0 && "[stroke-dasharray:3_4]")} />
          <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
            {withUnit(t, spec.unit, true)}
          </text>
        </g>
      ))}
      {spec.labels.map((label, i) =>
        i % every === 0 ? (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className={cn("text-[10px]", hover === i ? "fill-foreground font-medium" : "fill-muted-foreground")}>
            {label.length > 10 ? `${label.slice(0, 9)}…` : label}
          </text>
        ) : null,
      )}
      {hover !== null && spec.type !== "bar" ? <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} className="stroke-muted-foreground/40" /> : null}
      {spec.type === "bar"
        ? spec.series.map((s, si) =>
            s.values.map((v, i) => {
              const bx = x(i) - groupW / 2 + si * barW + 1;
              const h = Math.abs(y(v) - zero);
              return <rect key={`${si}-${i}`} x={bx} y={v >= 0 ? zero - h : zero} width={Math.max(1, barW - 2)} height={Math.max(v === 0 ? 0 : 1, h)} rx={Math.min(4, barW / 4)} className={cn(FILL[si], "transition-opacity", hover !== null && hover !== i && "opacity-40")} />;
            }),
          )
        : spec.series.map((s, si) => {
            const points = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
            return (
              <g key={s.name}>
                {spec.type === "area" ? <path d={`M${x(0)},${zero} L${points.join(" L")} L${x(s.values.length - 1)},${zero} Z`} className={SOFT[si]} /> : null}
                <polyline points={points.join(" ")} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className={STROKE[si]} />
                {s.values.map((v, i) => (n <= 24 || hover === i ? <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4 : 2.5} className={cn(FILL[si], "stroke-card")} strokeWidth={1.5} /> : null))}
              </g>
            );
          })}
      {spec.labels.map((_, i) => (
        <rect key={i} x={spec.type === "bar" ? pad.left + band * i : x(i) - (n === 1 ? plotW : plotW / (n - 1)) / 2} y={pad.top} width={spec.type === "bar" ? band : n === 1 ? plotW : plotW / (n - 1)} height={plotH} fill="transparent" onMouseEnter={() => onHover(i)} onClick={() => onHover(i)} />
      ))}
    </svg>
  );
}

function Donut({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const values = (spec.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = 70;
  const inner = 46;
  let angle = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    const end = angle - (values.length > 1 ? 0.012 : 0);
    const large = end - start > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${(rad * Math.cos(a)).toFixed(2)},${(rad * Math.sin(a)).toFixed(2)}`;
    const d = sweep >= Math.PI * 2 - 0.001 ? `M0,${-r} A${r},${r} 0 1 1 0,${r} A${r},${r} 0 1 1 0,${-r} M0,${-inner} A${inner},${inner} 0 1 0 0,${inner} A${inner},${inner} 0 1 0 0,${-inner} Z` : `M${p(r, start)} A${r},${r} 0 ${large} 1 ${p(r, end)} L${p(inner, end)} A${inner},${inner} 0 ${large} 0 ${p(inner, start)} Z`;
    return { d, i };
  });
  const shown = hover ?? null;
  // Values already in % are shares: no "Total 100%", the center shows the biggest slice and the legend one number.
  const share = spec.unit === "%";
  const top = values.indexOf(Math.max(...values));
  const focus = shown ?? (share ? top : null);
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 13)}…` : s);
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <svg viewBox="-80 -80 160 160" className="size-40 shrink-0" role="img" aria-label={values.map((v, i) => `${spec.labels[i]} ${withUnit(v, spec.unit)}`).join(", ")} onMouseLeave={() => setHover(null)}>
        {arcs.map(({ d, i }) => (
          <path key={i} d={d} fillRule="evenodd" className={cn(FILL[i % 5], "transition-opacity", shown !== null && shown !== i && "opacity-35")} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
        <text y={-5} textAnchor="middle" className="fill-foreground text-[15px] font-semibold tabular-nums">
          {withUnit(focus === null ? total : (values[focus] ?? 0), spec.unit, true)}
        </text>
        <text y={12} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {focus === null ? "Total" : share ? short(spec.labels[focus] ?? "") : `${Math.round(((values[focus] ?? 0) / total) * 100)}%`}
        </text>
      </svg>
      <ul className="grid min-w-44 flex-1 gap-1.5 text-sm">
        {values.map((v, i) => (
          <li key={i} className={cn("flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5", shown === i && "bg-accent")} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className={cn("size-2.5 shrink-0 rounded-full", DOT[i % 5])} aria-hidden />
            <span className="min-w-0 truncate">{spec.labels[i]}</span>
            <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
              {share ? withUnit(v, spec.unit) : `${withUnit(v, spec.unit)} · ${Math.round((v / total) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONE = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;

/** « +12% » is good, « -3% » bad, unless Hermes says otherwise (fewer errors is good news). */
const toneOf = (tile: StatTile) => tile.tone ?? (tile.delta?.trim().startsWith("+") ? "good" : /^[-−]/.test(tile.delta?.trim() ?? "") ? "bad" : undefined);

export function ChatStats({ tiles }: { tiles: StatTile[] }) {
  return (
    <div className={cn("my-3 grid gap-2 first:mt-0", tiles.length === 1 ? "max-w-60 grid-cols-1" : tiles.length === 2 ? "grid-cols-2" : tiles.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3")} data-testid="chat-stats">
      {tiles.map((tile) => {
        const tone = toneOf(tile);
        return (
          <div key={tile.label} className="grid min-w-0 content-start gap-1 rounded-xl border bg-card px-3.5 py-3">
            <span className="truncate text-xs text-muted-foreground" title={tile.label}>
              {tile.label}
            </span>
            <span className="truncate font-heading text-xl font-semibold tracking-[-0.01em] tabular-nums" title={tile.value}>
              {tile.value}
            </span>
            {tile.delta || tile.hint ? (
              <span className="flex min-w-0 items-center gap-1.5 text-xs">
                {tile.delta ? <span className={cn("shrink-0 font-medium tabular-nums", tone ? TONE[tone] : "text-muted-foreground")}>{tile.delta}</span> : null}
                {tile.hint ? <span className="truncate text-muted-foreground">{tile.hint}</span> : null}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

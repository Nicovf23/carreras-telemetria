import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface Series {
  x: number;
  y: number;
}

const PAD = { l: 36, r: 8, t: 10, b: 22 };

/**
 * Gráfico de líneas SVG ligero (sin dependencias) con área, ejes y lectura al pasar el
 * ratón. Solo dibuja datos reales: si no hay puntos, muestra un mensaje.
 */
export function LineChart({
  data,
  color = '#2f6bff',
  height = 160,
  yLabel,
  xFormat,
  yFormat = (v) => v.toFixed(0),
  emptyText = 'Sin datos',
}: {
  data: Series[];
  color?: string;
  height?: number;
  yLabel?: string;
  xFormat: (x: number) => string;
  yFormat?: (y: number) => string;
  emptyText?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // El ancho del SVG sigue al contenedor para que el texto no se deforme.
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height;

  const geo = useMemo(() => {
    if (data.length < 2) return null;
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    let y0 = Math.min(...ys);
    let y1 = Math.max(...ys);
    const span = y1 - y0 || 1;
    y0 = Math.max(0, y0 - span * 0.1);
    y1 = y1 + span * 0.1;
    const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
    const line = data.map((d, i) => `${i ? 'L' : 'M'}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join('');
    const area = `${line}L${sx(x1).toFixed(1)},${H - PAD.b}L${sx(x0).toFixed(1)},${H - PAD.b}Z`;
    const ticks = [0, 0.5, 1].map((f) => y0 + f * (y1 - y0));
    const nx = W < 400 ? 3 : 5;
    const xticks = Array.from({ length: nx }, (_, i) => x0 + (i / (nx - 1)) * (x1 - x0));
    return { sx, sy, line, area, ticks, xticks };
  }, [data, W, H]);

  if (!geo)
    return (
      <div ref={boxRef} className="muted flex items-center justify-center text-center text-sm" style={{ height }}>
        {emptyText}
      </div>
    );

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(geo.sx(data[i].x) - px) < Math.abs(geo.sx(data[best].x) - px)) best = i;
    setHover(best);
  };
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={boxRef}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={yLabel}>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.35" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={geo.sy(t)} y2={geo.sy(t)} className="stroke-slate-200 dark:stroke-ink-700" strokeDasharray="3 3" />
            <text x={PAD.l - 6} y={geo.sy(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px] dark:fill-ink-400">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {geo.xticks.map((t, i) => (
          <text key={t} x={geo.sx(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === geo.xticks.length - 1 ? 'end' : 'middle'} className="fill-slate-500 text-[11px] dark:fill-ink-400">
            {xFormat(t)}
          </text>
        ))}
        <path d={geo.area} fill={`url(#${CSS.escape(id)})`} />
        <path d={geo.line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={geo.sx(h.x)} x2={geo.sx(h.x)} y1={PAD.t} y2={H - PAD.b} className="stroke-slate-400 dark:stroke-ink-400" />
            <circle cx={geo.sx(h.x)} cy={geo.sy(h.y)} r={4} fill={color} stroke="#fff" strokeWidth={2} />
            <text x={Math.min(geo.sx(h.x) + 8, W - 140)} y={PAD.t + 12} className="fill-slate-800 text-[12px] font-semibold dark:fill-slate-100">
              {yFormat(h.y)} {yLabel} · {xFormat(h.x)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

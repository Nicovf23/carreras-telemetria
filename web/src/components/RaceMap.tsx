import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { riderColor } from '../lib/format';
import type { Checkpoint, LiveRow } from '../lib/types';

type Layer = 'map' | 'dark' | 'satellite';

const LAYERS: Record<Layer, { label: string; url: string; attribution: string; maxZoom: number }> = {
  map: {
    label: 'Mapa',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
    maxZoom: 19,
  },
  dark: {
    // Teselas estándar de OSM con un filtro CSS de inversión (ver .tiles-dark en index.css)
    label: 'Oscuro',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios GIS',
    maxZoom: 19,
  },
};

function FitRoute({ route }: { route: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length < 2) return;
    // Espera al primer pintado para que Leaflet conozca el tamaño real del contenedor.
    const t = setTimeout(() => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(route), { padding: [24, 24] });
    }, 50);
    return () => clearTimeout(t);
  }, [map, route]);
  return null;
}

/**
 * Sin recorrido cargado, encuadra a los ciclistas la primera vez que hay posiciones
 * (después el usuario mueve el mapa libremente).
 */
function FitRiders({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    const t = setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    }, 50);
    return () => clearTimeout(t);
  }, [map, points]);
  return null;
}

/** `target` solo cambia de identidad al cambiar la selección, no en cada actualización de posición. */
function FlyToSelected({ target }: { target: { lat: number; lon: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    map.flyTo([target.lat, target.lon], Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, target]);
  return null;
}

function riderIcon(r: LiveRow, selected: boolean) {
  const cls = ['rider-pin'];
  if (selected) cls.push('is-selected');
  if (r.position === 1) cls.push('is-leader');
  if (r.status !== 'finished') {
    if (r.freshness === 'stale') cls.push('is-stale');
    if (r.freshness === 'lost') cls.push('is-lost');
  }
  const flag = /^[A-Za-z]{2}$/.test(r.countryCode) ? `<span class="fi fi-${r.countryCode.toLowerCase()}"></span>` : '';
  return L.divIcon({
    className: 'rider-marker',
    html: `<div class="${cls.join(' ')}" style="background:${riderColor(r.bib)}">${flag}<span>${r.bib}</span></div>`,
    iconSize: [0, 0],
  });
}

export interface TrackLine {
  points: [number, number][];
  color: string;
}

export function RaceMap({
  route,
  checkpoints,
  rows,
  selectedId,
  onSelect,
  track,
  className = '',
}: {
  route: [number, number][] | null;
  checkpoints: Checkpoint[];
  rows: LiveRow[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  track?: TrackLine | null;
  className?: string;
}) {
  const prefersDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const [layer, setLayer] = useState<Layer>(prefersDark ? 'dark' : 'map');
  const selected = rows.find((r) => r.participantId === selectedId) ?? null;
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lon: number } | null>(null);
  const routeMemo = useMemo(() => route ?? [], [route]);

  // Centra el mapa al cambiar la selección
  useEffect(() => {
    if (selected?.location) setFlyTarget({ lat: selected.location.lat, lon: selected.location.lon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const tl = LAYERS[layer];
  const center: [number, number] = routeMemo[0] ?? [18.47, -69.9];

  return (
    <div className={`relative overflow-hidden rounded-xl ${className}`}>
      <MapContainer center={center} zoom={12} className="h-full w-full" preferCanvas={false} zoomControl={false} attributionControl>
        <TileLayer key={layer} url={tl.url} attribution={tl.attribution} maxZoom={tl.maxZoom} className={layer === 'dark' ? 'tiles-dark' : ''} />
        {routeMemo.length < 2 && (
          <FitRiders points={rows.filter((r) => r.location).map((r) => [r.location!.lat, r.location!.lon] as [number, number])} />
        )}
        {routeMemo.length > 1 && (
          <>
            <FitRoute route={routeMemo} />
            <Polyline positions={routeMemo} pathOptions={{ color: '#0b1220', weight: 8, opacity: 0.5 }} />
            <Polyline positions={routeMemo} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.95 }} />
          </>
        )}
        {track && track.points.length > 1 && <Polyline positions={track.points} pathOptions={{ color: track.color, weight: 4, opacity: 0.9, dashArray: '1 0' }} />}
        {checkpoints.map((c) => (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lon]}
            radius={c.kind === 'split' ? 6 : 8}
            pathOptions={{ color: '#fff', weight: 2, fillColor: c.kind === 'start' ? '#22c55e' : c.kind === 'finish' ? '#ef4444' : '#f59e0b', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <strong>{c.name}</strong> · km {(c.distanceM / 1000).toFixed(1)}
            </Tooltip>
          </CircleMarker>
        ))}
        {rows
          .filter((r) => r.location)
          .sort((a, b) => (a.participantId === selectedId ? 1 : 0) - (b.participantId === selectedId ? 1 : 0))
          .map((r) => (
            <Marker
              key={r.participantId}
              position={[r.location!.lat, r.location!.lon]}
              icon={riderIcon(r, r.participantId === selectedId)}
              zIndexOffset={r.participantId === selectedId ? 1000 : (r.position ? 500 - r.position : 0)}
              eventHandlers={{ click: () => onSelect?.(r.participantId) }}
              keyboard
              title={`${r.bib} · ${r.firstName} ${r.lastName}`}
              alt={`Dorsal ${r.bib}, ${r.firstName} ${r.lastName}`}
            />
          ))}
        <FlyToSelected target={flyTarget} />
        <ZoomButtons />
      </MapContainer>

      <div className="absolute left-3 top-3 z-[500] flex overflow-hidden rounded-lg border border-white/10 bg-ink-900/85 p-1 text-xs font-medium shadow-lg backdrop-blur" role="group" aria-label="Capa del mapa">
        {(Object.keys(LAYERS) as Layer[]).map((k) => (
          <button
            key={k}
            onClick={() => setLayer(k)}
            aria-pressed={layer === k}
            className={`rounded-md px-3 py-1.5 transition ${layer === k ? 'bg-brand-500 text-white' : 'text-slate-200 hover:bg-white/10'}`}
          >
            {LAYERS[k].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ZoomButtons() {
  const map = useMap();
  return (
    <div className="absolute bottom-6 right-3 z-[500] flex flex-col overflow-hidden rounded-lg border border-white/10 bg-ink-900/85 shadow-lg backdrop-blur">
      <button className="px-3 py-2 text-lg leading-none text-slate-100 hover:bg-white/10" onClick={() => map.zoomIn()} aria-label="Acercar">
        +
      </button>
      <button className="border-t border-white/10 px-3 py-2 text-lg leading-none text-slate-100 hover:bg-white/10" onClick={() => map.zoomOut()} aria-label="Alejar">
        −
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '../lib/api';
import type { LiveSnapshot } from '../lib/types';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * Suscripción en tiempo real a una carrera. Usa Socket.IO (reconexión automática);
 * mientras el canal está caído recurre a consultas periódicas por REST para que la
 * página nunca muestre datos congelados sin avisar.
 */
export function useLiveRace(slug: string | undefined) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    const apply = (s: LiveSnapshot) => {
      if (!alive) return;
      setSnapshot(s);
      setReceivedAt(Date.now());
    };
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConn('connected');
      socket.emit('race:join', slug, (r: { ok: boolean; error?: string }) => {
        if (!r?.ok) setError(r?.error ?? 'No se pudo unir a la carrera');
      });
    });
    socket.on('disconnect', () => setConn('reconnecting'));
    socket.io.on('reconnect_attempt', () => setConn('reconnecting'));
    socket.on('connect_error', () => setConn('offline'));
    socket.on('race:snapshot', apply);

    // Carga inicial y respaldo por REST cuando no hay canal en tiempo real
    const load = () =>
      api<LiveSnapshot>(`/api/v1/races/${encodeURIComponent(slug)}/live`)
        .then((s) => {
          apply(s);
          setError(null);
        })
        .catch((e) => alive && setError(e.message));
    load();
    const poll = setInterval(() => {
      if (!socket.connected) load();
    }, 5000);

    return () => {
      alive = false;
      clearInterval(poll);
      socket.close();
    };
  }, [slug]);

  return { snapshot, receivedAt, conn, error };
}

/**
 * Reloj de carrera en el cliente: parte de la hora del servidor (simulada en DEMO)
 * y la extrapola localmente con su velocidad para que los cronos avancen con fluidez.
 */
export function useRaceClock(snapshot: LiveSnapshot | null, receivedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!snapshot) return null;
  const base = Date.parse(snapshot.clock.now);
  if (!snapshot.clock.running) return base;
  return base + (now - receivedAt) * snapshot.clock.rate;
}

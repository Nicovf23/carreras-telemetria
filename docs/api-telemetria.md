# API y formato de telemetría

La especificación completa (OpenAPI 3) se sirve en **http://localhost:4000/api/docs** con el
servidor en marcha (fuente: [`server/src/openapi.yaml`](../server/src/openapi.yaml)).

## Resumen de endpoints

### Públicos (sin autenticación)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio |
| GET | `/api/v1/races` | Carreras publicadas (en directo, próximas, finalizadas) |
| GET | `/api/v1/races/{slug}` | Carrera, recorrido, categorías y puntos de control |
| GET | `/api/v1/races/{slug}/live` | Clasificación en vivo (misma estructura que el evento Socket.IO) |
| GET | `/api/v1/races/{slug}/participants/{dorsal}` | Perfil: fila en vivo, parciales, recorrido, FC (si es pública) |
| GET | `/api/v1/races/{slug}/results` | Resultados publicados al cerrar la carrera |

Nunca devuelven email, teléfono, contacto de emergencia, número de serie del dispositivo ni la
frecuencia cardíaca de quien no haya dado su consentimiento (`publicHr`).

### Tiempo real (Socket.IO, ruta `/socket.io`)
```js
const socket = io();
socket.emit('race:join', 'demo-gran-fondo-costa-este', (ack) => console.log(ack));
socket.on('race:snapshot', (snap) => { /* clasificación completa */ });
```
Como máximo una instantánea por segundo de reloj de carrera, más un refresco cada 5 s en carreras
en directo (la antigüedad de los datos cambia aunque no lleguen mensajes).

### Telemetría (dispositivos)
`POST /api/v1/telemetry` — `Authorization: Bearer <serial>.<secreto>`

### Autenticación y administración
`POST /api/v1/auth/login` crea la cookie `session` (httpOnly, SameSite=Strict). Todas las rutas
`/api/v1/admin/*` la exigen; las que modifican datos requieren además la cabecera
`X-Requested-With: fetch`. Roles: `admin` (todo) y `organizer` (no gestiona usuarios, no borra
carreras iniciadas, no modifica carreras finalizadas). Lista completa en `/api/docs`.

## Mensaje de telemetría v1

```json
{
  "v": 1,
  "device_id": "TRK-001",
  "race_id": "opcional-uuid",
  "participant_id": "opcional-uuid",
  "seq": 1842,
  "ts": "2026-10-25T14:03:22.000Z",
  "lat": 18.44972,
  "lon": -69.60615,
  "alt_m": 12.5,
  "speed_kmh": 38.4,
  "heading_deg": 92,
  "fix": { "valid": true, "sats": 11, "hdop": 0.9 },
  "hr_bpm": 152,
  "hr_source": "ant+",
  "battery_pct": 81,
  "rssi_dbm": -79,
  "network": "LTE"
}
```

| Campo | Obligatorio | Validación / significado |
|---|---|---|
| `ts` | **Sí** | Instante UTC **de la medida** (ISO 8601 o ms epoch). Rechazado si está > 30 s en el futuro o tiene > 48 h (configurable) |
| `lat`, `lon` | Si hay posición | Rango válido; `(0,0)` se rechaza (típico de GNSS sin fix) |
| `fix.valid` | No | `false` → la posición se descarta (la FC/batería del mensaje sí se guardan) |
| `fix.hdop` | No | > 10 → posición descartada por baja calidad |
| `speed_kmh` | No | 0–150. Si falta, la plataforma la estima con las dos últimas posiciones (marcada con *) |
| `hr_bpm` | No | 25–250. Solo se muestra si el participante tiene sensor y, en la web pública, consentimiento |
| `battery_pct`, `rssi_dbm`, `network` | No | Estado del dispositivo para el panel |
| `device_id`, `race_id`, `participant_id` | No | Si se envían, deben coincidir con el dispositivo autenticado y su asignación |

La carrera y el participante se resuelven **en el servidor** a partir de la asignación activa del
dispositivo: un dispositivo no puede escribir datos de otro participante.

Un lote: `{ "messages": [ …hasta 500 mensajes… ] }`.

### Respuesta
```json
{ "accepted": 28, "duplicates": 2, "rejected": [{ "index": 5, "reason": "no_gnss_fix" }], "serverTime": "2026-10-25T14:03:25.120Z" }
```
* `200` todo aceptado/duplicado · `207` parcialmente rechazado · `422` todo rechazado
  → en los tres casos el dispositivo **borra esos mensajes de su búfer**.
* `401` credencial no válida · `429` límite (240 peticiones/min por dispositivo) · `5xx` / sin red
  → **reintentar** más tarde con espera exponencial.

Motivos de rechazo: `invalid:<campo>`, `device_mismatch`, `device_not_assigned`, `race_mismatch`,
`participant_mismatch`, `simulated_in_official_race`, `race_closed`, `timestamp_in_future`,
`timestamp_too_old`, `invalid_coordinates`, `no_gnss_fix`, `empty_message`.

## Desconexiones, duplicados y datos fuera de orden

1. **Duplicados:** restricción única `(dispositivo, ts)` en posiciones y FC → un reenvío devuelve
   `duplicates` y no altera nada.
2. **Datos atrasados** (almacenados durante una pérdida de cobertura): se aceptan, se marcan como
   `late` y se incorporan al historial.
3. **Fuera de orden** (llega una medida anterior a la última procesada): el servidor reconstruye el
   progreso y los pasos GPS de ese participante a partir de todas sus posiciones ordenadas, con un
   pequeño retardo para agrupar ráfagas. Los pasos manuales no se tocan.
4. **La "última posición" del mapa** es siempre la de `ts` más reciente, no la última recibida.
5. **Estado de conexión:** se deriva de la antigüedad de la última posición respecto al reloj de
   carrera: en vivo ≤ 15 s, retrasado ≤ 60 s, desactualizado ≤ 5 min, perdido > 5 min.

## Ejemplo con curl (carrera de pruebas)

```bash
curl -X POST http://localhost:4000/api/v1/telemetry \
  -H "Authorization: Bearer TRK-001.<secreto>" \
  -H "Content-Type: application/json" \
  -d '{"ts":"2026-10-25T14:03:22Z","lat":18.4497,"lon":-69.6061,"speed_kmh":35.2,"battery_pct":90}'
```
Úsalo solo con carreras de prueba: lo que se envía a una carrera oficial forma parte de sus datos.

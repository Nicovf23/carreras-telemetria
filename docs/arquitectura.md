# Arquitectura y decisiones técnicas

## Visión general

```
 Dispositivos (HTTPS) ──► POST /api/v1/telemetry ──► TelemetryService ──► PostgreSQL
                                                         │
                                                         ▼
                                                   LiveManager (estado en memoria por carrera,
                                                   motor de cronometraje)
                                                         │ instantáneas (≤ 1/s)
                                    Socket.IO ◄──────────┘
 Navegador (React) ◄──── REST + Socket.IO ────► Fastify
 Simulador DEMO ───► TelemetryService (mismo flujo, marcado como simulado)
```

* **Monorepo npm workspaces:** `server/` (API) y `web/` (SPA). En producción el servidor sirve
  también `web/dist`, así que basta un proceso.
* **La API es independiente del cliente**: una futura app nativa o PWA usa los mismos endpoints
  REST y el mismo canal Socket.IO.

## Tecnologías y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Backend | Node.js + TypeScript + **Fastify 5** | Rápido, tipado, plugins oficiales (CORS, cookies, rate‑limit, Swagger) |
| Validación | **Zod** | Un único esquema valida y tipa cada mensaje |
| BD | **PostgreSQL**; en local **PGlite** por defecto | PGlite es PostgreSQL compilado a WASM: el mismo SQL sin instalar nada en Windows. Con `DATABASE_URL` se usa un PostgreSQL real |
| Migraciones | SQL plano numerado (`server/src/db/migrations`) | Legibles y portables, sin ORM |
| Tiempo real | **Socket.IO** | Reconexión automática, salas por carrera, *fallback* a long‑polling |
| Autenticación | Cookie httpOnly con JWT HS256 (`jose`), contraseñas **bcrypt** | Sin tokens accesibles desde JavaScript; protección CSRF con SameSite=Strict + cabecera obligatoria |
| Dispositivos | Token `serial.secreto` por dispositivo, solo se guarda SHA‑256 | Simple de grabar en firmware y enviar con `AT+HTTPPARA="USERDATA"` |
| Frontend | React 19 + TypeScript + Vite + **Tailwind CSS 4** | Propuesta inicial; sin librerías de componentes pesadas |
| Mapa | **Leaflet** + react‑leaflet, teselas OpenStreetMap (con atribución) y Esri World Imagery para satélite | Sin claves de API |
| Banderas | **flag-icons** (SVG por código ISO 3166‑1) | No depende de emojis (en Windows los emojis de bandera no se ven) |
| Pruebas | **Vitest** | Unitarias del motor y de integración de la API sobre PGlite en memoria |

## Modelo de datos

`users`, `races`, `race_categories`, `race_segments`, `checkpoints`, `participants`, `devices`,
`device_assignments`, `positions`, `heart_rate_samples`, `checkpoint_passings`, `results`,
`audit_log` (ver [001_init.sql](../server/src/db/migrations/001_init.sql)).

* `races.mode` = `official` | `demo`. Los dispositivos `is_simulated` solo pueden asignarse a
  carreras DEMO y el servicio de telemetría rechaza cualquier dato simulado dirigido a una carrera
  oficial (`simulated_in_official_race`). Cada posición/FC guarda además `is_simulated`.
* `checkpoint_passings.source` = `gps` (interpolado) | `manual` (juez) | `mat` (alfombra, futuro).
  Prioridad manual > alfombra > GPS.
* `results` es una instantánea inmutable publicada al finalizar.

### Preparado para triatlón
* `races.discipline` admite `triathlon`, y `race_segments` (`swim`, `t1`, `bike`, `t2`, `run`)
  agrupa puntos de control por disciplina (`checkpoints.segment_id`).
* Los parciales por disciplina serán diferencias entre los pasos por el inicio y el fin de cada
  segmento; el motor ya trabaja con pasos por punto/vuelta, por lo que no hay que rehacerlo.
* Falta (a propósito): UI de segmentos, recorridos distintos por segmento (natación sin GPS
  fiable → alfombras/chips) y la clasificación por disciplina.

## Reglas de cronometraje (`server/src/timing`)

Se distinguen explícitamente cinco magnitudes:

1. **Tiempo transcurrido**: `ahora − salida` (salida general o individual en contrarreloj); en meta,
   `llegada − salida`.
2. **Tiempo de paso por un punto de control**: instante en que el corredor cruza la distancia del
   punto en el recorrido, **interpolado linealmente** entre las dos posiciones GPS que lo rodean
   (si están separadas ≤ 10 min). Un juez puede registrar el paso manualmente y prevalece.
3. **Diferencia con el líder** y 4. **con el anterior**, con este orden de preferencia:
   * ambos en meta → diferencia de tiempos finales;
   * **estimada** (si la carrera lo permite y la posición del corredor es reciente): instante en
     que el de referencia pasó por **el punto exacto del recorrido donde está ahora el corredor**
     (punto de control virtual interpolado en su historial, con muestras separadas ≤ 120 s). Se
     marca con «≈» en la interfaz;
   * último **punto de control común** a ambos;
   * si nada de lo anterior es fiable → **«Sin referencia temporal»**. Nunca se resta posiciones
     GPS ni se divide distancia por velocidad para inventar un tiempo.
   Se comparan tiempos transcurridos (no horas absolutas) para que las salidas individuales sean
   correctas.
5. **Distancia entre corredores**: en línea recta (haversine) y a lo largo del recorrido, solo con
   posiciones de ambos con menos de 60 s.

**Progreso**: cada posición se proyecta sobre la polilínea del recorrido (con una ventana alrededor
del progreso anterior para resolver recorridos de ida y vuelta). Se descartan posiciones a más de
150 m del recorrido y saltos de más de 108 km/h. El progreso es monótono (el ruido GPS hacia atrás
no hace perder posiciones).

**Vueltas**: en circuitos cerrados se elige la vuelta que da continuidad con la muestra anterior;
la línea de meta cuenta las vueltas intermedias (`Meta · vuelta k`) y la última es la llegada.

**Orden**: llegados por tiempo final → en carrera por progreso (desempate por quién pasó antes por
su último punto) → inscritos sin datos → DNF → DSQ → DNS.

## Modo DEMO

`server/src/demo/` crea «Gran Fondo Costa Este» (Boca Chica → San Pedro de Macorís, trazado real
por carretera obtenido de OSRM/OpenStreetMap) con 12 ciclistas ficticios de 12 países. El simulador
usa un reloj de carrera propio (×1 a ×60) y un generador pseudoaleatorio con semilla fija
(reproducible). Escenarios: cobertura intermitente con reenvío ordenado (dorsal 4), reenvío
desordenado (8), batería agotada (7), avería y parada (10), sin dispositivo (12), FC privada (6),
sin sensor de FC (3, 8, 12) y ~1 % de posiciones sin fix.

## Seguridad

* Sin secretos en el código: `.env` (ignorado por git) con `JWT_SECRET`, credenciales iniciales y
  `DATABASE_URL`; `.env.example` sin valores.
* Contraseñas con bcrypt (coste 12); respuesta de login de tiempo constante; límite de 10
  intentos/min.
* Claves de dispositivo de 192 bits, mostradas una sola vez, comparadas en tiempo constante;
  rotación y desactivación desde el panel.
* Todas las entradas validadas con Zod; consultas siempre parametrizadas.
* Exportación CSV protegida contra inyección de fórmulas.
* Registro estructurado (pino) con redacción de contraseñas, cookies y cabeceras de autorización;
  auditoría de todas las acciones de organizadores.
* Las carreras finalizadas solo las puede modificar o reabrir un administrador (queda auditado);
  la telemetría a una carrera cerrada se rechaza.

## Limitaciones conocidas

* El estado en vivo se mantiene en memoria de **un** proceso; para escalar horizontalmente habría
  que compartirlo (Redis + adaptador de Socket.IO).
* Las instantáneas envían la clasificación completa: suficiente para cientos de corredores; para
  miles convendría enviar diferencias.
* Las teselas de tile.openstreetmap.org tienen una política de uso justo: en producción usar un
  proveedor de teselas propio o contratado.

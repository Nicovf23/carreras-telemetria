# Carreras Telemetría

Plataforma web de **seguimiento GPS y cronometraje en tiempo real** para carreras de ciclismo de
ruta (preparada para ampliarse a triatlón). Proyecto Final de Carrera de Telecomunicaciones.

* **Sitio público**: carreras en directo/próximas/finalizadas, mapa con cada ciclista (dorsal y
  bandera), clasificación en vivo con diferencias al líder y al anterior, velocidad, distancia,
  frecuencia cardíaca y estado del dispositivo, filtros y perfil de cada participante.
* **Panel del organizador**: carreras, recorrido (GPX), puntos de control, participantes (CSV),
  dispositivos y sus claves, salida y cierre, pasos manuales, monitor de dispositivos y exportación.
* **API de telemetría** segura para los dispositivos de seguimiento, con soporte para datos
  duplicados, atrasados y fuera de orden.
* **Modo DEMO** con 12 ciclistas ficticios y telemetría simulada, siempre identificado como DEMO.

> Estado: la plataforma web funciona de extremo a extremo con datos simulados. **Ningún dispositivo
> físico está integrado todavía.** Ver [docs/estado.md](docs/estado.md).

## Requisitos (Windows)

* **Node.js 20 o superior** (probado con Node 24): https://nodejs.org → instalador LTS.
* **Git** (opcional, para clonar).
* No hace falta instalar PostgreSQL: por defecto se usa **PGlite** (PostgreSQL embebido). Para usar
  un PostgreSQL real, ver más abajo.

## Instalación y ejecución local

En PowerShell o en la terminal de VS Code, dentro de la carpeta del proyecto:

```bash
npm install
```

```bash
copy .env.example .env
```

Edita `.env` y rellena como mínimo:

* `JWT_SECRET`: genera uno con
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
* `ADMIN_EMAIL` y `ADMIN_PASSWORD` (mín. 10 caracteres): el administrador que se crea en el primer
  arranque.

Arranca API y web a la vez:

```bash
npm run dev
```

* Web: **http://localhost:5173**
* API y documentación OpenAPI: **http://localhost:4000/api/docs**
* Panel del organizador: http://localhost:5173/admin (con `ADMIN_EMAIL` / `ADMIN_PASSWORD`)

Con `DEMO_AUTOSTART=true` la carrera DEMO empieza sola a velocidad ×10 (`DEMO_SPEED`) y se repite al
terminar. Desde el panel (Carreras → Gran Fondo Costa Este → General) se puede iniciar, pausar,
cambiar la velocidad o borrar los datos simulados.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | API (puerto 4000, recarga automática) + web (Vite, puerto 5173) |
| `npm test` | Pruebas del motor de cronometraje y de la API |
| `npm run typecheck` | Comprobación de tipos de servidor y web |
| `npm run build` | Compila servidor (`server/dist`) y web (`web/dist`) |
| `npm start` | Producción: un solo proceso en el puerto 4000 que sirve API + web compilada |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:seed` | Crea la carrera DEMO |
| `npm run device:key -w server -- TRK-001` | Registra un dispositivo (o regenera su clave) y muestra el token una vez |

### Usar PostgreSQL en lugar de PGlite

1. Instala PostgreSQL 14+ (instalador de https://www.postgresql.org/download/windows/) o con Docker:
   `docker run -d --name carreras-pg -e POSTGRES_PASSWORD=<elige-una> -e POSTGRES_DB=carreras -p 5432:5432 postgres:16`
2. En `.env`: `DATABASE_URL=postgres://postgres:<la-contraseña>@localhost:5432/carreras`
3. `npm run db:migrate` (también se aplican solas al arrancar).

Para empezar de cero con PGlite, detén el servidor y borra la carpeta `data/`.

## Flujo para una carrera real

1. **Carreras → Nueva carrera** (modo *Oficial*), publícala como *Próxima*.
2. **Recorrido**: carga el GPX; se crean la salida y la meta. Añade puntos de control por kilómetro.
3. **Participantes**: alta manual o **Importar CSV** (ejemplo en
   [docs/ejemplos/participantes.csv](docs/ejemplos/participantes.csv)); valida antes de importar.
4. **Dispositivos** (menú lateral): registra cada equipo y guarda su token (solo se muestra una vez).
5. **Dispositivos** (pestaña de la carrera): asocia cada dispositivo a un participante.
6. **General → Dar la salida**. Supervisa en **Monitor**. Registra pasos manuales si hace falta.
7. **Finalizar carrera y publicar resultados** → **Exportar**.

## Estructura

```
server/            API Fastify + TypeScript
  src/timing/      Motor de cronometraje (puro, con pruebas)
  src/services/    Estado en vivo, ingesta de telemetría, autenticación
  src/routes/      Rutas públicas, admin, auth y telemetría
  src/demo/        Carrera DEMO y simulador
  src/db/          Conexión (PostgreSQL / PGlite) y migraciones SQL
  src/openapi.yaml Contrato de la API
web/               SPA React + Vite + Tailwind + Leaflet
docs/              Arquitectura, API, hardware, estado
```

## Documentación

* [Arquitectura, decisiones técnicas y reglas de cronometraje](docs/arquitectura.md)
* [API y formato de los mensajes de telemetría](docs/api-telemetria.md)
* [Hardware: funciones, compatibilidad, ANT+ y verificaciones pendientes](docs/hardware.md)
* [Qué está implementado, qué es simulado y qué falta](docs/estado.md)

## Créditos de datos

Mapas © colaboradores de [OpenStreetMap](https://www.openstreetmap.org/copyright). Imágenes de
satélite © Esri y proveedores. Banderas: [flag-icons](https://github.com/lipis/flag-icons) (MIT).

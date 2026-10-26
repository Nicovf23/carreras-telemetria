# Estado del proyecto (versión 0.1)

## ✅ Implementado y probado

| Área | Detalle | Cómo se ha comprobado |
|---|---|---|
| Motor de cronometraje | Proyección sobre recorrido, progreso monótono, vueltas, pasos interpolados, diferencias (meta / estimada / punto común / sin referencia), salidas individuales, distancias, velocidad, frescura | 24 pruebas unitarias (`server/src/timing/timing.test.ts`) |
| API REST + OpenAPI | Público, autenticación, administración, telemetría | 17 pruebas de integración y de formatos sobre PGlite (`server/src/api.test.ts`) |
| Telemetría | Autenticación por dispositivo, lotes, validación, duplicados, datos atrasados y desordenados, separación DEMO/oficial | Pruebas de integración + simulador |
| Tiempo real | Socket.IO por carrera, *fallback* REST, reloj de carrera extrapolado en el cliente | Navegador |
| Sitio público | Portada, página de carrera (mapa, clasificación de 12 columnas, filtros, selección mapa↔tabla, puntos de control), perfil del ciclista (parciales, recorrido, gráficas) | Navegador (escritorio y 375 px) |
| Panel organizador | Login, roles, CRUD de carreras, GPX, puntos de control, categorías, participantes, importación CSV con validación previa, pasos manuales, dispositivos (token de un solo uso, rotación, desactivación), asignación, inicio/cierre/reapertura, monitor, exportación CSV/JSON, usuarios, auditoría | Pruebas de API (todas las operaciones); revisado en navegador: login, listado, monitor. Formularios (GPX, CSV, alta de dispositivos) sin probar a mano en navegador |
| Modo DEMO | 12 ciclistas ficticios, reloj simulado ×1–×60, escenarios de fallo | Navegador |
| Modo oscuro / claro | Conmutador con preferencia guardada | Navegador |

## 🟡 Simulado (no es real)

* **Toda la carrera «Gran Fondo Costa Este»**: participantes, posiciones, velocidades, frecuencia
  cardíaca, batería, señal y desconexiones son generados por `server/src/demo/simulator.ts`. Se
  identifica con la etiqueta **DEMO** en todas las pantallas y exportaciones.
* El trazado de la carrera DEMO es real (carreteras de OpenStreetMap vía OSRM); los tiempos no.

## ❌ Pendiente para conectar dispositivos físicos

Ver [hardware.md](hardware.md). Ninguna de estas tareas está completada:

1. Confirmar la variante exacta del módulo SIMCom (A7670SA vs A7672SA, con o sin GNSS).
2. Diseñar la alimentación (picos de ~2 A) y la adaptación de niveles UART.
3. Firmware del XIAO nRF52840: GNSS → búfer en flash → HTTPS por comandos AT con el token del
   dispositivo, según [api-telemetria.md](api-telemetria.md).
4. Lectura de FC por BLE (perfil Heart Rate) — viable con el core Arduino.
5. Lectura de FC por **ANT+**: requiere nRF5 SDK + SoftDevice S340 o nRF Connect SDK + add‑on ANT
   de Garmin, con licencia de evaluación (no comercial).
6. Pruebas de campo: cobertura LTE en el recorrido, precisión GNSS, autonomía.
7. Despliegue con HTTPS (proxy inverso con certificado) — imprescindible para que los tokens de
   dispositivo no viajen en claro.

## Mejoras previstas en la plataforma

* Alfombras/chips de cronometraje (`source = 'mat'`) mediante un endpoint de lectores.
* Lógica de triatlón (segmentos y parciales por disciplina; el modelo de datos ya lo admite).
* PWA instalable y notificaciones.
* Escalado horizontal (Redis) para eventos grandes.

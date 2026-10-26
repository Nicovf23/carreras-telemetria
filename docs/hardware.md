# Hardware de seguimiento: funciones, compatibilidad e integración

> **Estado:** ninguna integración física está completada ni probada. Este documento recoge
> qué hace cada componente, qué se ha comprobado en documentación oficial y qué queda por
> verificar en banco antes de escribir firmware definitivo.

## 1. Componentes de referencia y su función

Los tres módulos **no son un único dispositivo** ni cumplen la misma función. Son piezas de un
diseño que todavía hay que cerrar:

| Componente | Qué es | Función propuesta en el dispositivo | Qué NO hace |
|---|---|---|---|
| **Seeed Studio XIAO nRF52840** | Placa con SoC Nordic nRF52840 (Cortex‑M4F 64 MHz), radio 2,4 GHz con antena integrada, cargador de Li‑Po (BQ25101), USB‑C | Microcontrolador principal de bajo consumo **y** receptor de sensores deportivos (BLE y, con la pila adecuada, ANT+) | No tiene módem celular ni receptor GNSS |
| **SIMCom A7670SA / A7672SA** | Módulo LTE Cat‑1 (+2G) en formato LGA | Enlace de datos (HTTPS o MQTT) hacia la plataforma. Según la variante, también **GNSS** | No recibe ANT+ ni BLE de sensores (algunas variantes tienen BT, pero no ANT) |
| **ESP32** | MCU con Wi‑Fi y Bluetooth (BLE 4.2 en el ESP32 clásico, BLE 5 en S3/C3) | Alternativa al XIAO como MCU principal, o pasarela Wi‑Fi para pruebas en banco | **No tiene radio ANT**: no puede recibir ANT+ sin un chip adicional |
| Antena celular | Antena LTE adaptada a las bandas usadas | Conectada al puerto MAIN del A76xx | — |
| Antena GNSS (activa recomendada) | Antena L1 | Conectada al puerto GNSS del A76xx (si la variante lo tiene) o a un receptor GNSS separado | — |
| Sensores deportivos | Banda de pecho FC, potenciómetro, cadencia… | Fuente de frecuencia cardíaca (ANT+ y/o BLE Heart Rate Profile) | — |

**Recomendación de arquitectura (a validar):** una sola MCU — el **XIAO nRF52840** — que lee los
sensores por radio y gobierna el A76xx por UART con comandos AT. El ESP32 solo aporta valor si se
necesita Wi‑Fi; añadirlo junto al nRF52840 duplica consumo y complejidad sin resolver ANT+.

```
 [Banda FC ANT+/BLE] ))) 2,4 GHz )))  [XIAO nRF52840] --UART (AT)--> [A7670SA] ))) LTE ))) Plataforma
                                           |                             |
                                     Li-Po + BQ25101               Antena GNSS (si variante GNSS)
```

## 2. Lo que se ha verificado en documentación oficial

### SIMCom A7670SA / A7672SA
* LTE Cat‑1, hasta 10 Mbps DL / 5 Mbps UL. Bandas LTE‑FDD **B1/B2/B3/B4/B5/B7/B8/B28/B66** según las
  fichas de SIMCom y EverythingRF.
* **El GNSS depende de la variante** (sufijo de pedido). En la serie A7672 SIMCom lo marca como
  opción; distribuidores listan por separado versiones "CAT1+2G+GNSS&BT". No se ha encontrado una
  tabla oficial que explique los sufijos `-FASE` / `-LASE`; hay que confirmarlo con el número de
  pieza exacto del módulo comprado (etiqueta del módulo y *ordering information* del datasheet).
* Las bandas cubren las que la información pública (no oficial, colaborativa) atribuye a los
  operadores de República Dominicana: Claro (B2, B4, B7), Altice (B2, B4, B5, B8), Viva (B4).
  **A verificar con Indotel / el operador y con una SIM real en la zona de la carrera.**

### nRF52840 y ANT+
* **BLE y ANT+ son protocolos distintos.** Un sensor solo ANT+ no se puede leer con una pila BLE.
* El nRF52840 sí puede ejecutar ANT: Nordic y Garmin (propietaria de ANT) ofrecen
  * **S340 SoftDevice** (ANT + Bluetooth 5) para el **nRF5 SDK**, distribuida por Garmin Canada;
  * un **add‑on ANT para nRF Connect SDK**, alojado por Garmin, sujeto al *ANT+ Adopter Agreement*.
* La licencia de **evaluación** es gratuita pero **no permite uso comercial**; el uso comercial
  requiere licencia y declaración de royalties con Garmin/ANT Wireless.
* Las bibliotecas Arduino de Seeed para el XIAO nRF52840 usan pilas Bluetooth (la página oficial
  de la placa no menciona ANT). **Para ANT+ hay que salir del entorno Arduino** y compilar con
  nRF5 SDK + S340 o nRF Connect SDK + add‑on ANT, y flashear por SWD (el bootloader UF2 de la placa
  puede no ser compatible con otra SoftDevice: verificar o usar un programador J‑Link/DAPLink).

### ESP32
* No incorpora radio ANT. Opciones si se insiste en ESP32 + ANT+: un coprocesador ANT (por ejemplo
  un segundo nRF52 con S340 actuando como puente por UART). Recibir **solo BLE Heart Rate** sí es
  posible directamente con el ESP32.

## 3. Pendiente de verificar en banco (antes de escribir firmware)

| # | Verificación | Cómo | Estado |
|---|---|---|---|
| 1 | Variante exacta del módulo celular y si tiene GNSS | Leer etiqueta; `ATI`, `AT+CGMR`; `AT+CGNSSPWR=1` y `AT+CGNSSINFO` (o `AT+CGPSINFO`) | ❌ Pendiente |
| 2 | Niveles lógicos UART del A76xx frente a los 3,3 V del XIAO | *Hardware Design* de SIMCom (los módulos A76xx suelen usar 1,8 V en E/S); muchas placas de evaluación ya incluyen conversor | ❌ Pendiente |
| 3 | Alimentación del A76xx | VBAT ≈ 3,4–4,2 V con picos de ~2 A en transmisión: Li‑Po directa o regulador capaz + condensadores | ❌ Pendiente |
| 4 | Registro en red LTE con SIM local en la zona de carrera | `AT+CPIN?`, `AT+CSQ`, `AT+CEREG?`, `AT+CPSI?` | ❌ Pendiente |
| 5 | Envío HTTPS desde el módulo | `AT+HTTPINIT`, `AT+HTTPPARA="URL",…`, `AT+HTTPPARA="USERDATA","Authorization: Bearer …"`, `AT+HTTPDATA`, `AT+HTTPACTION=1` (comprobar soporte TLS y CA en la versión de firmware) | ❌ Pendiente |
| 6 | Fix GNSS y precisión en movimiento | Registrar NMEA en bicicleta; comparar con un ciclocomputador | ❌ Pendiente |
| 7 | Lectura de FC por BLE (Heart Rate Service 0x180D) | Ejemplo `central_hrm` de Adafruit/Seeed nRF52 core | ❌ Pendiente |
| 8 | Lectura de FC por ANT+ (perfil HRM, canal esclavo, red ANT+ 57 = 2457 MHz) | nRF5 SDK + S340, ejemplo `ant_hrm_rx` (licencia de evaluación) | ❌ Pendiente |
| 9 | Consumo y autonomía (objetivo ≥ 5 h) | Medir con PPK2 o multímetro con registro | ❌ Pendiente |

## 4. Contrato con la plataforma (ya implementado en el servidor)

El firmware solo necesita cumplir el formato de [api-telemetria.md](api-telemetria.md):

1. Muestrear GNSS (p. ej. 1 Hz) y FC; enviar cada 5 s un lote con las muestras acumuladas.
2. **Marca temporal de la medida** (`ts`) en UTC, obtenida del GNSS (más fiable que el reloj de red).
3. Guardar en memoria no volátil (flash/QSPI del XIAO) los mensajes no confirmados.
4. Enviar en lotes de hasta 500, **del más antiguo al más reciente**; borrar del búfer los
   confirmados (respuestas 200/207/422) y reintentar con espera exponencial ante 429/5xx/sin red.
5. El servidor deduplica por `(dispositivo, ts)`: reenviar es siempre seguro.
6. Usar `serverTime` de la respuesta solo como diagnóstico de reloj (la hora válida es la del GNSS).

## 5. Fuentes consultadas

* SIMCom – familia A7670X: https://cn.simcom.com/product/A7670X.html
* SIMCom – familia A7672X: https://en.simcom.com/product/A7672X.html
* EverythingRF – A7670SA: https://everythingrf.com/products/cellular-modules/simcom/811-765-a7670sa
* EverythingRF – A7672SA: https://www.everythingrf.com/products/cellular-modules/simcom/811-765-a7672sa
* DigiKey – A7672SA‑LASE: https://azcus.digikey.com/en/products/detail/simcom-wireless-solutions-limited/A7672SA-LASE/15841449
* Nordic – S340 SoftDevice: https://www.nordicsemi.com/Products/Development-software/S340-ANT
* Nordic – software ANT: https://www.nordicsemi.com/Products/ANT/Development-software
* Garmin – ANT para nRF Connect SDK: https://developer.garmin.com/ant-program/nrf-connect-sdk/
* Garmin – ANT para nRF5 SDK: https://developer.garmin.com/ant-program/nrf5-sdk/
* Seeed – XIAO nRF52840: https://wiki.seeedstudio.com/XIAO_BLE/
* Bandas en República Dominicana (colaborativo, no oficial): https://www.kimovil.com/es/frequency-checker/DO

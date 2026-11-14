# Conexión del XIAO nRF52840 con el módem SIMCom A7670SA‑FASE

> **Placa usada en este proyecto:** placa genérica **«CAT1 24x24»** con módulo A7670SA (dos ranuras
> SIM, micro‑USB, regulador UTC, pines de audio SPK/MIC). **No es la AND BK‑A7670**: no hay manual
> del fabricante, así que **el nivel lógico de UTX/URX debe medirse** antes de conectarla al XIAO
> (ver «Medición previa»). Los comandos AT proceden del *A76XX Series AT Command Manual V1.12*.
>
> | Conector de antena | Rótulo | Uso con A7670 (4G) |
> |---|---|---|
> | Arriba al centro | (4G/NB) | **Antena LTE principal** |
> | Derecha | GPS(4G) | **Antena GPS** |
> | Arriba a la izquierda | …(NB) | No se usa (módulos NB‑IoT) |
> | Izquierda | BT | No se usa |
>
> Fila de pines: `GND · URX · UTX · PWR‑K · 5‑12V · GND · SLEEP` (más SPK/MIC de audio, sin uso).
>
> ### Cableado verificado en banco (14 nov 2026)
> `GND → GND` · `URX → D6` · `UTX → D7`. Medidas: URX 3,29 V, UTX 1,3 V (flotante). Los rótulos
> están **desde el punto de vista del microcontrolador** (URX = «a tu RX»): el firmware usa RX en D6 y
> TX en D7, lo detecta solo y activa la resistencia de subida en su RX. Módem alimentado por su
> micro‑USB; PWR‑K sin conectar (arranca solo). Resultado: AT, SIM, LTE Altice B4, GNSS y HTTPS OK.
>
> ### Medición previa (obligatoria)
> Con el módem alimentado por su micro‑USB y **sin conectar al XIAO**, mide UTX→GND y URX→GND:
> 3,0–3,4 V → conexión directa · ≈1,8 V → adaptador de niveles TXS0108E/BSS138 · ≈5 V → divisor
> resistivo en UTX→D7.
>
> El resto de este documento se escribió para la placa AND BK‑A7670 (`S G V K T R G`); su tabla de
> cableado vale para la placa CAT1 24x24 **solo si la medición da ~3,3 V**: UTX = T, URX = R,
> PWR‑K = K, 5‑12V = V.

## Qué hace cada parte

| Parte | Función |
|---|---|
| XIAO nRF52840 | Cerebro del equipo: recibe ANT+ (FC y potencia), controla el módem, guarda datos si no hay cobertura |
| A7670SA‑FASE | LTE Cat‑1 + 2G para enviar a la plataforma, y **GNSS** (GPS, GLONASS, Galileo) para la posición |
| Antena LTE → conector marcado **LTE** (J1, abajo a la izquierda, junto al condensador amarillo) | Obligatoria. Sin ella el módem no se registra en Claro/Altice |
| Antena GPS → conector marcado **GPS** (J2, lado derecho) | Obligatoria para la posición. Debe ver el cielo |
| Conector **BT** (J3, abajo a la derecha) y el conector sin rótulo junto al USB | No se usan |
| Nano‑SIM (Claro o Altice) | En **CN2**, con datos activos y **sin PIN** |

Bandas: el A7670SA admite LTE B1/B2/B3/B4/B5/B7/B8/B28/B66 y 2G 850/900/1800/1900. Según datos
públicos (no oficiales), Claro RD usa LTE B2/B4/B7 y Altice B2/B4/B5/B8: **ambos están cubiertos**.

## Conector de 7 pines del módem (CN101)

La placa es la **AND BK‑A7670 v1**. Según la cara, el rótulo es una letra o un nombre:

| Marca | Nombre en la otra cara | Señal | Nota del fabricante |
|---|---|---|---|
| S | SLEEP | DTR | Despertar del modo reposo (opcional) |
| G | GND | GND | |
| V | 5‑12 | VCC | **5–10 V, recomendado 5 V, mínimo 2 A** |
| K | PWR‑K | PWRKEY | Unido a GND de fábrica (R104): el módem **arranca solo** al alimentarlo |
| T | UTX | TXD | Salida del módem, lógica **3,3 V** |
| R | URX | RXD | Entrada del módem, lógica **3,3 V** |
| G | GND | GND | |

## Cableado XIAO ↔ módem

```
   XIAO nRF52840                      Placa A7670SA (CN101)
   ┌───────────────┐                  ┌──────────────────┐
   │ D6 / TX (P1.11)├────────────────►│ R  (RXD)         │
   │ D7 / RX (P1.12)│◄────────────────┤ T  (TXD)         │
   │ GND            ├─────────────────┤ G  (GND)         │
   │                │                 │ V  (5 V, 2 A) ◄──┼── fuente de 5 V (ver abajo)
   │                │                 │ K  (sin conectar)│
   │                │                 │ S  (sin conectar)│
   └───────────────┘                  └──────────────────┘
```

* **TX con RX cruzados**: D6 (TX del XIAO) va a **R**; **T** va a D7 (RX del XIAO).
* **GND común siempre**, aunque cada placa tenga su propia alimentación.
* `K` y `S` quedan sin conectar: el módem se enciende solo.

### Alimentación — lo más importante

El módem pide picos de **2 A** al transmitir. **No lo alimentes desde el pin 3V3 del XIAO** (no
aguanta y además es 3,3 V). Opciones:

1. **En la mesa (pruebas):** alimenta el módem por **su propio USB** con un cargador de móvil de
   5 V / 2 A, y el XIAO por su USB a la PC. Une **solo G, T y R**. **No conectes V** en este caso
   (habría dos fuentes de 5 V en paralelo).
2. **En la bici (definitivo):** una batería Li‑Po de 1 celda (3,7 V, ≥ 2000 mAh) con un **elevador
   a 5 V capaz de 2–3 A** (o un *power bank* pequeño). Su salida de 5 V va a **V** del módem y al
   pin **5V** del XIAO; las masas, todas unidas. Pon un condensador de **1000 µF / 10 V** entre V y G
   cerca del módem para absorber los picos.

## Programar y probar

1. Carga en el XIAO el programa puente [`firmware/modem-puente`](../firmware/modem-puente): todo
   lo que escribes por el USB del XIAO llega al módem y viceversa.
2. Abre el monitor serie (115200) y prueba:

| Comando | Respuesta esperada | Qué comprueba |
|---|---|---|
| `AT` | `OK` | Cableado TX/RX correcto |
| `ATI` | Modelo `A7670SA`, versión | Variante exacta del módulo |
| `AT+CPIN?` | `+CPIN: READY` | SIM detectada y sin PIN |
| `AT+CSQ` | `+CSQ: 15,99` (≥ 10 es aceptable) | Nivel de señal |
| `AT+CEREG?` | `+CEREG: 0,1` (o `0,5` itinerancia) | Registrado en LTE |
| `AT+COPS?` | Nombre del operador | Claro / Altice |
| `AT+CGNSSPWR=1` | `OK` y luego `+CGNSSPWR: READY!` | GNSS encendido (~9 s) |
| `AT+CGNSSINFO` | Línea con lat/lon tras el primer fix (al aire libre, 1–5 min) | Posición GPS |

3. Con todo verificado, se carga el firmware definitivo del rastreador.

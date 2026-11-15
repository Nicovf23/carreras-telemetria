# Firmware del rastreador

| Carpeta | Para qué |
|---|---|
| [`rastreador/`](rastreador) | **Firmware definitivo**: GPS + LTE + envío a la plataforma (+ ANT+ cuando haya S340) |
| [`modem-puente/`](modem-puente) | Diagnóstico: reenvía comandos AT entre el USB y el módem |
| [`xiao-prueba/`](xiao-prueba) | Prueba básica de la placa: LED, puerto serie y escaneo Bluetooth |

Cableado y alimentación: [docs/conexiones.md](../docs/conexiones.md).

## Verificado en banco (14 nov 2026)

| Prueba | Resultado |
|---|---|
| Módem | `A7670SA-FASE`, firmware `A011B09A7670M7_F` |
| SIM / red | Altice RD (`370-01`), LTE **banda 4**, CSQ 22 (≈ −69 dBm), datos con APN automático |
| GNSS | Fix 3D, 11–15 satélites, hora UTC del GPS |
| HTTPS | `200 OK` tras activar **SNI** (`AT+CSSLCFG="enableSNI",0,1`); sin SNI falla con error 715 |
| UART | Los rótulos `URX`/`UTX` de la placa CAT1 24x24 son desde el punto de vista del micro: el firmware detecta la orientación solo y la guarda |
| Rastreador | Arranca, registra red, obtiene fix y llena el búfer |
| **Pendiente** | Envío extremo a extremo a la plataforma (falta token y URL pública); ANT+ (falta S340) |

## Instalar las herramientas (Windows, una vez)

```bash
winget install ArduinoSA.CLI
```

```bash
arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
```

```bash
arduino-cli core update-index
```

```bash
arduino-cli core install Seeeduino:nrf52
```

## Compilar y cargar

Conecta el XIAO por USB‑C y mira su puerto (`arduino-cli board list`, por ejemplo `COM8`):

```bash
arduino-cli compile -u -p COM8 --fqbn Seeeduino:nrf52:xiaonRF52840Sense --build-property "recipe.objcopy.uf2.pattern=cmd /c rem" firmware/rastreador
```

* `--build-property …uf2…` evita un paso opcional que falla con el Python de la Microsoft Store.
* Si la carga falla («port could not be opened»), pulsa **dos veces rápido** el botón RST del XIAO
  (aparece la unidad `XIAO-SENSE`) y repite con el nuevo puerto COM.

## Dar identidad a cada equipo

1. En el panel: **Dispositivos → Registrar dispositivo** (p. ej. `TRK-001`). Copia el token, que
   solo se muestra una vez.
2. En la carrera: pestaña **Dispositivos**, asocia `TRK-001` al ciclista.
3. Abre el monitor serie del XIAO (115200 baudios):

```bash
arduino-cli monitor -p COM8 -c baudrate=115200
```

y escribe:

```
token TRK-001.<secreto>
url https://<tu-app>.onrender.com/api/v1/telemetry
bateria si
estado
```

El token queda en la flash del XIAO (nunca en el código). El servidor sabe de quién es cada dato
porque cada token pertenece a un único dispositivo, y cada dispositivo está asignado a un ciclista.

## Comportamiento

* Posición cada 5 s (`muestreo`), envío cada 5 s (`envio`), en lotes de hasta 40.
* **Sin fix GNSS no se guarda ninguna posición** (no se inventan datos).
* Sin cobertura: hasta 2 h de datos en RAM; se envían del más antiguo al más reciente al volver.
* Respuesta 200/207/422 → se borran del búfer; 401 → token incorrecto; 409 → dispositivo sin asignar
  a un ciclista (se conservan); otros → reintento con espera exponencial (5 s → 2 min).
* LED: azul parpadeando = buscando GPS · verde = último envío correcto · rojo = fallo de envío.

## ANT+ (frecuencia cardíaca y potencia)

`rastreador/sensores.cpp` incluye los canales ANT+ (FC: tipo 120, periodo 8070; potencia: tipo 11,
periodo 8182, página 0x10), pero solo se compila con `-DANT_S340` y **no está probado**. Requiere:
SoftDevice S340 + bootloader compatible en el XIAO (programador SWD recomendado) y la clave de red
ANT+ en `rastreador/ant_plus_key.h` (copiar de `ant_plus_key.h.example`; está en `.gitignore`).
Detalles en [docs/hardware.md](../docs/hardware.md).

## Limitaciones conocidas

* `authmode 0`: el módem no valida el certificado del servidor. Para producción, cargar la CA raíz
  con `AT+CCERTDOWN` y usar `authmode 1`.
* El búfer está en RAM: un corte de alimentación pierde lo no enviado.
* PWR‑K no está cableado: el módulo arranca al alimentarse. Si en algún caso no arrancara, cablear
  PWR‑K a un pin libre (D2) para encenderlo por software.

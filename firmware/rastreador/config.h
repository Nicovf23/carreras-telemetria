#pragma once
#include <Arduino.h>

/*
 * Configuración persistente del rastreador (memoria flash interna del XIAO).
 * Cada equipo se identifica ante la plataforma con su token "SERIE.SECRETO",
 * generado en el panel (Dispositivos → Registrar). El token se graba por el
 * puerto USB con el comando "token ..." y NUNCA se escribe en el código fuente.
 */
struct Config {
  String token;          // "TRK-001.xxxxxxxx" (vacío = sin configurar)
  String url;            // https://<servidor>/api/v1/telemetry
  uint32_t sampleSec;    // cada cuántos segundos se guarda una posición
  uint32_t sendSec;      // cada cuántos segundos se envía el lote
  bool uartSwapped;      // orientación TX/RX detectada del módem
  bool battery;          // hay una Li-Po en los pines BAT del XIAO (si no, no se informa batería)
};

extern Config cfg;

void configBegin();
bool configSave();
/** Serie del dispositivo (la parte del token antes del punto). */
String configSerial();
/** Procesa una línea de comando recibida por el USB. Devuelve true si la reconoce. */
bool configCommand(const String &line);
void configPrint();

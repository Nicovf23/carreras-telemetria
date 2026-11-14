#pragma once
#include <Arduino.h>

/*
 * Control del módem SIMCom A7670SA (placa "CAT1 24x24") por comandos AT.
 * Comandos según el "A76XX Series AT Command Manual V1.12" y verificados en banco
 * con el A7670SA-FASE (firmware A011B09) en la red de Altice RD.
 */

struct GnssFix {
  bool valid = false;
  double lat = 0, lon = 0;
  float altM = NAN;
  float speedKmh = NAN;
  float courseDeg = NAN;
  float hdop = NAN;
  uint8_t sats = 0;
  uint64_t utcMs = 0;  // instante de la medida según el GNSS
};

class Modem {
 public:
  /** Detecta la orientación TX/RX (probando ambas) y prepara el módem. */
  bool begin(bool &swapped, uint32_t timeoutMs = 30000);
  /** Envía un comando y espera `expect` (o ERROR). Las líneas recibidas quedan en `resp`. */
  bool cmd(const String &c, uint32_t timeoutMs = 2000, String *resp = nullptr, const char *expect = "OK");
  bool registered();
  int rssiDbm();  // INT16_MIN si se desconoce
  bool readGnss(GnssFix &fix);
  /**
   * POST HTTPS de un cuerpo JSON. Devuelve el código HTTP (200, 207, 422, 401…)
   * o un código negativo si falló la comunicación con el módem.
   */
  int httpPostJson(const String &url, const String &bearer, const String &body);
  /** Reenvía datos sin interpretar (consola de diagnóstico). */
  void passthrough(const String &line);

 private:
  bool waitFor(const char *token, uint32_t timeoutMs, String *collected);
  void openUart(bool swapped);
  bool uartOpen_ = false;
};

extern Modem modem;

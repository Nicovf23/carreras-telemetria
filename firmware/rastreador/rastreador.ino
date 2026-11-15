/*
 * Rastreador de ciclismo · Carreras Telemetría
 * Hardware: Seeed XIAO nRF52840 + módem SIMCom A7670SA (placa "CAT1 24x24").
 *
 * Cada `muestreo` segundos guarda la posición GNSS (con la hora UTC del propio GPS)
 * y, si hay sensores ANT+ activos, la FC y la potencia. Cada `envio` segundos manda
 * por HTTPS a la plataforma los datos pendientes, del más antiguo al más reciente.
 * Si no hay cobertura, los datos esperan en un búfer circular y se envían al volver
 * (la plataforma acepta datos atrasados y descarta duplicados).
 *
 * Configuración por el USB (115200), por ejemplo:
 *   token TRK-001.<secreto>
 *   url https://mi-app.onrender.com/api/v1/telemetry
 *   config        (muestra la configuración)
 *   estado        (GPS, red, búfer)
 *   AT+CSQ        (cualquier línea que empiece por AT se envía al módem)
 *
 * Cableado: ver docs/conexiones.md.
 */
#include <Adafruit_TinyUSB.h>
#include "config.h"
#include "modem.h"
#include "sensores.h"

// ---------------------------------------------------------------- Búfer
struct Sample {
  uint64_t utcMs;
  double lat, lon;
  float altM, speedKmh, courseDeg, hdop;
  uint8_t sats;
  int16_t hrBpm, powerW, cadenceRpm;
};

static const size_t BUF_CAP = 1440;   // 2 h a 1 muestra cada 5 s (~70 kB de RAM)
static const size_t BATCH_MAX = 40;   // muestras por petición (~8 kB de JSON)
static Sample buf[BUF_CAP];
static size_t bufHead = 0, bufCount = 0;  // FIFO circular
static uint32_t dropped = 0;

static void pushSample(const Sample &s) {
  if (bufCount == BUF_CAP) {  // lleno: se pierde la muestra más antigua
    bufHead = (bufHead + 1) % BUF_CAP;
    bufCount--;
    dropped++;
  }
  buf[(bufHead + bufCount) % BUF_CAP] = s;
  bufCount++;
}

// ---------------------------------------------------------------- Estado
static GnssFix lastFix;
static uint32_t lastSampleAt = 0, lastSendAt = 0, lastGnssAt = 0, lastNetAt = 0;
static uint32_t backoffMs = 0;
static bool netOk = false, modemOk = false;
static int lastRssi = INT16_MIN;
static int lastHttp = 0;
static uint32_t sentOk = 0;

static void led(bool r, bool g, bool b) {
  digitalWrite(LED_RED, r ? LOW : HIGH);
  digitalWrite(LED_GREEN, g ? LOW : HIGH);
  digitalWrite(LED_BLUE, b ? LOW : HIGH);
}

/** Batería Li-Po por el divisor interno del XIAO (P0.31 con P0.14 en BAJO). -1 si no hay batería configurada. */
static int batteryPct() {
  if (!cfg.battery) return -1;
  float v = analogRead(PIN_VBAT) * (3.6f / 4096.0f) * (1510.0f / 510.0f);
  // Aproximación lineal de la curva de descarga de una celda Li-Po
  return constrain((int)((v - 3.30f) / (4.15f - 3.30f) * 100.0f), 0, 100);
}


/** Un mensaje de telemetría v1 (ver docs/api-telemetria.md). */
static String sampleJson(const Sample &s, int battery) {
  String j = "{\"v\":1,\"device_id\":\"" + configSerial() + "\"";
  // El printf del núcleo (newlib-nano) no admite %llu: el entero de 64 bits se convierte a mano.
  char ts[24];
  char *p = ts + sizeof(ts) - 1;
  *p = '\0';
  uint64_t v = s.utcMs;
  do {
    *--p = char('0' + v % 10);
    v /= 10;
  } while (v);
  j += ",\"ts\":" + String(p);
  j += ",\"lat\":" + String(s.lat, 6) + ",\"lon\":" + String(s.lon, 6);
  if (has(s.altM)) j += ",\"alt_m\":" + String(s.altM, 1);
  if (has(s.speedKmh)) j += ",\"speed_kmh\":" + String(s.speedKmh, 1);
  if (has(s.courseDeg)) j += ",\"heading_deg\":" + String(s.courseDeg, 0);
  j += ",\"fix\":{\"valid\":true,\"sats\":" + String(s.sats);
  if (has(s.hdop)) j += ",\"hdop\":" + String(s.hdop, 1);
  j += "}";
  if (s.hrBpm > 0) j += ",\"hr_bpm\":" + String(s.hrBpm) + ",\"hr_source\":\"ant+\"";
  if (s.powerW >= 0) j += ",\"power_w\":" + String(s.powerW);
  if (s.cadenceRpm >= 0) j += ",\"cadence_rpm\":" + String(s.cadenceRpm);
  if (battery >= 0) j += ",\"battery_pct\":" + String(battery);
  if (lastRssi != INT16_MIN) j += ",\"rssi_dbm\":" + String(lastRssi) + ",\"network\":\"LTE\"";
  j += "}";
  return j;
}

static void sendBatch() {
  if (!bufCount || !cfg.token.length() || !cfg.url.length()) return;
  size_t n = min(bufCount, BATCH_MAX);
  int battery = batteryPct();
  String body = "{\"messages\":[";
  for (size_t i = 0; i < n; i++) {
    if (i) body += ",";
    body += sampleJson(buf[(bufHead + i) % BUF_CAP], battery);
  }
  body += "]}";
  led(false, false, true);
  int code = modem.httpPostJson(cfg.url, cfg.token, body);
  lastHttp = code;
  // 200/207/422: el servidor procesó el lote (aceptado, duplicado o rechazado definitivamente)
  if (code == 200 || code == 207 || code == 422) {
    bufHead = (bufHead + n) % BUF_CAP;
    bufCount -= n;
    sentOk += n;
    backoffMs = 0;
    led(false, true, false);
  } else if (code == 400) {
    // Lote mal formado: reintentarlo nunca funcionaría y bloquearía la cola. Se descarta.
    bufHead = (bufHead + n) % BUF_CAP;
    bufCount -= n;
    dropped += n;
    led(true, false, false);
  } else {
    // 401: token incorrecto · 409: dispositivo aún sin asignar a un ciclista ·
    // 429/5xx/negativo: fallo temporal. En todos se conservan los datos y se reintenta.
    backoffMs = backoffMs ? min<uint32_t>(backoffMs * 2, 120000) : 5000;
    led(true, false, false);
  }
  Serial.printf("[envio] %u muestras -> HTTP %d · pendientes %u%s\n", (unsigned)n, code, (unsigned)bufCount,
                code == 401   ? " (token no valido: revisa 'token')"
                : code == 409 ? " (dispositivo sin asignar: asignalo a un ciclista en el panel)"
                : code == 400 ? " (lote mal formado: descartado; usa 'json' para revisarlo)"
                              : "");
}

static void printStatus() {
  Serial.printf("[estado] modem %s · red %s · RSSI %d dBm · GPS %s (%u sat) · bufer %u/%u (perdidas %lu) · enviadas %lu · ultimo HTTP %d\n",
                modemOk ? "OK" : "NO", netOk ? "OK" : "NO", lastRssi == INT16_MIN ? 0 : lastRssi,
                lastFix.valid ? "fix" : "sin fix", lastFix.sats, (unsigned)bufCount, (unsigned)BUF_CAP, dropped, sentOk, lastHttp);
  SensorSnapshot s = sensoresLeer(5000);
  Serial.printf("[estado] ANT+ %s · FC %d · potencia %d W · cadencia %d rpm\n", sensoresAntActivo() ? "activo" : "desactivado",
                s.hrBpm, s.powerW, s.cadenceRpm);
}

static void handleConsole() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') {
      line += c;
      continue;
    }
    line.trim();
    if (!line.length()) continue;
    if (line.startsWith("AT") || line.startsWith("at")) modem.passthrough(line);
    else if (line == "estado") printStatus();
    else if (line == "json") Serial.println(bufCount ? sampleJson(buf[bufHead], batteryPct()) : String("(bufer vacio)"));
    else if (!configCommand(line)) Serial.println("Comandos: token <SERIE.SECRETO> · url <https://…/api/v1/telemetry> · muestreo <s> · envio <s> · bateria si|no · config · estado · borrar · AT…");
    line = "";
  }
}

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  led(true, false, false);
  // Habilita el divisor de la batería (P0.14 en BAJO). Nunca en ALTO: dañaría P0.31.
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);
  analogReadResolution(12);

  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);
  Serial.println("\n=== Rastreador Carreras Telemetria ===");

  configBegin();
  configPrint();
  if (!cfg.token.length() || !cfg.url.length()) Serial.println("AVISO: falta 'token' o 'url'. Los datos se guardan pero no se envian.");

  bool swapped = cfg.uartSwapped;
  modemOk = modem.begin(swapped);
  if (modemOk && swapped != cfg.uartSwapped) {
    cfg.uartSwapped = swapped;
    configSave();
  }
  Serial.println(modemOk ? "[modem] OK" : "[modem] NO RESPONDE: revisa cableado y alimentacion (docs/conexiones.md)");
  sensoresBegin();
}

void loop() {
  handleConsole();
  sensoresLoop();
  uint32_t now = millis();
  if (!modemOk) {
    static uint32_t retry = 0;
    if (now - retry > 15000) {
      retry = now;
      bool swapped = cfg.uartSwapped;
      modemOk = modem.begin(swapped, 8000);
    }
    return;
  }

  if (now - lastGnssAt >= 1000) {
    lastGnssAt = now;
    GnssFix f;
    if (modem.readGnss(f)) lastFix = f;
    else lastFix.valid = false;
  }

  if (now - lastNetAt >= 10000) {
    lastNetAt = now;
    netOk = modem.registered();
    lastRssi = modem.rssiDbm();
  }

  // Muestreo: solo con fix GNSS real; sin fix no se inventa ninguna posición.
  if (now - lastSampleAt >= cfg.sampleSec * 1000UL && lastFix.valid) {
    lastSampleAt = now;
    SensorSnapshot s = sensoresLeer(3000);
    Sample smp = {lastFix.utcMs, lastFix.lat, lastFix.lon, lastFix.altM, lastFix.speedKmh, lastFix.courseDeg, lastFix.hdop,
                  lastFix.sats, s.hrBpm, s.powerW, s.cadenceRpm};
    pushSample(smp);
  }

  if (netOk && now - lastSendAt >= max<uint32_t>(cfg.sendSec * 1000UL, backoffMs)) {
    lastSendAt = now;
    sendBatch();
  }

  // LED: azul parpadeando = buscando GPS
  if (!lastFix.valid) led(false, false, (now / 500) % 2);
}

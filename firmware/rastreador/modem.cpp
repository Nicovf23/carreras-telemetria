#include "modem.h"

Modem modem;

static const uint32_t MODEM_BAUD = 115200;

void Modem::openUart(bool swapped) {
  // end() sobre un puerto nunca abierto bloquea el núcleo de Seeed
  if (uartOpen_) Serial1.end();
  uartOpen_ = true;
  uint8_t rx = swapped ? PIN_SERIAL1_TX : PIN_SERIAL1_RX;
  uint8_t tx = swapped ? PIN_SERIAL1_RX : PIN_SERIAL1_TX;
  Serial1.setPins(rx, tx);
  Serial1.begin(MODEM_BAUD);
  // La salida UTX de la placa "CAT1 24x24" necesita resistencia de subida en el lado del XIAO
  nrf_gpio_cfg_input(g_ADigitalPinMap[rx], NRF_GPIO_PIN_PULLUP);
}

bool Modem::waitFor(const char *token, uint32_t timeoutMs, String *collected) {
  String line;
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (Serial1.available()) {
      char c = Serial1.read();
      if (c == '\n') {
        line.trim();
        if (line.length()) {
          if (collected) *collected += line + "\n";
          if (line.startsWith(token)) return true;
          if (line == "ERROR" || line.startsWith("+CME ERROR")) return false;
        }
        line = "";
      } else if (c != '\r') {
        line += c;
        // Indicadores sin salto de línea (p. ej. el ">" o "DOWNLOAD" de algunos comandos)
        if (line == token) {
          if (collected) *collected += line + "\n";
          return true;
        }
      }
    }
    yield();
  }
  return false;
}

bool Modem::cmd(const String &c, uint32_t timeoutMs, String *resp, const char *expect) {
  while (Serial1.available()) Serial1.read();  // descarta restos
  Serial1.print(c);
  Serial1.print("\r\n");
  return waitFor(expect, timeoutMs, resp);
}

bool Modem::begin(bool &swapped, uint32_t timeoutMs) {
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    openUart(swapped);
    for (int i = 0; i < 3; i++) {
      if (cmd("AT", 700)) {
        cmd("ATE0");
        cmd("AT+CMEE=1");
        // GNSS: GPS+GLONASS+Galileo (modo por defecto del A7670SA) y encendido
        String r;
        if (cmd("AT+CGNSSPWR?", 2000, &r) && r.indexOf("+CGNSSPWR: 1") < 0) {
          cmd("AT+CGNSSPWR=1", 3000);
          waitFor("+CGNSSPWR: READY!", 15000, nullptr);
        }
        // TLS con SNI: sin SNI el saludo TLS falla (error 715) en servidores tipo Render
        cmd("AT+CSSLCFG=\"sslversion\",0,4");
        cmd("AT+CSSLCFG=\"authmode\",0,0");  // TODO producción: cargar CA y usar authmode 1
        cmd("AT+CSSLCFG=\"enableSNI\",0,1");
        return true;
      }
    }
    swapped = !swapped;  // prueba la otra orientación TX/RX
  }
  return false;
}

bool Modem::registered() {
  String r;
  if (!cmd("AT+CEREG?", 2000, &r)) return false;
  // +CEREG: <n>,<stat>  → 1 = red propia, 5 = itinerancia
  int i = r.indexOf("+CEREG:");
  if (i < 0) return false;
  int comma = r.indexOf(',', i);
  int stat = r.substring(comma + 1).toInt();
  return stat == 1 || stat == 5;
}

int Modem::rssiDbm() {
  String r;
  if (!cmd("AT+CSQ", 2000, &r)) return INT16_MIN;
  int i = r.indexOf("+CSQ:");
  if (i < 0) return INT16_MIN;
  int csq = r.substring(i + 5).toInt();
  if (csq == 99 || csq < 0) return INT16_MIN;
  return -113 + 2 * csq;  // 3GPP TS 27.007
}

/** Días desde 1970-01-01 para una fecha civil (algoritmo de H. Hinnant). */
static int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t)doe - 719468;
}

/** Coordenada en grados decimales; admite también el formato NMEA ddmm.mmmm. */
static double parseCoord(const String &v, bool isLat) {
  double x = strtod(v.c_str(), nullptr);
  if (fabs(x) > (isLat ? 90.0 : 180.0)) {
    int deg = (int)(x / 100);
    x = deg + (x - deg * 100) / 60.0;
  }
  return x;
}

bool Modem::readGnss(GnssFix &fix) {
  String r;
  fix.valid = false;
  if (!cmd("AT+CGNSSINFO", 2000, &r)) return false;
  int i = r.indexOf("+CGNSSINFO:");
  if (i < 0) return false;
  String data = r.substring(i + 11, r.indexOf('\n', i));
  data.trim();

  // Separa por comas (los campos vacíos se conservan)
  String tok[24];
  int n = 0, start = 0;
  for (int k = 0; k <= (int)data.length() && n < 24; k++) {
    if (k == (int)data.length() || data[k] == ',') {
      tok[n++] = data.substring(start, k);
      start = k + 1;
    }
  }
  // El número de campos de satélites varía según la versión: se localiza el indicador N/S.
  int ns = -1;
  for (int k = 1; k < n; k++) {
    if (tok[k] == "N" || tok[k] == "S") {
      ns = k;
      break;
    }
  }
  if (ns < 2 || ns + 6 >= n || tok[0].toInt() < 2) return false;  // sin fix 2D/3D

  fix.lat = parseCoord(tok[ns - 1], true) * (tok[ns] == "S" ? -1 : 1);
  fix.lon = parseCoord(tok[ns + 1], false) * (tok[ns + 2] == "W" ? -1 : 1);
  const String &date = tok[ns + 3];  // ddmmyy
  const String &time = tok[ns + 4];  // hhmmss.ss
  if (date.length() < 6 || time.length() < 6) return false;
  int dd = date.substring(0, 2).toInt(), mo = date.substring(2, 4).toInt(), yy = date.substring(4, 6).toInt();
  int hh = time.substring(0, 2).toInt(), mi = time.substring(2, 4).toInt();
  double ss = strtod(time.substring(4).c_str(), nullptr);
  int64_t days = daysFromCivil(2000 + yy, mo, dd);
  fix.utcMs = (uint64_t)((days * 86400 + hh * 3600 + mi * 60) * 1000) + (uint64_t)(ss * 1000);

  fix.altM = tok[ns + 5].length() ? tok[ns + 5].toFloat() : NAN;
  fix.speedKmh = tok[ns + 6].length() ? tok[ns + 6].toFloat() * 1.852f : NAN;  // nudos → km/h
  fix.courseDeg = (ns + 7 < n && tok[ns + 7].length()) ? tok[ns + 7].toFloat() : NAN;
  fix.hdop = (ns + 9 < n && tok[ns + 9].length()) ? tok[ns + 9].toFloat() : NAN;
  uint8_t sats = 0;
  for (int k = 1; k < ns - 1; k++) sats += tok[k].toInt();
  fix.sats = sats;
  fix.valid = true;
  return true;
}

int Modem::httpPostJson(const String &url, const String &bearer, const String &body) {
  cmd("AT+HTTPTERM", 1000);  // por si quedó una sesión abierta
  if (!cmd("AT+HTTPINIT", 5000)) return -1;
  int code = -2;
  String r;
  if (cmd("AT+HTTPPARA=\"URL\",\"" + url + "\"") && cmd("AT+HTTPPARA=\"CONTENT\",\"application/json\"") &&
      cmd("AT+HTTPPARA=\"USERDATA\",\"Authorization: Bearer " + bearer + "\"") &&
      (!url.startsWith("https://") || cmd("AT+HTTPPARA=\"SSLCFG\",0")) &&
      cmd("AT+HTTPDATA=" + String(body.length()) + ",10000", 5000, nullptr, "DOWNLOAD")) {
    Serial1.print(body);
    if (waitFor("OK", 10000, nullptr) && cmd("AT+HTTPACTION=1", 5000)) {
      // +HTTPACTION: <method>,<status|errcode>,<datalen>
      if (waitFor("+HTTPACTION:", 90000, &r)) {
        int i = r.indexOf("+HTTPACTION:");
        int c1 = r.indexOf(',', i);
        code = r.substring(c1 + 1).toInt();
      } else {
        code = -3;
      }
    }
  }
  cmd("AT+HTTPTERM", 2000);
  return code;
}

void Modem::passthrough(const String &line) {
  Serial1.print(line);
  Serial1.print("\r\n");
  String r;
  waitFor("OK", 3000, &r);
  Serial.print(r);
}

#include "config.h"
#include <Adafruit_LittleFS.h>
#include <InternalFileSystem.h>

using namespace Adafruit_LittleFS_Namespace;

static const char *CFG_FILE = "/rastreador.cfg";
Config cfg;

static void defaults() {
  cfg.token = "";
  cfg.url = "";
  cfg.sampleSec = 5;
  cfg.sendSec = 5;
  cfg.uartSwapped = false;
  cfg.battery = false;
}

static void applyKey(const String &k, const String &v) {
  if (k == "token") cfg.token = v;
  else if (k == "url") cfg.url = v;
  else if (k == "sample") cfg.sampleSec = constrain(v.toInt(), 1, 60);
  else if (k == "send") cfg.sendSec = constrain(v.toInt(), 2, 300);
  else if (k == "swap") cfg.uartSwapped = v == "1";
  else if (k == "battery") cfg.battery = v == "1";
}

void configBegin() {
  defaults();
  InternalFS.begin();
  File f(InternalFS);
  if (!f.open(CFG_FILE, FILE_O_READ)) return;
  String line;
  while (f.available()) {
    char c = f.read();
    if (c == '\n') {
      int eq = line.indexOf('=');
      if (eq > 0) applyKey(line.substring(0, eq), line.substring(eq + 1));
      line = "";
    } else if (c != '\r') {
      line += c;
    }
  }
  f.close();
}

bool configSave() {
  InternalFS.remove(CFG_FILE);
  File f(InternalFS);
  if (!f.open(CFG_FILE, FILE_O_WRITE)) return false;
  f.print("token=" + cfg.token + "\n");
  f.print("url=" + cfg.url + "\n");
  f.print("sample=" + String(cfg.sampleSec) + "\n");
  f.print("send=" + String(cfg.sendSec) + "\n");
  f.print(String("swap=") + (cfg.uartSwapped ? "1" : "0") + "\n");
  f.close();
  return true;
}

String configSerial() {
  int dot = cfg.token.indexOf('.');
  return dot > 0 ? cfg.token.substring(0, dot) : String("");
}

void configPrint() {
  Serial.println("--- Configuracion ---");
  Serial.println("Serie:     " + (configSerial().length() ? configSerial() : String("(sin token)")));
  // El secreto nunca se muestra completo
  String hint = cfg.token.length() > 4 ? "..." + cfg.token.substring(cfg.token.length() - 4) : String("(vacio)");
  Serial.println("Token:     " + hint);
  Serial.println("URL:       " + (cfg.url.length() ? cfg.url : String("(sin URL)")));
  Serial.println("Muestreo:  cada " + String(cfg.sampleSec) + " s · envio cada " + String(cfg.sendSec) + " s");
  Serial.println(String("Bateria:   ") + (cfg.battery ? "Li-Po conectada" : "no se informa (sin Li-Po)"));
  Serial.println(String("UART:      ") + (cfg.uartSwapped ? "RX en D6 / TX en D7" : "RX en D7 / TX en D6"));
}

bool configCommand(const String &raw) {
  String line = raw;
  line.trim();
  int sp = line.indexOf(' ');
  String cmd = sp > 0 ? line.substring(0, sp) : line;
  String arg = sp > 0 ? line.substring(sp + 1) : String("");
  arg.trim();
  cmd.toLowerCase();

  if (cmd == "token") {
    // Formato del token generado por la plataforma: SERIE.SECRETO
    int dot = arg.indexOf('.');
    if (dot < 3 || arg.length() - dot < 17) {
      Serial.println("Token no valido. Formato: SERIE.SECRETO (lo da el panel al registrar el dispositivo)");
      return true;
    }
    cfg.token = arg;
  } else if (cmd == "url") {
    if (!arg.startsWith("https://") && !arg.startsWith("http://")) {
      Serial.println("URL no valida. Ejemplo: https://mi-app.onrender.com/api/v1/telemetry");
      return true;
    }
    cfg.url = arg;
  } else if (cmd == "muestreo") {
    cfg.sampleSec = constrain(arg.toInt(), 1, 60);
  } else if (cmd == "envio") {
    cfg.sendSec = constrain(arg.toInt(), 2, 300);
  } else if (cmd == "bateria") {
    cfg.battery = arg == "si" || arg == "1";
  } else if (cmd == "borrar") {
    defaults();
  } else if (cmd == "config") {
    configPrint();
    return true;
  } else {
    return false;
  }
  Serial.println(configSave() ? "Guardado." : "ERROR al guardar en flash");
  configPrint();
  return true;
}

/*
 * Prueba de banco del Seeed XIAO nRF52840 (núcleo "Seeed nRF52 Boards").
 *
 *  - Parpadea el LED RGB (rojo = arrancando, azul = escaneando, verde = latido).
 *  - Escribe por el puerto serie USB (115200 baudios) un latido cada 5 s.
 *  - Escanea dispositivos Bluetooth LE cercanos y avisa si alguno anuncia el
 *    servicio de frecuencia cardíaca (0x180D). Un sensor "solo ANT+" NO aparecerá
 *    aquí: ANT+ es otro protocolo y necesita la pila ANT de Garmin (ver docs/hardware.md).
 *
 * No envía nada a la plataforma: solo comprueba que la placa se programa y funciona.
 */
#include <bluefruit.h>

static uint32_t lastBeat = 0;
static uint32_t seen = 0;

static void led(bool r, bool g, bool b) {
  // Los LED del XIAO se encienden con nivel bajo
  digitalWrite(LED_RED, r ? LOW : HIGH);
  digitalWrite(LED_GREEN, g ? LOW : HIGH);
  digitalWrite(LED_BLUE, b ? LOW : HIGH);
}

static void onScan(ble_gap_evt_adv_report_t *report) {
  seen++;
  uint8_t name[32] = {0};
  Bluefruit.Scanner.parseReportByType(report, BLE_GAP_AD_TYPE_COMPLETE_LOCAL_NAME, name, sizeof(name) - 1);
  bool hr = Bluefruit.Scanner.checkReportForUuid(report, UUID16_SVC_HEART_RATE);
  Serial.printf("BLE %02X:%02X:%02X:%02X:%02X:%02X  RSSI %4d dBm  %s%s\n",
                report->peer_addr.addr[5], report->peer_addr.addr[4], report->peer_addr.addr[3],
                report->peer_addr.addr[2], report->peer_addr.addr[1], report->peer_addr.addr[0],
                report->rssi, name[0] ? (char *)name : "(sin nombre)", hr ? "  <-- SENSOR FC (Bluetooth)" : "");
  Bluefruit.Scanner.resume();
}

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  led(true, false, false);

  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);

  Serial.println();
  Serial.println("=== Carreras Telemetria · prueba XIAO nRF52840 ===");

  Bluefruit.begin(0, 1);  // 0 periféricos, 1 central (solo escaneo)
  Bluefruit.setName("XIAO-PRUEBA");
  Bluefruit.Scanner.setRxCallback(onScan);
  Bluefruit.Scanner.restartOnDisconnect(true);
  Bluefruit.Scanner.filterRssi(-90);
  Bluefruit.Scanner.setInterval(160, 80);  // unidades de 0,625 ms
  Bluefruit.Scanner.useActiveScan(true);   // pide el nombre del dispositivo
  Bluefruit.Scanner.start(0);
  Serial.println("Escaneando Bluetooth LE (los sensores solo ANT+ no apareceran)...");
  led(false, false, true);
}

void loop() {
  if (millis() - lastBeat >= 5000) {
    lastBeat = millis();
    Serial.printf("[latido] t=%lu s · anuncios BLE recibidos: %lu\n", millis() / 1000, seen);
    led(false, true, false);
    delay(80);
    led(false, false, true);
  }
}

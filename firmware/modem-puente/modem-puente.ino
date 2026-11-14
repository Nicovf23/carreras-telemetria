/*
 * Puente USB <-> módem A7670 para el XIAO nRF52840.
 *
 * Cableado: D6 (TX) -> URX del módem, D7 (RX) <- UTX del módem, GND común.
 * Todo lo que llega por el USB del XIAO se reenvía al módem y viceversa, para
 * probar el módem con comandos AT desde la PC (monitor serie a 115200).
 *
 * En la placa "CAT1 24x24" la salida UTX mide ~1,3 V en reposo sin carga: parece
 * un convertidor de nivel que espera la resistencia de subida en el lado del
 * microcontrolador. Por eso se activa el pull-up interno del XIAO en D7.
 *
 * LED verde = el módem respondió; LED rojo = aún no hay respuesta.
 * Al arrancar envía "AT" cada 2 s hasta que el módem conteste.
 * Escribe "?" sola en una línea para ver el diagnóstico de la línea RX.
 */
#include <Adafruit_TinyUSB.h>  // puerto serie USB en el núcleo "Seeed nRF52 Boards"

static const uint32_t MODEM_BAUD = 115200;
static bool modemSeen = false;
static uint32_t lastProbe = 0;
static uint32_t rxBytes = 0;
static char lineBuf[8];
static uint8_t lineLen = 0;

// Algunas placas rotulan UTX/URX desde el punto de vista del microcontrolador. Si el
// módem no contesta, se prueba alternativamente con TX y RX intercambiados.
static bool swapped = false;
static uint32_t lastSwap = 0;
static uint8_t rxPin() { return swapped ? PIN_SERIAL1_TX : PIN_SERIAL1_RX; }
static uint8_t txPin() { return swapped ? PIN_SERIAL1_RX : PIN_SERIAL1_TX; }

static void rxPullup() {
  nrf_gpio_cfg_input(g_ADigitalPinMap[rxPin()], NRF_GPIO_PIN_PULLUP);
}

static bool uartOpen = false;

static void openModemUart() {
  // end() sobre un puerto nunca abierto bloquea el núcleo de Seeed
  if (uartOpen) Serial1.end();
  uartOpen = true;
  Serial1.setPins(rxPin(), txPin());
  Serial1.begin(MODEM_BAUD);
  rxPullup();
  Serial.printf("[puente] UART del modem: RX en D%d, TX en D%d%s\n", rxPin(), txPin(), swapped ? " (intercambiados)" : "");
}

static void diag() {
  uint32_t pin = g_ADigitalPinMap[rxPin()];
  uint32_t high = 0;
  for (int i = 0; i < 200; i++) {
    high += nrf_gpio_pin_read(pin);
    delayMicroseconds(50);
  }
  Serial.printf("[diag] linea RX (D%d): %lu/200 lecturas en ALTO · bytes recibidos del modem: %lu\n", rxPin(), high, rxBytes);
  Serial.println(high > 190 ? "[diag] RX en reposo ALTO: nivel compatible" : "[diag] RX no esta en ALTO: posible nivel 1,8 V o cable suelto");
}

void setup() {
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_BLUE, OUTPUT);
  digitalWrite(LED_RED, LOW);  // los LED del XIAO se encienden con nivel bajo
  digitalWrite(LED_GREEN, HIGH);
  digitalWrite(LED_BLUE, HIGH);

  Serial.begin(115200);
  uint32_t t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);
  Serial.println("=== Puente XIAO <-> A7670 (115200) ===");
  Serial.println("Escribe comandos AT y pulsa Enter. '?' = diagnostico.");
  openModemUart();  // por defecto D6 = TX, D7 = RX
  lastSwap = millis();
  diag();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    // "?" sola en una línea muestra el diagnóstico en lugar de enviarse al módem
    if (c == '\r' || c == '\n') {
      if (lineLen == 1 && lineBuf[0] == '?') diag();
      else if (lineLen) {
        Serial1.write((const uint8_t *)lineBuf, lineLen);
      }
      if (lineLen != 1 || lineBuf[0] != '?') Serial1.write(c);
      lineLen = 0;
      continue;
    }
    if (lineLen < sizeof(lineBuf)) {
      lineBuf[lineLen++] = c;
    } else {
      // Línea larga: se envía tal cual (no es "?")
      Serial1.write((const uint8_t *)lineBuf, lineLen);
      Serial1.write(c);
      lineLen = 0;
      memset(lineBuf, 0, sizeof(lineBuf));
      // A partir de aquí se reenvía directamente hasta fin de línea
      while (Serial.available()) {
        char d = Serial.read();
        Serial1.write(d);
        if (d == '\n') break;
      }
    }
  }
  while (Serial1.available()) {
    int c = Serial1.read();
    rxBytes++;
    Serial.write(c);
    if (!modemSeen) {
      modemSeen = true;
      digitalWrite(LED_RED, HIGH);
      digitalWrite(LED_GREEN, LOW);
    }
  }
  if (!modemSeen && millis() - lastProbe > 2000) {
    lastProbe = millis();
    Serial1.print("AT\r\n");
  }
  if (!modemSeen && millis() - lastSwap > 7000) {
    lastSwap = millis();
    swapped = !swapped;
    openModemUart();
  }
}

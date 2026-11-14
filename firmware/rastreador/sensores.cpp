#include "sensores.h"

#if !defined(ANT_S340)

// ------------------------------------------------------------------ Sin ANT
void sensoresBegin() {
  Serial.println("[sensores] ANT+ desactivado: el XIAO tiene la SoftDevice S140 (solo Bluetooth).");
}
void sensoresLoop() {}
SensorSnapshot sensoresLeer(uint32_t) { return SensorSnapshot(); }
bool sensoresAntActivo() { return false; }

#else

/*
 * ------------------------------------------------------------- Con ANT (S340)
 * NO VERIFICADO EN BANCO: requiere S340 + bootloader compatible + clave de red ANT+.
 *
 * Canal 0: monitor de frecuencia cardíaca (tipo de dispositivo 120, periodo 8070).
 * Canal 1: potenciómetro (tipo 11, periodo 8182). Ambos en 2457 MHz (RF 57), red ANT+,
 * esclavo con número de dispositivo comodín (se empareja con el primero que encuentra).
 *
 * La clave de red ANT+ se obtiene al registrarse como ANT+ Adopter (thisisant.com) y se
 * define en ant_plus_key.h (ignorado por git; ver ant_plus_key.h.example).
 */
#include <bluefruit.h>
#include "ant_interface.h"
#include "ant_parameters.h"
#include "ant_plus_key.h"  // define ANT_PLUS_NETWORK_KEY {…8 bytes…}

static const uint8_t NET = 0;
static const uint8_t CH_HR = 0, CH_PWR = 1;
static const uint8_t RF_ANTPLUS = 57;

static volatile uint32_t hrAt = 0, pwrAt = 0;
static volatile int16_t hr = -1, pwr = -1, cad = -1;
static bool antOk = false;

static bool openSlave(uint8_t ch, uint8_t devType, uint16_t period) {
  return sd_ant_channel_assign(ch, CHANNEL_TYPE_SLAVE, NET, 0) == NRF_SUCCESS &&
         sd_ant_channel_id_set(ch, 0 /* comodín */, devType, 0) == NRF_SUCCESS &&
         sd_ant_channel_radio_freq_set(ch, RF_ANTPLUS) == NRF_SUCCESS &&
         sd_ant_channel_period_set(ch, period) == NRF_SUCCESS &&
         sd_ant_channel_rx_search_timeout_set(ch, 0xFF) == NRF_SUCCESS &&  // búsqueda indefinida
         sd_ant_channel_open(ch) == NRF_SUCCESS;
}

void sensoresBegin() {
  static uint8_t key[8] = ANT_PLUS_NETWORK_KEY;
  ANT_ENABLE cfgAnt = {};
  cfgAnt.ucTotalNumberOfChannels = 2;
  cfgAnt.ucNumberOfEncryptedChannels = 0;
  cfgAnt.usNumberOfEvents = 32;
  static uint8_t antBuf[ANT_ENABLE_GET_REQUIRED_SPACE(2, 0, MESG_BUFFER_SIZE, 32)] __attribute__((aligned(4)));
  cfgAnt.pucMemoryBlockStartLocation = antBuf;
  cfgAnt.usMemoryBlockByteSize = sizeof(antBuf);
  antOk = sd_ant_enable(&cfgAnt) == NRF_SUCCESS && sd_ant_network_address_set(NET, key) == NRF_SUCCESS &&
          openSlave(CH_HR, 120, 8070) && openSlave(CH_PWR, 11, 8182);
  Serial.println(antOk ? "[sensores] ANT+ activo: buscando banda de FC y potenciometro" : "[sensores] ERROR al iniciar ANT+");
}

static void onPayload(uint8_t ch, const uint8_t *p) {
  uint8_t page = p[0] & 0x7F;
  if (ch == CH_HR) {
    if (p[7] > 0) {  // 0 = sin contacto con la piel
      hr = p[7];
      hrAt = millis();
    }
  } else if (ch == CH_PWR && page == 0x10) {  // página estándar de potencia
    pwr = (int16_t)(p[6] | (p[7] << 8));
    cad = p[3] == 0xFF ? -1 : p[3];
    pwrAt = millis();
  }
}

void sensoresLoop() {
  if (!antOk) return;
  uint8_t ch, ev;
  ANT_MESSAGE msg;
  while (sd_ant_event_get(&ch, &ev, msg.aucMessage) == NRF_SUCCESS) {
    if (ev == EVENT_RX) {
      uint8_t id = msg.ANT_MESSAGE_ucMesgID;
      if (id == MESG_BROADCAST_DATA_ID || id == MESG_ACKNOWLEDGED_DATA_ID) onPayload(ch, msg.ANT_MESSAGE_aucPayload);
    } else if (ev == EVENT_CHANNEL_CLOSED) {
      sd_ant_channel_open(ch);  // reabre si el sensor se pierde
    }
  }
}

SensorSnapshot sensoresLeer(uint32_t maxAgeMs) {
  SensorSnapshot s;
  uint32_t now = millis();
  if (hr > 0 && now - hrAt < maxAgeMs) s.hrBpm = hr;
  if (pwr >= 0 && now - pwrAt < maxAgeMs) {
    s.powerW = pwr;
    s.cadenceRpm = cad;
  }
  return s;
}

bool sensoresAntActivo() { return antOk; }

#endif

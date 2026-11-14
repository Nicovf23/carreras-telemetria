#pragma once
#include <Arduino.h>

/*
 * Sensores deportivos ANT+ (frecuencia cardíaca y potencia).
 *
 * Requiere la SoftDevice S340 (ANT + BLE) en el XIAO y compilar con -DANT_S340
 * (ver docs/hardware.md). Sin ella, este módulo queda desactivado y el rastreador
 * envía solo posición, batería y señal: NUNCA se inventan valores de sensores.
 */
struct SensorSnapshot {
  int16_t hrBpm = -1;       // -1 = sin dato reciente
  int16_t powerW = -1;
  int16_t cadenceRpm = -1;
};

void sensoresBegin();
void sensoresLoop();
/** Últimos valores con antigüedad menor que maxAgeMs. */
SensorSnapshot sensoresLeer(uint32_t maxAgeMs);
bool sensoresAntActivo();

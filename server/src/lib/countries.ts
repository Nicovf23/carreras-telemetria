/** Códigos ISO 3166-1 alfa-2 oficialmente asignados (más XK, Kosovo, de uso común en deporte). */
const ALPHA2 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO ' +
  'JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR ' +
  'MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO ' +
  'RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV ' +
  'TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK';

export const COUNTRY_CODES = new Set(ALPHA2.split(' '));

/** Códigos COI/ISO alfa-3 frecuentes en listas de inscritos → alfa-2. */
const ALPHA3: Record<string, string> = {
  ESP: 'ES', FRA: 'FR', ITA: 'IT', GER: 'DE', DEU: 'DE', POR: 'PT', PRT: 'PT', BEL: 'BE', NED: 'NL', NLD: 'NL',
  GBR: 'GB', USA: 'US', COL: 'CO', DOM: 'DO', VEN: 'VE', MEX: 'MX', ECU: 'EC', ARG: 'AR', CHI: 'CL', CHL: 'CL',
  PER: 'PE', CRC: 'CR', CRI: 'CR', PUR: 'PR', PRI: 'PR', CUB: 'CU', GUA: 'GT', GTM: 'GT', PAN: 'PA', URU: 'UY',
  URY: 'UY', BRA: 'BR', CAN: 'CA', SUI: 'CH', CHE: 'CH', AUT: 'AT', DEN: 'DK', DNK: 'DK', NOR: 'NO', SWE: 'SE',
  SLO: 'SI', SVN: 'SI', AUS: 'AU', NZL: 'NZ', JPN: 'JP', KAZ: 'KZ', ERI: 'ER', RSA: 'ZA', ZAF: 'ZA', IRL: 'IE',
  POL: 'PL', CZE: 'CZ', SVK: 'SK', HUN: 'HU', LUX: 'LU', HAI: 'HT', HTI: 'HT', BOL: 'BO', PAR: 'PY', PRY: 'PY',
  HON: 'HN', HND: 'HN', ESA: 'SV', SLV: 'SV', NCA: 'NI', NIC: 'NI',
};

/** Normaliza un código de país a ISO alfa-2 en mayúsculas, o null si no es válido. */
export function normalizeCountry(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  if (s.length === 2) return COUNTRY_CODES.has(s) ? s : null;
  if (s.length === 3) return ALPHA3[s] ?? null;
  return null;
}

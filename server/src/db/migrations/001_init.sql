-- Esquema inicial de la plataforma de cronometraje.
-- Compatible con PostgreSQL 14+ y PGlite.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'organizer')),
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Carrera. `mode` separa los datos DEMO (simulados) de los oficiales: nunca se mezclan.
-- `discipline` y race_segments preparan el modelo para triatlón.
CREATE TABLE races (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 text NOT NULL UNIQUE,
  name                 text NOT NULL,
  description          text NOT NULL DEFAULT '',
  location             text NOT NULL DEFAULT '',
  discipline           text NOT NULL DEFAULT 'cycling_road'
                         CHECK (discipline IN ('cycling_road', 'cycling_circuit', 'cycling_tt', 'triathlon')),
  mode                 text NOT NULL DEFAULT 'official' CHECK (mode IN ('official', 'demo')),
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'scheduled', 'live', 'finished', 'cancelled')),
  scheduled_start      timestamptz,
  started_at           timestamptz,
  finished_at          timestamptz,
  timezone             text NOT NULL DEFAULT 'America/Santo_Domingo',
  laps                 integer NOT NULL DEFAULT 1 CHECK (laps BETWEEN 1 AND 200),
  -- Polilínea de una vuelta: [[lat, lon], ...]
  route                jsonb,
  route_length_m       double precision,
  allow_estimated_gaps boolean NOT NULL DEFAULT true,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE race_categories (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id  uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  code     text NOT NULL,
  name     text NOT NULL,
  UNIQUE (race_id, code)
);

-- Segmentos de la carrera (triatlón: swim, t1, bike, t2, run). Ciclismo = un único 'bike'.
CREATE TABLE race_segments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id    uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  discipline text NOT NULL CHECK (discipline IN ('swim', 't1', 'bike', 't2', 'run')),
  name       text NOT NULL,
  UNIQUE (race_id, seq)
);

CREATE TABLE checkpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id     uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  segment_id  uuid REFERENCES race_segments(id) ON DELETE SET NULL,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('start', 'split', 'finish')),
  -- Distancia desde la salida dentro de una vuelta
  distance_m  double precision NOT NULL CHECK (distance_m >= 0),
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkpoints_race_idx ON checkpoints (race_id, distance_m);

CREATE TABLE participants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id           uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  bib               integer NOT NULL CHECK (bib > 0),
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  team              text NOT NULL DEFAULT '',
  -- ISO 3166-1 alfa-2 en mayúsculas
  country_code      char(2) NOT NULL,
  category_code     text,
  status            text NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered', 'dns', 'racing', 'finished', 'dnf', 'dsq')),
  -- Salida individual (contrarreloj, oleadas). Null = salida general de la carrera.
  start_time        timestamptz,
  finished_at       timestamptz,
  has_hr_sensor     boolean NOT NULL DEFAULT false,
  -- Consentimiento para mostrar la frecuencia cardíaca en la web pública (dato de salud).
  public_hr         boolean NOT NULL DEFAULT false,
  -- Datos privados: solo visibles en el panel del organizador
  email             text,
  phone             text,
  emergency_contact text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id, bib)
);

CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificador legible que el dispositivo envía (p. ej. TRK-001)
  serial         text NOT NULL UNIQUE,
  label          text NOT NULL DEFAULT '',
  hardware       text NOT NULL DEFAULT '',
  firmware       text,
  -- Hash SHA-256 de la clave secreta (la clave en claro solo se muestra al crearla)
  key_hash       text NOT NULL,
  key_hint       text NOT NULL,
  -- Dispositivos virtuales del simulador: solo pueden asignarse a carreras DEMO
  is_simulated   boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  last_battery   double precision,
  last_rssi      integer,
  last_network   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE device_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  race_id        uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  unassigned_at  timestamptz
);
CREATE UNIQUE INDEX device_assignments_active_device ON device_assignments (device_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX device_assignments_active_participant ON device_assignments (participant_id) WHERE unassigned_at IS NULL;

-- Posiciones GPS. (device_id, recorded_at) es único: los reenvíos se descartan como duplicados.
CREATE TABLE positions (
  id             bigserial PRIMARY KEY,
  race_id        uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  device_id      uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  seq            bigint,
  recorded_at    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  lat            double precision NOT NULL,
  lon            double precision NOT NULL,
  alt_m          double precision,
  speed_kmh      double precision,
  heading_deg    double precision,
  hdop           double precision,
  satellites     integer,
  battery_pct    double precision,
  rssi_dbm       integer,
  network        text,
  is_simulated   boolean NOT NULL DEFAULT false,
  -- Marcas de calidad: late, out_of_order, off_route, implausible_jump...
  flags          text[] NOT NULL DEFAULT '{}',
  UNIQUE (device_id, recorded_at)
);
CREATE INDEX positions_participant_time ON positions (participant_id, recorded_at);
CREATE INDEX positions_race_time ON positions (race_id, recorded_at);

CREATE TABLE heart_rate_samples (
  id             bigserial PRIMARY KEY,
  race_id        uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  device_id      uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recorded_at    timestamptz NOT NULL,
  bpm            integer NOT NULL CHECK (bpm BETWEEN 25 AND 250),
  source         text NOT NULL DEFAULT 'unknown' CHECK (source IN ('ant+', 'ble', 'unknown')),
  is_simulated   boolean NOT NULL DEFAULT false,
  UNIQUE (device_id, recorded_at)
);
CREATE INDEX hr_participant_time ON heart_rate_samples (participant_id, recorded_at);

-- Pasos por punto de control. Varias fuentes por punto/vuelta; prioridad manual > mat > gps.
CREATE TABLE checkpoint_passings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id        uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  checkpoint_id  uuid NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  lap            integer NOT NULL DEFAULT 1,
  passed_at      timestamptz NOT NULL,
  source         text NOT NULL CHECK (source IN ('gps', 'manual', 'mat')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, checkpoint_id, lap, source)
);

-- Resultados oficiales publicados al cerrar la carrera (instantánea inmutable).
CREATE TABLE results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id        uuid NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  position       integer,
  status         text NOT NULL,
  total_time_ms  bigint,
  gap_ms         bigint,
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (race_id, participant_id)
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log (at DESC);

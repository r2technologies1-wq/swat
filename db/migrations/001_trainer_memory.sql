CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT 'Ryan',
  timezone text NOT NULL DEFAULT 'America/New_York',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_chat_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_date date,
  user_message text NOT NULL,
  assistant_reply text NOT NULL DEFAULT '',
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  db_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  action_index integer NOT NULL DEFAULT 0,
  action_type text NOT NULL,
  action jsonb NOT NULL,
  action_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  occurred_on date,
  occurred_at timestamptz,
  body_area text,
  severity numeric,
  active boolean,
  context text,
  text text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'coach',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  memory_key text,
  text text NOT NULL,
  confidence numeric,
  active boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trainer_memories_key_idx
  ON trainer_memories (athlete_id, memory_key)
  WHERE memory_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS body_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value_num numeric,
  value_text text,
  unit text,
  measured_on date,
  measured_at timestamptz,
  source text NOT NULL DEFAULT 'coach',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recovery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  log_date date,
  sleep_hours numeric,
  sleep_score numeric,
  readiness numeric,
  hrv numeric,
  resting_hr numeric,
  feel text,
  soreness jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  source text NOT NULL DEFAULT 'coach',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nutrition_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  log_date date,
  text text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'coach',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hydration_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  log_date date,
  ounces numeric NOT NULL,
  source text NOT NULL DEFAULT 'coach',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  workout_date date,
  session_key text,
  status text NOT NULL,
  duration_minutes numeric,
  feel text,
  session_rpe numeric,
  completion_fraction numeric,
  exercises_completed jsonb NOT NULL DEFAULT '[]'::jsonb,
  exercises_skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_exercise_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  workout_date date,
  exercise_name text NOT NULL,
  weight numeric,
  reps numeric,
  rir numeric,
  note text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exercise_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  feedback_date date,
  exercise_key text,
  exercise_name text NOT NULL,
  difficulty text NOT NULL,
  actual_weight numeric,
  observed_rir numeric,
  next_weight numeric,
  note text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS day_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES trainer_chat_turns(id) ON DELETE SET NULL,
  override_date date NOT NULL,
  override_type text NOT NULL,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trainer_profile_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES trainer_athletes(id) ON DELETE CASCADE,
  summary text NOT NULL,
  source_start_at timestamptz,
  source_end_at timestamptz,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_chat_turns_athlete_created_idx ON trainer_chat_turns (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_action_log_athlete_created_idx ON trainer_action_log (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_events_athlete_created_idx ON trainer_events (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_events_athlete_occurred_idx ON trainer_events (athlete_id, occurred_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS body_metrics_athlete_kind_idx ON body_metrics (athlete_id, kind, measured_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS recovery_logs_athlete_date_idx ON recovery_logs (athlete_id, log_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS exercise_feedback_athlete_exercise_idx ON exercise_feedback (athlete_id, exercise_name, feedback_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS day_overrides_athlete_date_idx ON day_overrides (athlete_id, override_date DESC, created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('001_trainer_memory')
ON CONFLICT (version) DO NOTHING;

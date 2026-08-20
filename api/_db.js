import pg from "pg";

const { Pool } = pg;

let pool;

function databaseUrl() {
  return process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
}

export function databaseConfigured() {
  return Boolean(databaseUrl());
}

function getPool() {
  if (!databaseConfigured()) return null;
  if (!pool) {
    const connectionString = databaseUrl();
    const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString || "");
    pool = new Pool({
      connectionString,
      max: Number(process.env.PGPOOL_MAX || 4),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function checkDatabaseConnection() {
  const db = getPool();
  if (!db) return { configured: false, reachable: false };
  try {
    await db.query("SELECT 1");
    return { configured: true, reachable: true };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: error instanceof Error ? error.message : "database unavailable",
    };
  }
}

function asDate(value, fallback) {
  const raw = String(value || fallback || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function asText(value, max = 500) {
  return value == null ? "" : String(value).slice(0, max);
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function payload(value) {
  return JSON.stringify(value == null ? {} : value);
}

function listPayload(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function actionDate(action, fallbackDate) {
  return asDate(action.date || action.from_date || action.to_date || action.occurred_at, fallbackDate);
}

function actionText(action) {
  return asText(action.text || action.note || action.notes || action.reason || action.context || "", 800);
}

function valueOfJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }
  return value;
}

function tsMs(value) {
  const t = value ? new Date(value).getTime() : Date.now();
  return Number.isFinite(t) ? t : Date.now();
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function snapTierForMinutes(value) {
  const mins = Number(value);
  if (!Number.isFinite(mins)) return null;
  if (mins <= 15) return 15;
  if (mins <= 25) return 25;
  if (mins <= 40) return 40;
  return 60;
}

async function ensureAthlete(client, athleteKey) {
  const externalKey = asText(athleteKey || process.env.TRAINER_ATHLETE_KEY || "local-demo", 120) || "local-demo";
  const displayName = asText(process.env.TRAINER_ATHLETE_NAME || "Ryan", 120) || "Ryan";
  const timezone = asText(process.env.TRAINER_TIMEZONE || "America/New_York", 80) || "America/New_York";
  const result = await client.query(
    `INSERT INTO trainer_athletes (external_key, display_name, timezone)
     VALUES ($1, $2, $3)
     ON CONFLICT (external_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           timezone = EXCLUDED.timezone,
           updated_at = now()
     RETURNING id, external_key, display_name, timezone, profile`,
    [externalKey, displayName, timezone],
  );
  return result.rows[0];
}

function rowsToLines(rows, mapper, max = 14) {
  return rows.slice(0, max).map(mapper).filter(Boolean).join(" | ");
}

function asIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function profileSummaryFromRow(row) {
  if (!row) return null;
  return {
    id: row.id || null,
    summary: row.summary || "",
    sourceStartAt: asIso(row.source_start_at),
    sourceEndAt: asIso(row.source_end_at),
    generatedAt: asIso(row.generated_at),
    data: valueOfJson(row.data, {}),
  };
}

function createdRange(groups) {
  const timestamps = [];
  Object.values(groups || {}).forEach((rows) => {
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      ["created_at", "last_seen_at", "generated_at"].forEach((key) => {
        const t = row && row[key] ? new Date(row[key]).getTime() : NaN;
        if (Number.isFinite(t)) timestamps.push(t);
      });
    });
  });
  if (!timestamps.length) return { sourceStartAt: null, sourceEndAt: null };
  return {
    sourceStartAt: new Date(Math.min(...timestamps)).toISOString(),
    sourceEndAt: new Date(Math.max(...timestamps)).toISOString(),
  };
}

export async function loadTrainerContext({ athleteKey } = {}) {
  const db = getPool();
  if (!db) return { configured: false, loaded: false, prompt: "" };
  const client = await db.connect();
  try {
    const athlete = await ensureAthlete(client, athleteKey);
    const [summary, memories, events, feedback, metrics, recovery, overrides] = await Promise.all([
      client.query(
        `SELECT summary, generated_at
         FROM trainer_profile_summaries
         WHERE athlete_id = $1
         ORDER BY generated_at DESC
         LIMIT 1`,
        [athlete.id],
      ),
      client.query(
        `SELECT memory_key, text, confidence, last_seen_at
         FROM trainer_memories
         WHERE athlete_id = $1 AND active = true
         ORDER BY confidence DESC NULLS LAST, last_seen_at DESC
         LIMIT 18`,
        [athlete.id],
      ),
      client.query(
        `SELECT event_type, occurred_on, body_area, severity, active, text, context, data, created_at
         FROM trainer_events
         WHERE athlete_id = $1
         ORDER BY COALESCE(occurred_on, created_at::date) DESC, created_at DESC
         LIMIT 24`,
        [athlete.id],
      ),
      client.query(
        `SELECT feedback_date, exercise_name, difficulty, actual_weight, observed_rir, next_weight, note
         FROM exercise_feedback
         WHERE athlete_id = $1
         ORDER BY COALESCE(feedback_date, created_at::date) DESC, created_at DESC
         LIMIT 18`,
        [athlete.id],
      ),
      client.query(
        `SELECT kind, value_num, value_text, unit, measured_on
         FROM body_metrics
         WHERE athlete_id = $1
         ORDER BY COALESCE(measured_on, created_at::date) DESC, created_at DESC
         LIMIT 18`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, sleep_hours, sleep_score, feel, note
         FROM recovery_logs
         WHERE athlete_id = $1
         ORDER BY COALESCE(log_date, created_at::date) DESC, created_at DESC
         LIMIT 10`,
        [athlete.id],
      ),
      client.query(
        `SELECT override_date, override_type, reason, patch
         FROM day_overrides
         WHERE athlete_id = $1 AND active = true
         ORDER BY override_date DESC, created_at DESC
         LIMIT 14`,
        [athlete.id],
      ),
    ]);

    const lines = [
      "DATABASE MEMORY (durable Postgres context; use this as saved trainer history, not as chat transcript):",
      "Athlete: " + athlete.display_name + " (" + athlete.external_key + ").",
      "Profile summary: " + (summary.rows[0] ? asText(summary.rows[0].summary, 1200) : "none yet."),
      "Durable facts: " + (rowsToLines(memories.rows, (m) => (m.memory_key ? m.memory_key + ": " : "") + m.text, 18) || "none yet."),
      "Recent timeline: " + (rowsToLines(events.rows, (e) => {
        const when = e.occurred_on ? String(e.occurred_on).slice(0, 10) : "";
        const area = e.body_area ? " [" + e.body_area + "]" : "";
        const active = e.active === true ? " active" : e.active === false ? " historical" : "";
        return when + " " + e.event_type + area + active + ": " + (e.text || e.context || JSON.stringify(e.data || {}).slice(0, 140));
      }, 20) || "none yet."),
      "Recent exercise feedback: " + (rowsToLines(feedback.rows, (f) => {
        const wt = f.actual_weight == null ? "" : " at " + f.actual_weight + " lb";
        const rir = f.observed_rir == null ? "" : ", RIR " + f.observed_rir;
        const next = f.next_weight == null ? "" : ", next " + f.next_weight;
        return String(f.feedback_date || "").slice(0, 10) + " " + f.exercise_name + " " + f.difficulty + wt + rir + next + (f.note ? ": " + f.note : "");
      }, 14) || "none yet."),
      "Recent metrics: " + (rowsToLines(metrics.rows, (m) => String(m.measured_on || "").slice(0, 10) + " " + m.kind + "=" + (m.value_num == null ? m.value_text : m.value_num) + (m.unit || ""), 14) || "none yet."),
      "Recent recovery: " + (rowsToLines(recovery.rows, (r) => String(r.log_date || "").slice(0, 10) + " sleep=" + (r.sleep_hours == null ? "?" : r.sleep_hours) + " score=" + (r.sleep_score == null ? "?" : r.sleep_score) + " feel=" + (r.feel || "") + (r.note ? ": " + r.note : ""), 10) || "none yet."),
      "Active day overrides: " + (rowsToLines(overrides.rows, (o) => String(o.override_date).slice(0, 10) + " " + o.override_type + ": " + (o.reason || JSON.stringify(o.patch || {}).slice(0, 180)), 10) || "none yet."),
      "When you output actions, the endpoint will persist them to these tables after the model turn.",
    ];
    return {
      configured: true,
      loaded: true,
      athleteId: athlete.id,
      prompt: lines.join("\n"),
      counts: {
        memories: memories.rowCount,
        events: events.rowCount,
        feedback: feedback.rowCount,
        metrics: metrics.rowCount,
        recovery: recovery.rowCount,
        overrides: overrides.rowCount,
      },
    };
  } catch (error) {
    return {
      configured: true,
      loaded: false,
      error: error instanceof Error ? error.message : "database context unavailable",
      prompt: "",
    };
  } finally {
    client.release();
  }
}

export async function loadTrainerProfileStatus({ athleteKey } = {}) {
  const db = getPool();
  if (!db) return { configured: false, loaded: false };
  const client = await db.connect();
  try {
    const athlete = await ensureAthlete(client, athleteKey);
    const latest = await client.query(
      `SELECT id, summary, source_start_at, source_end_at, data, generated_at
       FROM trainer_profile_summaries
       WHERE athlete_id = $1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [athlete.id],
    );
    const latestProfile = profileSummaryFromRow(latest.rows[0]);
    const since = latestProfile && latestProfile.generatedAt ? latestProfile.generatedAt : new Date(0).toISOString();
    const [totals, newer] = await Promise.all([
      client.query(
        `SELECT
          (SELECT count(*) FROM trainer_chat_turns WHERE athlete_id = $1)::int AS chat_turns,
          (SELECT count(*) FROM trainer_action_log WHERE athlete_id = $1)::int AS action_log,
          (SELECT count(*) FROM trainer_events WHERE athlete_id = $1)::int AS events,
          (SELECT count(*) FROM trainer_memories WHERE athlete_id = $1 AND active = true)::int AS memories,
          (SELECT count(*) FROM exercise_feedback WHERE athlete_id = $1)::int AS exercise_feedback,
          (SELECT count(*) FROM workout_sessions WHERE athlete_id = $1)::int AS workout_sessions,
          (SELECT count(*) FROM workout_exercise_sets WHERE athlete_id = $1)::int AS workout_sets,
          (SELECT count(*) FROM body_metrics WHERE athlete_id = $1)::int AS body_metrics,
          (SELECT count(*) FROM recovery_logs WHERE athlete_id = $1)::int AS recovery_logs,
          (SELECT count(*) FROM nutrition_logs WHERE athlete_id = $1)::int AS nutrition_logs,
          (SELECT count(*) FROM hydration_logs WHERE athlete_id = $1)::int AS hydration_logs`,
        [athlete.id],
      ),
      client.query(
        `SELECT
          (SELECT count(*) FROM trainer_chat_turns WHERE athlete_id = $1 AND created_at > $2)::int AS chat_turns,
          (SELECT count(*) FROM trainer_action_log WHERE athlete_id = $1 AND created_at > $2)::int AS action_log,
          (SELECT count(*) FROM trainer_events WHERE athlete_id = $1 AND created_at > $2)::int AS events,
          (SELECT count(*) FROM trainer_memories WHERE athlete_id = $1 AND active = true AND last_seen_at > $2)::int AS memories,
          (SELECT count(*) FROM exercise_feedback WHERE athlete_id = $1 AND created_at > $2)::int AS exercise_feedback,
          (SELECT count(*) FROM workout_sessions WHERE athlete_id = $1 AND created_at > $2)::int AS workout_sessions,
          (SELECT count(*) FROM workout_exercise_sets WHERE athlete_id = $1 AND created_at > $2)::int AS workout_sets,
          (SELECT count(*) FROM body_metrics WHERE athlete_id = $1 AND created_at > $2)::int AS body_metrics,
          (SELECT count(*) FROM recovery_logs WHERE athlete_id = $1 AND created_at > $2)::int AS recovery_logs,
          (SELECT count(*) FROM nutrition_logs WHERE athlete_id = $1 AND created_at > $2)::int AS nutrition_logs,
          (SELECT count(*) FROM hydration_logs WHERE athlete_id = $1 AND created_at > $2)::int AS hydration_logs`,
        [athlete.id, since],
      ),
    ]);
    return {
      configured: true,
      loaded: true,
      athlete: { id: athlete.id, externalKey: athlete.external_key, displayName: athlete.display_name },
      latest: latestProfile,
      counts: totals.rows[0] || {},
      newSinceSummary: latestProfile ? (newer.rows[0] || {}) : (totals.rows[0] || {}),
    };
  } catch (error) {
    return {
      configured: true,
      loaded: false,
      error: error instanceof Error ? error.message : "trainer profile status unavailable",
    };
  } finally {
    client.release();
  }
}

export async function loadTrainerProfileSource({ athleteKey } = {}) {
  const db = getPool();
  if (!db) return { configured: false, loaded: false };
  const client = await db.connect();
  try {
    const athlete = await ensureAthlete(client, athleteKey);
    const latest = await client.query(
      `SELECT id, summary, source_start_at, source_end_at, data, generated_at
       FROM trainer_profile_summaries
       WHERE athlete_id = $1
       ORDER BY generated_at DESC
       LIMIT 1`,
      [athlete.id],
    );
    const latestProfile = profileSummaryFromRow(latest.rows[0]);
    const since = latestProfile && latestProfile.generatedAt ? latestProfile.generatedAt : new Date(0).toISOString();
    const [
      chat,
      actions,
      events,
      memories,
      feedback,
      sets,
      sessions,
      metrics,
      recovery,
      nutrition,
      hydration,
      overrides,
      newer,
    ] = await Promise.all([
      client.query(
        `SELECT turn_date, user_message, assistant_reply, actions, model, created_at
         FROM trainer_chat_turns
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 40`,
        [athlete.id],
      ),
      client.query(
        `SELECT action_type, action, action_date, created_at
         FROM trainer_action_log
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 120`,
        [athlete.id],
      ),
      client.query(
        `SELECT event_type, occurred_on, body_area, severity, active, context, text, data, source, created_at
         FROM trainer_events
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT memory_key, text, confidence, active, first_seen_at, last_seen_at
         FROM trainer_memories
         WHERE athlete_id = $1 AND active = true
         ORDER BY confidence DESC NULLS LAST, last_seen_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT feedback_date, exercise_key, exercise_name, difficulty, actual_weight, observed_rir, next_weight, note, created_at
         FROM exercise_feedback
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT workout_date, exercise_name, weight, reps, rir, note, created_at
         FROM workout_exercise_sets
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT workout_date, session_key, status, duration_minutes, feel, session_rpe, completion_fraction, exercises_completed, exercises_skipped, notes, data, created_at
         FROM workout_sessions
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT kind, value_num, value_text, unit, measured_on, created_at
         FROM body_metrics
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, sleep_hours, sleep_score, readiness, hrv, resting_hr, feel, soreness, note, source, created_at
         FROM recovery_logs
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, text, source, created_at
         FROM nutrition_logs
         WHERE athlete_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, sum(ounces)::numeric AS ounces, max(created_at) AS created_at
         FROM hydration_logs
         WHERE athlete_id = $1
         GROUP BY log_date
         ORDER BY max(created_at) DESC
         LIMIT 40`,
        [athlete.id],
      ),
      client.query(
        `SELECT override_date, override_type, patch, reason, active, created_at
         FROM day_overrides
         WHERE athlete_id = $1 AND active = true
         ORDER BY created_at DESC
         LIMIT 60`,
        [athlete.id],
      ),
      client.query(
        `SELECT
          (SELECT count(*) FROM trainer_chat_turns WHERE athlete_id = $1 AND created_at > $2)::int AS chat_turns,
          (SELECT count(*) FROM trainer_action_log WHERE athlete_id = $1 AND created_at > $2)::int AS action_log,
          (SELECT count(*) FROM trainer_events WHERE athlete_id = $1 AND created_at > $2)::int AS events,
          (SELECT count(*) FROM trainer_memories WHERE athlete_id = $1 AND active = true AND last_seen_at > $2)::int AS memories,
          (SELECT count(*) FROM exercise_feedback WHERE athlete_id = $1 AND created_at > $2)::int AS exercise_feedback,
          (SELECT count(*) FROM workout_sessions WHERE athlete_id = $1 AND created_at > $2)::int AS workout_sessions,
          (SELECT count(*) FROM workout_exercise_sets WHERE athlete_id = $1 AND created_at > $2)::int AS workout_sets,
          (SELECT count(*) FROM body_metrics WHERE athlete_id = $1 AND created_at > $2)::int AS body_metrics,
          (SELECT count(*) FROM recovery_logs WHERE athlete_id = $1 AND created_at > $2)::int AS recovery_logs,
          (SELECT count(*) FROM nutrition_logs WHERE athlete_id = $1 AND created_at > $2)::int AS nutrition_logs,
          (SELECT count(*) FROM hydration_logs WHERE athlete_id = $1 AND created_at > $2)::int AS hydration_logs`,
        [athlete.id, since],
      ),
    ]);

    const groups = {
      chatTurns: chat.rows,
      actionLog: actions.rows,
      events: events.rows,
      memories: memories.rows,
      exerciseFeedback: feedback.rows,
      workoutSets: sets.rows,
      workoutSessions: sessions.rows,
      bodyMetrics: metrics.rows,
      recoveryLogs: recovery.rows,
      nutritionLogs: nutrition.rows,
      hydrationLogs: hydration.rows,
      dayOverrides: overrides.rows,
    };
    const counts = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length]));
    const range = createdRange(groups);
    return {
      configured: true,
      loaded: true,
      athlete: { id: athlete.id, externalKey: athlete.external_key, displayName: athlete.display_name },
      latestSummary: latestProfile,
      counts,
      newSinceSummary: latestProfile ? (newer.rows[0] || {}) : counts,
      sourceStartAt: range.sourceStartAt,
      sourceEndAt: range.sourceEndAt,
      data: {
        chatTurns: chat.rows.slice().reverse().map((r) => ({
          date: r.turn_date ? String(r.turn_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          user: asText(r.user_message, 900),
          coach: asText(r.assistant_reply, 700),
          actions: valueOfJson(r.actions, []),
          model: r.model,
          createdAt: asIso(r.created_at),
        })),
        actionLog: actions.rows.slice().reverse().map((r) => ({
          type: r.action_type,
          date: r.action_date ? String(r.action_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          action: valueOfJson(r.action, {}),
          createdAt: asIso(r.created_at),
        })),
        events: events.rows.slice().reverse().map((r) => ({
          type: r.event_type,
          date: r.occurred_on ? String(r.occurred_on).slice(0, 10) : String(r.created_at).slice(0, 10),
          bodyArea: r.body_area || "",
          severity: numOrNull(r.severity),
          active: r.active,
          context: asText(r.context, 300),
          text: asText(r.text, 500),
          data: valueOfJson(r.data, {}),
          source: r.source,
          createdAt: asIso(r.created_at),
        })),
        memories: memories.rows.map((r) => ({
          key: r.memory_key || "",
          text: asText(r.text, 700),
          confidence: numOrNull(r.confidence),
          firstSeenAt: asIso(r.first_seen_at),
          lastSeenAt: asIso(r.last_seen_at),
        })),
        exerciseFeedback: feedback.rows.slice().reverse().map((r) => ({
          date: r.feedback_date ? String(r.feedback_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          key: r.exercise_key || "",
          exercise: r.exercise_name,
          difficulty: r.difficulty,
          actualWeight: numOrNull(r.actual_weight),
          observedRir: numOrNull(r.observed_rir),
          nextWeight: numOrNull(r.next_weight),
          note: asText(r.note, 500),
          createdAt: asIso(r.created_at),
        })),
        workoutSets: sets.rows.slice().reverse().map((r) => ({
          date: r.workout_date ? String(r.workout_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          exercise: r.exercise_name,
          weight: numOrNull(r.weight),
          reps: numOrNull(r.reps),
          rir: numOrNull(r.rir),
          note: asText(r.note, 400),
          createdAt: asIso(r.created_at),
        })),
        workoutSessions: sessions.rows.slice().reverse().map((r) => ({
          date: r.workout_date ? String(r.workout_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          session: r.session_key || "",
          status: r.status,
          duration: numOrNull(r.duration_minutes),
          feel: r.feel || "",
          sessionRpe: numOrNull(r.session_rpe),
          completionFraction: numOrNull(r.completion_fraction),
          completed: valueOfJson(r.exercises_completed, []),
          skipped: valueOfJson(r.exercises_skipped, []),
          notes: asText(r.notes, 500),
          data: valueOfJson(r.data, {}),
          createdAt: asIso(r.created_at),
        })),
        bodyMetrics: metrics.rows.slice().reverse().map((r) => ({
          date: r.measured_on ? String(r.measured_on).slice(0, 10) : String(r.created_at).slice(0, 10),
          kind: r.kind,
          value: r.value_num == null ? r.value_text : numOrNull(r.value_num),
          unit: r.unit || "",
          createdAt: asIso(r.created_at),
        })),
        recoveryLogs: recovery.rows.slice().reverse().map((r) => ({
          date: r.log_date ? String(r.log_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          sleepHours: numOrNull(r.sleep_hours),
          sleepScore: numOrNull(r.sleep_score),
          readiness: numOrNull(r.readiness),
          hrv: numOrNull(r.hrv),
          restingHr: numOrNull(r.resting_hr),
          feel: r.feel || "",
          soreness: valueOfJson(r.soreness, {}),
          note: asText(r.note, 500),
          source: r.source,
          createdAt: asIso(r.created_at),
        })),
        nutritionLogs: nutrition.rows.slice().reverse().map((r) => ({
          date: r.log_date ? String(r.log_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          text: asText(r.text, 700),
          source: r.source,
          createdAt: asIso(r.created_at),
        })),
        hydrationLogs: hydration.rows.slice().reverse().map((r) => ({
          date: r.log_date ? String(r.log_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          ounces: numOrNull(r.ounces),
          createdAt: asIso(r.created_at),
        })),
        dayOverrides: overrides.rows.slice().reverse().map((r) => ({
          date: r.override_date ? String(r.override_date).slice(0, 10) : String(r.created_at).slice(0, 10),
          type: r.override_type,
          patch: valueOfJson(r.patch, {}),
          reason: asText(r.reason, 500),
          active: !!r.active,
          createdAt: asIso(r.created_at),
        })),
      },
    };
  } catch (error) {
    return {
      configured: true,
      loaded: false,
      error: error instanceof Error ? error.message : "trainer profile source unavailable",
    };
  } finally {
    client.release();
  }
}

export async function saveTrainerProfileSummary({ athleteKey, summary, data, sourceStartAt, sourceEndAt } = {}) {
  const db = getPool();
  if (!db) return { configured: false, saved: false };
  const client = await db.connect();
  try {
    const athlete = await ensureAthlete(client, athleteKey);
    const result = await client.query(
      `INSERT INTO trainer_profile_summaries (athlete_id, summary, source_start_at, source_end_at, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, summary, source_start_at, source_end_at, data, generated_at`,
      [
        athlete.id,
        asText(summary, 4000) || "Not enough durable trainer data yet.",
        sourceStartAt || null,
        sourceEndAt || null,
        payload(data || {}),
      ],
    );
    return {
      configured: true,
      saved: true,
      profile: profileSummaryFromRow(result.rows[0]),
    };
  } catch (error) {
    return {
      configured: true,
      saved: false,
      error: error instanceof Error ? error.message : "trainer profile save failed",
    };
  } finally {
    client.release();
  }
}

function dayOverrideFromRow(row) {
  const patch = valueOfJson(row.patch, {});
  const type = row.override_type || patch.type;
  const out = {};
  if (type === "set_day_time" || type === "set_today_time") {
    const minutes = numOrNull(patch.minutes || patch.availableMinutes);
    if (minutes != null) {
      out.availableMinutes = minutes;
      out.tier = snapTierForMinutes(minutes);
      out.reason = row.reason || patch.reason || "Hydrated time window from trainer memory.";
    }
  }
  if (type === "set_day_constraints") {
    out.constraints = {
      travel: !!patch.travel,
      noGym: !!(patch.noGym || patch.no_gym),
      noEquipment: !!(patch.noEquipment || patch.no_equipment),
    };
    out.reason = row.reason || patch.note || "Hydrated day constraint from trainer memory.";
  }
  return Object.keys(out).length ? out : null;
}

function normalizeGoalKey(value) {
  const s = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!s) return null;
  const compact = s.replace(/\s+/g, "");
  if (compact === "fivek" || /5k|fivek|five k|five kilometer/.test(s)) return "fiveK";
  if (/mile|1600/.test(s)) return "mile";
  if (/bench|press/.test(s)) return "bench";
  if (/pull/.test(s)) return "pullup";
  if (/muscle up|muscleup|\bmu\b/.test(s)) return "mu";
  if (/bodyweight|body weight|weight/.test(s)) return "bw";
  if (/abs|physique|lean/.test(s)) return "abs";
  if (/speed|agility|corner|route|cutting|change of direction/.test(s)) return "speed";
  if (/vertical|jump|dunk/.test(s)) return "vertical";
  return ["mile", "bench", "pullup", "mu", "bw", "abs", "speed", "vertical"].includes(compact) ? compact : null;
}

function secondsFromMmss(value) {
  const m = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function goalOverrideFromAction(row) {
  const action = valueOfJson(row.action, {});
  const key = normalizeGoalKey(action.key || action.goal);
  if (!key) return null;
  const target = String(action.target == null ? "" : action.target).trim();
  const lower = target.toLowerCase();
  const off = action.active === false || /\b(remove|drop|retire|pause|stop|inactive|off|no longer|not anymore|do not care|don't care|dont care|not a goal)\b/.test(lower);
  const on = action.active === true || /\b(restore|resume|active|on|restart|bring back)\b/.test(lower);
  if (off) return { key, override: { active: false, label: "Paused", reason: action.reason || action.note || target || "Paused by trainer chat", updatedAt: tsMs(row.created_at) } };
  const override = { active: true, label: target || "Active", reason: action.reason || action.note || "", updatedAt: tsMs(row.created_at) };
  const priority = asNumber(action.priority);
  if (priority != null) override.priority = Math.max(0.35, Math.min(1.8, priority));
  const sec = secondsFromMmss(target);
  const num = Number.parseFloat(target);
  if (sec != null) override.targetSec = sec;
  else if (Number.isFinite(num)) override.targetVal = num;
  else if (on && !target) override.label = "Active";
  return { key, override };
}

export async function loadTrainerSnapshot({ athleteKey } = {}) {
  const db = getPool();
  if (!db) return { configured: false, hydrated: false, state: null };
  const client = await db.connect();
  try {
    const athlete = await ensureAthlete(client, athleteKey);
    const [
      memories,
      events,
      food,
      water,
      recovery,
      metrics,
      sessions,
      feedback,
      overrides,
      goalActions,
    ] = await Promise.all([
      client.query(
        `SELECT memory_key, text, confidence, last_seen_at
         FROM trainer_memories
         WHERE athlete_id = $1 AND active = true
         ORDER BY last_seen_at ASC
         LIMIT 120`,
        [athlete.id],
      ),
      client.query(
        `SELECT id, event_type, occurred_on, occurred_at, body_area, severity, active, context, text, data, source, created_at
         FROM trainer_events
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 500`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, text, created_at
         FROM nutrition_logs
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 120`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, ounces, source, created_at
         FROM hydration_logs
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 240`,
        [athlete.id],
      ),
      client.query(
        `SELECT log_date, sleep_hours, sleep_score, feel, note, source, created_at
         FROM recovery_logs
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 120`,
        [athlete.id],
      ),
      client.query(
        `SELECT kind, value_num, value_text, unit, measured_on, created_at
         FROM body_metrics
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 300`,
        [athlete.id],
      ),
      client.query(
        `SELECT workout_date, session_key, status, duration_minutes, feel, session_rpe, completion_fraction, exercises_completed, exercises_skipped, notes, data, created_at
         FROM workout_sessions
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 180`,
        [athlete.id],
      ),
      client.query(
        `SELECT feedback_date, exercise_name, difficulty, actual_weight, observed_rir, next_weight, note, created_at
         FROM exercise_feedback
         WHERE athlete_id = $1
         ORDER BY created_at ASC
         LIMIT 180`,
        [athlete.id],
      ),
      client.query(
        `SELECT override_date, override_type, reason, patch, created_at
         FROM day_overrides
         WHERE athlete_id = $1 AND active = true
         ORDER BY created_at ASC
         LIMIT 180`,
        [athlete.id],
      ),
      client.query(
        `SELECT action, created_at
         FROM trainer_action_log
         WHERE athlete_id = $1 AND action_type = 'set_goal'
         ORDER BY created_at ASC
         LIMIT 120`,
        [athlete.id],
      ),
    ]);

    const snapshot = {
      trainerMemory: {
        facts: memories.rows.map((m) => ({
          key: m.memory_key || String(m.text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80),
          text: m.text,
          date: String(m.last_seen_at || "").slice(0, 10),
          confidence: numOrNull(m.confidence),
          ts: tsMs(m.last_seen_at),
          source: "postgres",
        })),
      },
      athleteEvents: events.rows.map((e) => ({
        id: String(e.id),
        date: e.occurred_on ? String(e.occurred_on).slice(0, 10) : String(e.created_at).slice(0, 10),
        occurredAt: e.occurred_at ? new Date(e.occurred_at).toISOString() : e.occurred_on ? String(e.occurred_on).slice(0, 10) : String(e.created_at).slice(0, 10),
        reportedAt: tsMs(e.created_at),
        source: e.source || "postgres",
        eventType: e.event_type || "note",
        bodyArea: e.body_area || "",
        severity: numOrNull(e.severity),
        active: e.active == null ? null : !!e.active,
        context: e.context || "",
        text: e.text || "",
        data: valueOfJson(e.data, {}),
      })),
      nutrition: food.rows.map((n) => ({
        date: n.log_date ? String(n.log_date).slice(0, 10) : String(n.created_at).slice(0, 10),
        text: n.text || "",
        ts: tsMs(n.created_at),
        source: "postgres",
      })),
      hydration: water.rows.map((h) => ({
        date: h.log_date ? String(h.log_date).slice(0, 10) : String(h.created_at).slice(0, 10),
        ounces: numOrNull(h.ounces),
        source: h.source || "postgres",
        ts: tsMs(h.created_at),
      })).filter((h) => h.ounces != null),
      recoveryLog: recovery.rows.map((r) => ({
        date: r.log_date ? String(r.log_date).slice(0, 10) : String(r.created_at).slice(0, 10),
        sleepHours: numOrNull(r.sleep_hours),
        sleepScore: numOrNull(r.sleep_score),
        feel: r.feel || "",
        note: r.note || "",
        source: r.source || "postgres",
        ts: tsMs(r.created_at),
      })),
      metrics: { bodyweight: [], waist: [], pullupBest: [], mileBest: null, fiveKBest: null, muscleUp: false },
      log: sessions.rows.map((s) => ({
        date: s.workout_date ? String(s.workout_date).slice(0, 10) : String(s.created_at).slice(0, 10),
        sessionId: s.session_key || null,
        status: s.status || "completed",
        duration: numOrNull(s.duration_minutes),
        feel: s.feel || null,
        sessionRpe: numOrNull(s.session_rpe),
        completionFraction: numOrNull(s.completion_fraction),
        exercisesCompleted: valueOfJson(s.exercises_completed, []),
        exercisesSkipped: valueOfJson(s.exercises_skipped, []),
        note: s.notes || "",
        data: valueOfJson(s.data, {}),
        ts: tsMs(s.created_at),
        source: "postgres",
      })),
      coachMemory: { observations: [] },
      dayWorkoutOverrides: {},
      dayFlags: {},
      goalOverrides: {},
    };

    metrics.rows.forEach((m) => {
      const date = m.measured_on ? String(m.measured_on).slice(0, 10) : String(m.created_at).slice(0, 10);
      const raw = m.value_num == null ? m.value_text : m.value_num;
      const numeric = numOrNull(raw);
      if (m.kind === "bodyweight" && numeric != null) snapshot.metrics.bodyweight.push({ date, v: numeric, ts: tsMs(m.created_at), source: "postgres" });
      else if (m.kind === "waist" && numeric != null) snapshot.metrics.waist.push({ date, v: numeric, ts: tsMs(m.created_at), source: "postgres" });
      else if (m.kind === "pullup" && numeric != null) snapshot.metrics.pullupBest.push({ date, v: numeric, ts: tsMs(m.created_at), source: "postgres" });
      else if (m.kind === "mile" && raw != null) snapshot.metrics.mileBest = raw;
      else if (m.kind === "fiveK" && raw != null) snapshot.metrics.fiveKBest = raw;
      else if (m.kind === "muscleUp") snapshot.metrics.muscleUp = Boolean(raw);
    });

    feedback.rows.forEach((f) => {
      const date = f.feedback_date ? String(f.feedback_date).slice(0, 10) : String(f.created_at).slice(0, 10);
      const weight = f.actual_weight == null ? "" : " at " + f.actual_weight + " lb";
      const next = f.next_weight == null ? "" : "; next load " + f.next_weight;
      snapshot.coachMemory.observations.push({
        date,
        text: (f.exercise_name || "Exercise") + " felt " + (f.difficulty || "noted") + weight + next + (f.note ? " — " + f.note : ""),
        ts: tsMs(f.created_at),
        source: "postgres",
      });
    });

    overrides.rows.forEach((row) => {
      const date = row.override_date ? String(row.override_date).slice(0, 10) : null;
      if (!date) return;
      if (row.override_type === "flag_exhausted") snapshot.dayFlags[date] = "exhausted";
      const patch = dayOverrideFromRow(row);
      if (patch) snapshot.dayWorkoutOverrides[date] = { ...(snapshot.dayWorkoutOverrides[date] || {}), ...patch };
    });

    goalActions.rows.forEach((row) => {
      const parsed = goalOverrideFromAction(row);
      if (parsed) snapshot.goalOverrides[parsed.key] = { ...(snapshot.goalOverrides[parsed.key] || {}), ...parsed.override };
    });

    return {
      configured: true,
      hydrated: true,
      athlete: { id: athlete.id, externalKey: athlete.external_key, displayName: athlete.display_name },
      state: snapshot,
    };
  } catch (error) {
    return {
      configured: true,
      hydrated: false,
      error: error instanceof Error ? error.message : "database hydration failed",
      state: null,
    };
  } finally {
    client.release();
  }
}

async function insertTimelineEvent(client, athleteId, turnId, action, fallbackDate, override = {}) {
  const date = asDate(override.date || action.date || action.occurred_at, fallbackDate);
  await client.query(
    `INSERT INTO trainer_events
       (athlete_id, turn_id, event_type, occurred_on, occurred_at, body_area, severity, active, context, text, data, source)
     VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10::jsonb, 'coach')`,
    [
      athleteId,
      turnId,
      asText(override.eventType || action.event_type || action.type || "note", 80),
      date,
      asText(override.bodyArea || action.body_area || "", 80) || null,
      asNumber(override.severity ?? action.severity),
      override.active ?? action.active ?? null,
      asText(override.context || action.context || action.reason || "", 700),
      asText(override.text || action.text || action.notes || action.note || "", 700),
      payload({ action, ...(override.data || {}) }),
    ],
  );
}

async function insertDayOverride(client, athleteId, turnId, action, fallbackDate, overrideType) {
  const date = asDate(action.date || action.to_date || action.from_date, fallbackDate);
  if (!date) return;
  await client.query(
    `INSERT INTO day_overrides (athlete_id, turn_id, override_date, override_type, patch, reason)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [athleteId, turnId, date, overrideType || action.type, payload(action), actionText(action) || null],
  );
}

async function persistAction(client, athleteId, turnId, action, fallbackDate) {
  const type = asText(action.type, 80);
  const date = actionDate(action, fallbackDate);

  await client.query(
    `INSERT INTO trainer_action_log (athlete_id, turn_id, action_index, action_type, action, action_date)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [athleteId, turnId, action.__index || 0, type || "unknown", payload(action), date],
  );

  if (type === "remember_fact" && action.text) {
    await client.query(
      `INSERT INTO trainer_memories (athlete_id, memory_key, text, confidence, data)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (athlete_id, memory_key) WHERE memory_key IS NOT NULL
       DO UPDATE SET text = EXCLUDED.text,
                     confidence = EXCLUDED.confidence,
                     active = true,
                     data = trainer_memories.data || EXCLUDED.data,
                     last_seen_at = now()`,
      [athleteId, asText(action.key || null, 120) || null, asText(action.text, 900), asNumber(action.confidence), payload(action)],
    );
  } else if (type === "log_metric") {
    await client.query(
      `INSERT INTO body_metrics (athlete_id, kind, value_num, value_text, unit, measured_on, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [athleteId, asText(action.kind, 80), asNumber(action.value), action.value == null ? null : asText(action.value, 120), asText(action.unit || "", 24) || null, date, payload(action)],
    );
  } else if (type === "log_bench") {
    await client.query(
      `INSERT INTO body_metrics (athlete_id, kind, value_num, value_text, unit, measured_on, data)
       VALUES ($1, 'bench', $2, $3, 'lb', $4, $5::jsonb)`,
      [athleteId, asNumber(action.weight), action.weight == null ? null : asText(action.weight, 120), date, payload(action)],
    );
  } else if (type === "log_water") {
    const ounces = asNumber(action.ounces);
    if (ounces != null) {
      await client.query(
        `INSERT INTO hydration_logs (athlete_id, log_date, ounces, source, data)
         VALUES ($1, $2, $3, 'coach', $4::jsonb)`,
        [athleteId, date, ounces, payload(action)],
      );
    }
  } else if (type === "log_food" && action.text) {
    await client.query(
      `INSERT INTO nutrition_logs (athlete_id, log_date, text, source, data)
       VALUES ($1, $2, $3, 'coach', $4::jsonb)`,
      [athleteId, date, asText(action.text, 900), payload(action)],
    );
  } else if (type === "log_recovery" || type === "weekly_checkin") {
    await client.query(
      `INSERT INTO recovery_logs (athlete_id, log_date, sleep_hours, sleep_score, feel, note, source, data)
       VALUES ($1, $2, $3, $4, $5, $6, 'coach', $7::jsonb)`,
      [
        athleteId,
        date,
        asNumber(action.sleep_hours),
        asNumber(action.sleep_score),
        asText(action.feel || action.knee || "", 160),
        asText(action.note || action.notes || "", 900),
        payload(action),
      ],
    );
    if (type === "weekly_checkin") {
      if (action.bodyweight != null) {
        await client.query(
          `INSERT INTO body_metrics (athlete_id, kind, value_num, value_text, unit, measured_on, data)
           VALUES ($1, 'bodyweight', $2, $3, 'lb', $4, $5::jsonb)`,
          [athleteId, asNumber(action.bodyweight), asText(action.bodyweight, 120), date, payload(action)],
        );
      }
      if (action.waist != null) {
        await client.query(
          `INSERT INTO body_metrics (athlete_id, kind, value_num, value_text, unit, measured_on, data)
           VALUES ($1, 'waist', $2, $3, 'in', $4, $5::jsonb)`,
          [athleteId, asNumber(action.waist), asText(action.waist, 120), date, payload(action)],
        );
      }
    }
  } else if (type === "exercise_feedback") {
    await client.query(
      `INSERT INTO exercise_feedback
         (athlete_id, turn_id, feedback_date, exercise_key, exercise_name, difficulty, actual_weight, observed_rir, next_weight, note, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [
        athleteId,
        turnId,
        date,
        asText(action.key || "", 120) || null,
        asText(action.name || "exercise", 160),
        asText(action.difficulty || "note", 80),
        asNumber(action.actual_weight ?? action.weight),
        asNumber(action.observed_rir),
        asNumber(action.next_weight),
        actionText(action) || null,
        payload(action),
      ],
    );
  } else if (type === "log_set") {
    await client.query(
      `INSERT INTO workout_exercise_sets
         (athlete_id, turn_id, workout_date, exercise_name, weight, reps, rir, note, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [athleteId, turnId, date, asText(action.name || "exercise", 160), asNumber(action.weight), asNumber(action.reps), asNumber(action.rir), actionText(action) || null, payload(action)],
    );
  } else if (type === "set_goal" && action.key) {
    const goalKey = normalizeGoalKey(action.key) || asText(action.key, 80);
    const target = asText(action.target || "", 240);
    const inactive = action.active === false || /\b(remove|drop|retire|pause|stop|inactive|off|no longer|not anymore|do not care|don't care|dont care|not a goal)\b/i.test(target);
    const priority = asNumber(action.priority);
    const priorityText = priority != null ? ` Priority multiplier ${Math.max(0.35, Math.min(1.8, priority))}.` : "";
    const text = inactive
      ? `Goal ${goalKey} is paused and should not drive workout selection.`
      : `Goal ${goalKey} target is ${target || "active"}.${priorityText}`;
    await client.query(
      `INSERT INTO trainer_memories (athlete_id, memory_key, text, confidence, data)
       VALUES ($1, $2, $3, 0.95, $4::jsonb)
       ON CONFLICT (athlete_id, memory_key) WHERE memory_key IS NOT NULL
       DO UPDATE SET text = EXCLUDED.text,
                     confidence = EXCLUDED.confidence,
                     active = true,
                     data = trainer_memories.data || EXCLUDED.data,
                     last_seen_at = now()`,
      [athleteId, "goal_" + goalKey, text, payload(action)],
    );
  } else if (["complete_session", "log_partial_session", "skip_session"].includes(type)) {
    const status = type === "complete_session" ? "completed" : type === "skip_session" ? "skipped" : "partial";
    await client.query(
      `INSERT INTO workout_sessions
         (athlete_id, turn_id, workout_date, session_key, status, duration_minutes, feel, session_rpe, completion_fraction, exercises_completed, exercises_skipped, notes, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13::jsonb)`,
      [
        athleteId,
        turnId,
        date,
        asText(action.session || action.session_id || "", 80) || null,
        status,
        asNumber(action.duration),
        asText(action.feel || "", 120) || null,
        asNumber(action.session_rpe),
        asNumber(action.completion_fraction),
        listPayload(action.exercises_completed),
        listPayload(action.exercises_skipped),
        actionText(action) || null,
        payload(action),
      ],
    );
  }

  if (type === "log_event") {
    await insertTimelineEvent(client, athleteId, turnId, action, fallbackDate);
  } else if (["adjust_week_from_feedback", "set_knee", "skip_session", "log_partial_session", "complete_session"].includes(type)) {
    await insertTimelineEvent(client, athleteId, turnId, action, fallbackDate, {
      eventType: type,
      text: actionText(action),
      bodyArea: Array.isArray(action.pain_areas) ? action.pain_areas.join(", ") : action.body_area,
      data: { plannerRelevant: true },
    });
  }

  if ([
    "modify_today_session",
    "defer_exercises",
    "extend_today_session",
    "shorten_today_session",
    "set_today_time",
    "set_day_time",
    "set_day_constraints",
    "flag_exhausted",
    "set_availability",
  ].includes(type)) {
    await insertDayOverride(client, athleteId, turnId, action, fallbackDate, type);
  }
}

export async function persistTrainerTurn({ athleteKey, today, userText, assistantReply, actions, model, dbContext } = {}) {
  const db = getPool();
  if (!db) return { configured: false, saved: false };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const athlete = await ensureAthlete(client, athleteKey);
    const cleanActions = Array.isArray(actions) ? actions.slice(0, 16) : [];
    const turnResult = await client.query(
      `INSERT INTO trainer_chat_turns (athlete_id, turn_date, user_message, assistant_reply, actions, model, db_context)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       RETURNING id`,
      [
        athlete.id,
        asDate(today, null),
        asText(userText, 4000),
        asText(assistantReply, 4000),
        payload(cleanActions),
        asText(model, 100) || null,
        payload(dbContext || {}),
      ],
    );
    const turnId = turnResult.rows[0].id;
    for (let i = 0; i < cleanActions.length; i += 1) {
      await persistAction(client, athlete.id, turnId, { ...cleanActions[i], __index: i }, today);
    }
    await client.query("COMMIT");
    return { configured: true, saved: true, turnId, actionsSaved: cleanActions.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("trainer db persist failed", error);
    return { configured: true, saved: false, error: error instanceof Error ? error.message : "database persist failed" };
  } finally {
    client.release();
  }
}

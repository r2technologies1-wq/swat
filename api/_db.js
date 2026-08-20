import pg from "pg";

const { Pool } = pg;

let pool;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!databaseConfigured()) return null;
  if (!pool) {
    const needsSsl = /neon\.tech|sslmode=require/i.test(process.env.DATABASE_URL || "");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX || 4),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
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

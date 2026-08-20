const ACTION_LIMIT = 8;
const STRING_LIMIT = 900;
const ARRAY_LIMIT = 24;

const ALLOWED_TYPES = new Set([
  "complete_session",
  "log_partial_session",
  "skip_session",
  "recalc_week",
  "adjust_week_from_feedback",
  "set_fatigue",
  "exercise_feedback",
  "modify_today_session",
  "defer_exercises",
  "extend_today_session",
  "shorten_today_session",
  "set_today_time",
  "log_event",
  "remember_fact",
  "log_set",
  "log_bench",
  "set_bench_weight",
  "log_metric",
  "log_food",
  "log_water",
  "log_recovery",
  "weekly_checkin",
  "log_note",
  "set_goal",
  "set_knee",
  "set_availability",
  "set_day_time",
  "set_day_constraints",
  "flag_exhausted",
  "add_exercise",
  "remove_exercise",
  "set_exercise_weight",
  "set_skill_stage",
]);

const COMMON_KEYS = new Set([
  "type",
  "date",
  "from_date",
  "to_date",
  "reason",
  "note",
  "notes",
  "text",
  "data",
]);

const TYPE_KEYS = {
  complete_session: ["feel", "session", "session_id"],
  log_partial_session: ["duration", "exercises_completed", "exercises_skipped", "feel", "session_rpe", "completion_fraction"],
  skip_session: ["session", "session_id"],
  adjust_week_from_feedback: ["session_rpe", "fatigue_areas", "systemic_fatigue", "pain_areas"],
  set_fatigue: ["area", "level"],
  exercise_feedback: ["name", "difficulty", "actual_weight", "weight", "observed_rir", "next_weight"],
  modify_today_session: ["remove_exercises", "add_exercises"],
  defer_exercises: ["exercises"],
  extend_today_session: ["minutes"],
  shorten_today_session: ["minutes"],
  set_today_time: ["minutes"],
  log_event: ["event_type", "occurred_at", "body_area", "severity", "active", "context"],
  remember_fact: ["key", "confidence"],
  log_set: ["name", "weight", "reps", "rir"],
  log_bench: ["weight", "reps"],
  set_bench_weight: ["weight"],
  log_metric: ["kind", "value", "unit"],
  log_food: [],
  log_water: ["ounces"],
  log_recovery: ["sleep_hours", "sleep_score", "feel"],
  weekly_checkin: ["bodyweight", "waist", "knee", "feel"],
  log_note: [],
  set_goal: ["key", "target"],
  set_knee: ["status"],
  set_availability: ["dow", "minutes"],
  set_day_time: ["minutes"],
  set_day_constraints: ["travel", "no_gym", "noGym", "no_equipment", "noEquipment"],
  flag_exhausted: [],
  add_exercise: ["session", "name", "sets_reps", "weight"],
  remove_exercise: ["session", "name"],
  set_exercise_weight: ["name", "weight"],
  set_skill_stage: ["stage"],
};

const ENUMS = {
  difficulty: new Set(["too_easy", "appropriate", "too_hard"]),
  knee: new Set(["good", "watch", "irritated"]),
  status: new Set(["good", "watch", "irritated"]),
};

function cleanDate(value) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cleanString(value, max = STRING_LIMIT) {
  if (value == null) return null;
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNumber(value, min = -100000, max = 100000) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function cleanBool(value) {
  return value === true || value === "true" ? true : value === false || value === "false" ? false : null;
}

function cleanArray(value, mapper = cleanString) {
  const arr = Array.isArray(value) ? value : typeof value === "string" ? value.split(/,|\+/) : [];
  return arr.slice(0, ARRAY_LIMIT).map(mapper).filter((v) => v != null && v !== "");
}

function cleanData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return undefined;
  }
}

function allowedKeysFor(type) {
  return new Set([...COMMON_KEYS, ...(TYPE_KEYS[type] || [])]);
}

function cleanValue(key, value) {
  if (["date", "from_date", "to_date"].includes(key)) return cleanDate(value);
  if (["minutes", "duration"].includes(key)) return cleanNumber(value, 0, 300);
  if (["weight", "actual_weight", "next_weight", "bodyweight"].includes(key)) return cleanNumber(value, 0, 1000);
  if (key === "reps") return Array.isArray(value) ? cleanArray(value, (v) => cleanNumber(v, 0, 1000)) : cleanNumber(value, 0, 1000);
  if (["reps", "rir", "observed_rir", "session_rpe", "sleep_hours", "sleep_score", "waist", "ounces", "severity", "level", "stage", "dow", "completion_fraction"].includes(key)) return cleanNumber(value, 0, key === "completion_fraction" ? 1 : 1000);
  if (["active", "travel", "no_gym", "noGym", "no_equipment", "noEquipment"].includes(key)) return cleanBool(value);
  if (["exercises", "exercises_completed", "exercises_skipped", "remove_exercises", "fatigue_areas", "pain_areas", "reps"].includes(key)) return cleanArray(value);
  if (key === "add_exercises") return Array.isArray(value) ? value.slice(0, 12).map((x) => {
    if (typeof x === "string") return cleanString(x, 120);
    if (!x || typeof x !== "object") return null;
    return {
      name: cleanString(x.name, 120),
      sets_reps: cleanString(x.sets_reps, 80),
    };
  }).filter(Boolean) : [];
  if (key === "difficulty") return ENUMS.difficulty.has(value) ? value : null;
  if (key === "status" || key === "knee") return ENUMS.status.has(value) ? value : null;
  if (key === "data") return cleanData(value);
  return cleanString(value);
}

export function validateTrainerActions(input) {
  const rejected = [];
  const clean = [];
  if (!Array.isArray(input)) return { actions: [], rejected: [{ reason: "actions_not_array" }] };

  input.slice(0, ACTION_LIMIT).forEach((action, index) => {
    if (!action || typeof action !== "object") {
      rejected.push({ index, reason: "not_object" });
      return;
    }
    const type = cleanString(action.type, 80);
    if (!ALLOWED_TYPES.has(type)) {
      rejected.push({ index, type: type || "missing", reason: "unknown_type" });
      return;
    }

    const keys = allowedKeysFor(type);
    const out = { type };
    Object.entries(action).forEach(([key, value]) => {
      if (!keys.has(key)) return;
      const next = cleanValue(key, value);
      if (next !== null && next !== undefined && !(Array.isArray(next) && next.length === 0)) out[key] = next;
    });

    if (type === "exercise_feedback" && !out.name) {
      rejected.push({ index, type, reason: "missing_exercise_name" });
      return;
    }
    if (type === "set_knee" && !out.status) {
      rejected.push({ index, type, reason: "bad_knee_status" });
      return;
    }
    if ((type === "log_water" && out.ounces == null) || (type === "log_metric" && (!out.kind || out.value == null))) {
      rejected.push({ index, type, reason: "missing_required_value" });
      return;
    }

    clean.push(out);
  });

  return { actions: clean, rejected };
}

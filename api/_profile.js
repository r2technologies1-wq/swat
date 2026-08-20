import { databaseConfigured, loadTrainerProfileSource, saveTrainerProfileSummary } from "./_db.js";

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_SOURCE_CHARS = 24000;
const inflight = new Map();

function extractResponseText(data) {
  if (data && typeof data.output_text === "string") return data.output_text;
  const out = [];
  for (const item of (data && Array.isArray(data.output) ? data.output : [])) {
    for (const part of (item && Array.isArray(item.content) ? item.content : [])) {
      if (part && part.type === "output_text" && typeof part.text === "string") out.push(part.text);
    }
  }
  return out.join("\n");
}

function parseJsonObject(text) {
  const raw = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed = JSON.parse(raw.slice(first, last + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function asText(value, max = 700) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function asList(value, maxItems = 8, maxChars = 220) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  return raw
    .map((item) => {
      if (typeof item === "string") return asText(item, maxChars);
      if (item && typeof item === "object") {
        const target = asText(item.target || item.exercise || item.area || item.kind || "", 80);
        const rule = asText(item.rule || item.text || item.note || item.summary || JSON.stringify(item), maxChars);
        return target ? `${target}: ${rule}` : rule;
      }
      return asText(item, maxChars);
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.35;
  return Math.max(0, Math.min(1, n));
}

function boundedJson(value, maxChars = MAX_SOURCE_CHARS) {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxChars) return json;
  return json.slice(0, maxChars) + "\n...TRUNCATED_FOR_PROMPT";
}

function evidenceTotal(source) {
  const counts = source && source.counts ? source.counts : {};
  return Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function newSignalTotal(source) {
  const counts = source && source.newSinceSummary ? source.newSinceSummary : {};
  return [
    "chat_turns",
    "action_log",
    "events",
    "memories",
    "exercise_feedback",
    "workout_sessions",
    "workout_sets",
    "body_metrics",
    "recovery_logs",
    "nutrition_logs",
    "hydration_logs",
  ].reduce((sum, key) => sum + (Number(counts[key]) || 0), 0);
}

function summaryAgeMs(source) {
  const generatedAt = source && source.latestSummary && source.latestSummary.generatedAt;
  const t = generatedAt ? new Date(generatedAt).getTime() : NaN;
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

function shouldRefresh(source, force) {
  if (!source || !source.loaded) return { should: false, reason: "source_unavailable" };
  const total = evidenceTotal(source);
  if (total < 2) return { should: false, reason: "waiting_for_more_evidence" };
  if (force) return { should: true, reason: "forced" };
  if (!source.latestSummary) return { should: true, reason: "first_profile" };

  const fresh = newSignalTotal(source);
  const feedback = Number((source.newSinceSummary || {}).exercise_feedback || 0);
  const sessions = Number((source.newSinceSummary || {}).workout_sessions || 0);
  const recovery = Number((source.newSinceSummary || {}).recovery_logs || 0);
  const metrics = Number((source.newSinceSummary || {}).body_metrics || 0);
  if (feedback > 0 || sessions > 0) return { should: true, reason: "training_update" };
  if (recovery + metrics >= 2) return { should: true, reason: "recovery_metrics_update" };
  if (fresh >= 4) return { should: true, reason: "enough_new_signals" };
  if (fresh > 0 && summaryAgeMs(source) > 24 * 60 * 60 * 1000) return { should: true, reason: "daily_rollup" };
  return { should: false, reason: "profile_current" };
}

function normalizeProfile(raw, source, model, reason) {
  const parsed = parseJsonObject(raw) || {};
  const summary = asText(parsed.summary, 1400)
    || asText(parsed.trainer_summary, 1400)
    || "The trainer has started collecting durable data, but needs more completed sessions and feedback before strong patterns are reliable.";
  const data = {
    version: 1,
    model,
    reason,
    insufficientData: !!(parsed.insufficient_data || parsed.insufficientData),
    confidence: clampConfidence(parsed.confidence),
    standingFacts: asList(parsed.standing_facts || parsed.standingFacts, 10),
    goalProgress: asList(parsed.goal_progress || parsed.goalProgress, 8),
    trainingPatterns: asList(parsed.training_patterns || parsed.trainingPatterns, 10),
    exerciseRules: asList(parsed.exercise_rules || parsed.exerciseRules, 12),
    progressionRules: asList(parsed.progression_rules || parsed.progressionRules, 10),
    recoveryRules: asList(parsed.recovery_rules || parsed.recoveryRules, 10),
    nutritionHydrationPatterns: asList(parsed.nutrition_hydration_patterns || parsed.nutritionHydrationPatterns, 8),
    riskFlags: asList(parsed.risk_flags || parsed.riskFlags, 10),
    schedulingRules: asList(parsed.scheduling_rules || parsed.schedulingRules, 10),
    nextQuestions: asList(parsed.next_questions || parsed.nextQuestions, 6),
    evidenceCounts: source.counts || {},
    newSinceSummary: source.newSinceSummary || {},
    sourceStartAt: source.sourceStartAt || null,
    sourceEndAt: source.sourceEndAt || null,
  };
  return { summary, data };
}

function buildSummaryPrompt(source) {
  const payload = {
    athlete: source.athlete,
    previousProfile: source.latestSummary,
    counts: source.counts,
    newSinceSummary: source.newSinceSummary,
    data: source.data,
  };
  return `
Build a compact personal-trainer memory profile from the durable app database.

The athlete wants training to adapt toward end-of-year performance goals while respecting recovery, travel, equipment, sleep, soreness, pain, nutrition, water, and completed/missed/partial training. Do not invent facts. Separate one-off noise from repeated patterns. Prefer rules that can improve future workout selection, load progression, substitutions, recovery decisions, and weekly rebalancing.

Return only JSON with these keys:
{
  "summary": "2-5 sentence plain-language trainer profile",
  "insufficient_data": false,
  "confidence": 0.0,
  "standing_facts": [],
  "goal_progress": [],
  "training_patterns": [],
  "exercise_rules": [],
  "progression_rules": [],
  "recovery_rules": [],
  "nutrition_hydration_patterns": [],
  "risk_flags": [],
  "scheduling_rules": [],
  "next_questions": []
}

Rules:
- Use "insufficient_data": true if there are too few durable signals for strong conclusions.
- Preserve useful exercise-specific rules, such as "if curls were too easy at 15 lb, try 20 lb next time" when supported by data.
- Preserve avoidance/substitution rules, such as pain, hated movements, travel, no-gym constraints, and low-time options.
- Keep the profile short enough to paste into every future trainer prompt.

SOURCE DATA:
${boundedJson(payload)}
`;
}

export async function refreshTrainerProfileSummary({ athleteKey, force = false, reason = "manual" } = {}) {
  if (!databaseConfigured()) {
    return { configured: false, aiConfigured: Boolean(process.env.OPENAI_API_KEY), refreshed: false, reason: "database_not_configured" };
  }
  const source = await loadTrainerProfileSource({ athleteKey });
  if (!source.loaded) {
    return { configured: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), refreshed: false, reason: "source_unavailable", error: source.error };
  }
  const decision = shouldRefresh(source, force);
  if (!decision.should) {
    return {
      configured: true,
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      refreshed: false,
      reason: decision.reason,
      latest: source.latestSummary,
      counts: source.counts,
      newSinceSummary: source.newSinceSummary,
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return {
      configured: true,
      aiConfigured: false,
      refreshed: false,
      reason: "openai_not_configured",
      latest: source.latestSummary,
      counts: source.counts,
      newSinceSummary: source.newSinceSummary,
    };
  }

  const model = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      instructions: "You maintain compact durable memory for a personal trainer app. Output valid JSON only.",
      input: [{ role: "user", content: buildSummaryPrompt(source) }],
      max_output_tokens: 1600,
      store: false,
    }),
  });
  const responseJson = await apiResponse.json().catch(() => ({}));
  if (!apiResponse.ok) {
    const detail = responseJson && responseJson.error && responseJson.error.message ? responseJson.error.message : `OpenAI ${apiResponse.status}`;
    return { configured: true, aiConfigured: true, refreshed: false, reason: "openai_error", error: detail };
  }

  const normalized = normalizeProfile(extractResponseText(responseJson), source, model, decision.reason || reason);
  const saved = await saveTrainerProfileSummary({
    athleteKey,
    summary: normalized.summary,
    data: normalized.data,
    sourceStartAt: source.sourceStartAt,
    sourceEndAt: source.sourceEndAt,
  });
  if (!saved.saved) {
    return { configured: true, aiConfigured: true, refreshed: false, reason: "save_failed", error: saved.error };
  }
  return {
    configured: true,
    aiConfigured: true,
    refreshed: true,
    reason: decision.reason || reason,
    latest: saved.profile,
    counts: source.counts,
    newSinceSummary: source.newSinceSummary,
  };
}

export function scheduleTrainerProfileRefresh({ athleteKey, reason = "trainer_turn", delayMs = 250 } = {}) {
  if (process.env.TRAINER_AUTO_SUMMARY === "false") return { scheduled: false, reason: "disabled" };
  if (!databaseConfigured()) return { scheduled: false, reason: "database_not_configured" };
  if (!process.env.OPENAI_API_KEY) return { scheduled: false, reason: "openai_not_configured" };
  const key = String(athleteKey || process.env.TRAINER_ATHLETE_KEY || "local-demo").slice(0, 120);
  if (inflight.has(key)) return { scheduled: false, reason: "already_running" };
  inflight.set(key, true);
  setTimeout(async () => {
    try {
      await refreshTrainerProfileSummary({ athleteKey: key, force: false, reason });
    } catch (error) {
      console.error("trainer profile refresh failed", error);
    } finally {
      inflight.delete(key);
    }
  }, delayMs);
  return { scheduled: true };
}

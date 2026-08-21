import { databaseConfigured, loadTrainerContext, persistTrainerTurn } from "./_db.js";
import { validateTrainerActions } from "./_actions.js";
import { scheduleTrainerProfileRefresh } from "./_profile.js";

const MAX_SYSTEM_CHARS = 32000;
const MAX_MESSAGE_CHARS = 6000;
const MAX_HISTORY = 12;

function safeMessages(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-MAX_HISTORY)
    .map((m) => ({
      role: m && m.role === "assistant" ? "assistant" : "user",
      content: String((m && m.content) || "").slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim());
}

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

function normalizeTrainerTurn(text) {
  const raw = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  let parsed = null;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { parsed = JSON.parse(raw.slice(first, last + 1)); } catch (_) { /* handled below */ }
  }
  if (!parsed || typeof parsed !== "object") {
    return { reply: raw.slice(0, 1400) || "I couldn't interpret that cleanly. Say it one more time and I won't log anything until I understand it.", actions: [] };
  }
  return {
    reply: typeof parsed.reply === "string" ? parsed.reply.slice(0, 1800) : "",
    actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [],
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(body.today || "")) ? String(body.today) : new Date().toISOString().slice(0, 10);
  const athleteKey = String(body.athleteKey || process.env.TRAINER_ATHLETE_KEY || "local-demo").slice(0, 120);

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      configured: false,
      db: { configured: databaseConfigured(), loaded: false },
      text: JSON.stringify({
        reply: "The trainer brain is installed, but the server still needs its OPENAI_API_KEY environment variable. Nothing from this message was logged.",
        actions: [],
      }),
    });
  }

  const system = String(body.system || "").slice(0, MAX_SYSTEM_CHARS);
  const messages = safeMessages(body.messages);
  if (!messages.length) {
    return res.status(400).json({ error: "A user message is required" });
  }

  const alwaysOnContract = `
You are an always-available personal trainer, not an in-workout-only assistant. The athlete may message before training, during training, after training, on a rest day, or days later about something that happened earlier.

Treat conversation as an input surface, not as the database. When the athlete gives durable information, use the app's structured actions so the information survives the chat. Distinguish:
1) LOG ONLY — food, water, a historical observation, a normal recovery note, or context that does not change the plan.
2) UPDATE CURRENT STATE — active pain, soreness, fatigue, recovery, current performance, or a meaningful availability change.
3) REPLAN — only when the new information materially changes the next training decision. Do not rebuild the week because of every meal, glass of water, or passing comment.

Temporal language matters. "My knee hurt yesterday but feels fine now" is a historical event, not active pain. "My knee started hurting later after the run" should be recorded with that context. "I can't train tomorrow" is future availability. Never silently treat all statements as happening right now.

Use log_event for useful timeline facts that do not already have a more specific logging action. Use remember_fact only for stable preferences, repeated patterns, established tolerances, durable equipment constraints, or athlete facts worth carrying forward; do not turn one noisy workout into a permanent rule. Examples: likes sled work for leg power, main gym does not have tibialis raises, prefers sweaty cornerback-style circuits. Use log_set for a specific exercise set when the athlete reports weight/reps/RIR outside the formal workout completion flow.

If the athlete changes their long-term goals, use set_goal. Examples: "I don't care about dunking anymore" should become set_goal with key "vertical", target "paused", active false. "Bring vertical back" should become set_goal with key "vertical", target "active", active true. "Make the 5K the main goal" should become set_goal with key "fiveK", target "main priority", priority about 1.35. Numeric target changes should also use set_goal. Paused goals should stop driving future workout selection, although overlapping active goals may keep safe supporting work.

If the athlete changes the next few training-day intents without claiming they completed the workouts, use move_session. Examples: "today upper, tomorrow lower" should become two move_session actions. During combine/setup, use CAL_UP for upper baseline, CAL_LOW for lower calibration, and CAL_TRACK for track/run measure. During normal training, use A for upper press, C for pull/arms, B for lower, QR1/QR2 for quality runs, EASY for easy aerobic, and D for athletic microdose.

Training style matters. Every normal workout should feel like athletic cornerback preparation, not a generic bodybuilding split. A day may bias chest, pull-ups, lower force, speed, arms, running, or recovery, but the default training language is field-athlete work: sled pushes/drags, backward sled drags, battle ropes/rope flips, medicine-ball slams, rotational throws, scoop tosses, landmine or DB push press, walking lunge/slam patterns, trap-bar jumps, box jumps, lateral bounds, backpedal breaks, shuffle-to-sprint drills, reactive gear sprints, carries, rows, push-ups, strength and conditioning mixed intelligently. Knee-capacity options include reverse step-downs, ATG/KOT split squats, calf/tib alternatives, couch stretch pulses, pigeon push-ups and slant toe touches. Respect recovery and pain; use explosive-conditioning tools as goal-linked primers, finishers, or support blocks rather than a random extra workout style. Keep power work low-volume and high-quality.

Never invent completed training, food, sleep, pain severity, or measurements. If critical detail is genuinely missing, ask one short follow-up instead of guessing. If a message describes concerning medical symptoms, do not diagnose; prioritize safety and recommend appropriate evaluation when warranted.

Reply like a real trainer: conversational and concise. If you stored or changed something, say what you understood in normal language. Do not expose internal action names. Output only the JSON contract requested by the app.`;

  try {
    const dbContext = await loadTrainerContext({ athleteKey });
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        instructions: `${system}\n\n${alwaysOnContract}${dbContext.prompt ? "\n\n" + dbContext.prompt : ""}`,
        input: messages,
        max_output_tokens: 1400,
        store: false,
      }),
    });

    const data = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      const detail = data && data.error && data.error.message ? data.error.message : `OpenAI ${apiResponse.status}`;
      return res.status(502).json({ error: detail });
    }

    const turn = normalizeTrainerTurn(extractResponseText(data));
    const validation = validateTrainerActions(turn.actions);
    turn.actions = validation.actions;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const saved = await persistTrainerTurn({
      athleteKey,
      today,
      userText: lastUser ? lastUser.content : "",
      assistantReply: turn.reply,
      actions: turn.actions,
      model,
      dbContext: { loaded: !!dbContext.loaded, counts: dbContext.counts || null, error: dbContext.error || null },
    });
    if (saved.saved) scheduleTrainerProfileRefresh({ athleteKey, reason: "trainer_turn" });
    return res.status(200).json({
      configured: true,
      db: {
        configured: !!dbContext.configured,
        loaded: !!dbContext.loaded,
        saved: !!saved.saved,
        actionsSaved: saved.actionsSaved || 0,
        error: dbContext.error || saved.error || null,
      },
      validation: {
        rejectedActions: validation.rejected.length,
      },
      text: JSON.stringify(turn),
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Trainer service unavailable" });
  }
}

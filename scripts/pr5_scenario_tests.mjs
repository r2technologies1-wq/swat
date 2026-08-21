import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../CornerbackProject.jsx", import.meta.url), "utf8");
const end = source.lastIndexOf("/* ENGINE-END */");
if (end < 0) throw new Error("Could not find ENGINE-END marker");
const engineSource = source.slice(0, end).replace(/^import[\s\S]*?;\n/gm, "");

const sandbox = { console };
vm.runInNewContext(
  engineSource + `
function snapTier(mins) {
  if (mins >= 60) return 60;
  if (mins >= 40) return 40;
  if (mins >= 25) return 25;
  return 15;
}
globalThis.__pr5 = {
  EXERCISE_DEFAULTS, SESSIONS, effectiveList, mergeDayOverrides, resizeGoalOverrideForTier,
  planWeek, pr5DerivedBudget, pr5WeekDone, pr5EntryCredits, pr5ModuleRows,
  pr5ExerciseProgressionFromFeedback, normalizeGoalKey, pr5GoalActive, pr5GoalAuditRows,
  weekStartOf, addDays, applyFatigueRecord, localCoachTurn, pr5EffectiveWorkoutForDay,
  pr5LiveExtensionPatch, pr5LiveShortenPatch, snapTier
};`,
  sandbox,
);

const E = sandbox.__pr5;

function merge(a, b) {
  if (!b) return a;
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(out[k] || {}, v) : v;
  }
  return out;
}

function baseState(overrides = {}) {
  const exercises = {};
  Object.entries(E.EXERCISE_DEFAULTS).forEach(([id, def]) => {
    exercises[id] = { ...def, history: [] };
  });
  return merge({
    settings: {
      weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 0 },
      knee: "good",
      skillStage: 1,
    },
    fatigue: { areas: {}, systemic: null },
    calibration: {
      values: {
        bodyweight: "158",
        mile: "5:57",
        fiveK: "21:55",
        pullupMax: "13",
        pushupMax: "33",
        benchBaseline: "135 x 10",
        verticalJump: "",
      },
      savedAt: {},
    },
    metrics: { bodyweight: [], waist: [], pullupBest: [], pushupBest: [], mileBest: null, fiveKBest: null, muscleUp: false },
    exercises,
    goalOverrides: {},
    log: [],
    pins: {},
    ui: {},
  }, overrides);
}

function plan(today, state, log = []) {
  return E.planWeek({
    today,
    log,
    pins: state.pins || {},
    dayFlags: {},
    settings: state.settings,
    knee: state.settings.knee,
    fatigue: state.fatigue,
    state: { ...state, log },
  });
}

function todayPlan(p, today) {
  return p.days.find((d) => d.date === today);
}

function test(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (err) {
    console.error("FAIL", name);
    throw err;
  }
}

function ids(rows) {
  return JSON.parse(JSON.stringify(rows.map((r) => r[0])));
}

test("partial session banks only completed stimuli", () => {
  const state = baseState();
  const today = "2026-09-15";
  const budget = E.pr5DerivedBudget(state, today);
  const log = [{
    date: "2026-09-14",
    sessionId: "A",
    status: "partial",
    exercisesCompleted: ["benchA", "pullup"],
    exercisesSkipped: ["csRow", "hammer", "pressdown", "kneeRaise"],
    completionFraction: .25,
    sessionRpe: 7,
  }];
  const done = E.pr5WeekDone(log, E.weekStartOf(today), budget.rows);
  assert.equal(done.pressStrength, 1);
  assert.equal(done.verticalPull, 1);
  assert.equal(done.horizontalPull || 0, 0);
  assert.equal(done.arms || 0, 0);
  assert.equal(done.core || 0, 0);
  const p = plan(today, state, log);
  assert.match(p.message, /forecast/i);
});

test("missed day reflows without moving a named workout forward", () => {
  const state = baseState();
  const today = "2026-09-15";
  const log = [{ date: "2026-09-14", sessionId: "A", status: "skipped", reason: "Work" }];
  const d = todayPlan(plan(today, state, log), today);
  assert.notEqual(d.displayName, E.SESSIONS.A.name);
  assert.match(d.displayName || "", /Adaptive|Recovery|Quality|Easy|Core/i);
});

test("15-minute day creates a short priority session", () => {
  const state = baseState({ settings: { weekdayMinutes: { 0: 15, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 0 } } });
  const today = "2026-09-14";
  const d = todayPlan(plan(today, state), today);
  assert.equal(d.autoOverride && d.autoOverride.tier, 15);
  const resized = E.resizeGoalOverrideForTier(d.autoOverride, 15, state);
  const list = E.effectiveList(E.SESSIONS[d.id], 15, {}, E.mergeDayOverrides(resized, null));
  assert.ok(list.length > 0);
  assert.ok(list.length <= 3, "15-minute list should stay intentionally short");
});

test("combine window schedules core baselines without optional accessory sweeps", () => {
  const state = baseState({ settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } } });
  const p = plan("2026-08-20", state);
  const ids = p.days.filter((d) => d.status === "planned" && d.id).map((d) => d.id);
  assert.ok(ids.includes("CAL_UP"));
  assert.ok(ids.includes("CAL_LOW"));
  assert.ok(ids.includes("CAL_TRACK"));
  assert.ok(!ids.includes("CAL_ACCA"));
  assert.ok(!ids.includes("CAL_ACCC"));
});

test("upper fatigue blocks overlapping hard upper work", () => {
  const fatigue = { areas: {}, systemic: null };
  let f = E.applyFatigueRecord(fatigue, "chest", 3, "2026-09-14", "sore");
  f = E.applyFatigueRecord(f, "back", 3, "2026-09-14", "sore");
  f = E.applyFatigueRecord(f, "biceps", 2, "2026-09-14", "sore");
  const state = baseState({ fatigue: f });
  const d = todayPlan(plan("2026-09-15", state), "2026-09-15");
  assert.doesNotMatch(d.displayName || "", /Bench|Pull-up|Row|Explosive/i);
});

test("irritated knee gates high-impact vertical and aggressive running", () => {
  const state = baseState({ settings: { knee: "irritated", skillStage: 4 } });
  const p = plan("2026-09-14", state);
  p.days.forEach((d) => {
    assert.ok(!(d.autoOverride && (d.autoOverride.modules || []).includes("verticalPower")));
    assert.ok(d.id !== "QR1" && d.id !== "QR2");
  });
});

test("goal lag shifts emphasis away from ahead bench", () => {
  const state = baseState({
    settings: { skillStage: 3 },
    exercises: { benchA: { ...baseState().exercises.benchA, weight: 225, history: [{ date: "2026-10-01", w: 225, reps: "1" }] } },
    calibration: { values: { fiveK: "21:55", mile: "5:57", pullupMax: "15", verticalJump: "" } },
  });
  const b = E.pr5DerivedBudget(state, "2026-10-15");
  const row = (k) => b.rows.find((x) => x.key === k);
  assert.ok(row("pressStrength").target <= 1);
  assert.ok(row("qualityRun").target >= row("pressStrength").target || row("verticalPower").target >= row("pressStrength").target);
});

test("goals on track do not create maximum volume everywhere", () => {
  const state = baseState({
    settings: { skillStage: 4 },
    calibration: { values: { bodyweight: "165", mile: "5:25", fiveK: "19:30", pullupMax: "22", verticalJump: "34" } },
    metrics: { bodyweight: [{ date: "2026-11-01", v: 165 }], waist: [], pullupBest: [{ date: "2026-11-01", v: 22 }], mileBest: "5:25", fiveKBest: "19:30", muscleUp: true },
    exercises: { benchA: { ...baseState().exercises.benchA, weight: 225, history: [{ date: "2026-11-01", w: 225, reps: "1" }] } },
  });
  const b = E.pr5DerivedBudget(state, "2026-11-09");
  const hardTargets = b.rows.filter((r) => ["pressStrength", "verticalPull", "horizontalPull", "lowerStrength", "qualityRun", "explosivePull"].includes(r.key)).reduce((sum, r) => sum + r.target, 0);
  assert.ok(hardTargets <= 5, "on-track goals should not max out every hard stimulus");
});

test("paused goals stop driving the forecast", () => {
  const state = baseState({
    settings: { skillStage: 4 },
    goalOverrides: {
      vertical: { active: false, label: "Paused", reason: "not training dunk right now" },
      speed: { active: false, label: "Paused", reason: "not training speed right now" },
    },
  });
  assert.equal(E.pr5GoalActive(state, "dunk"), false);
  const budget = E.pr5DerivedBudget(state, "2026-10-15");
  assert.ok(!budget.focus.some((g) => g.key === "vertical" || g.key === "speed"));
  const verticalRow = budget.rows.find((r) => r.key === "verticalPower");
  assert.ok(!verticalRow || verticalRow.target === 0);
  const p = plan("2026-10-15", state);
  assert.ok(!p.days.some((d) => (d.autoOverride && (d.autoOverride.modules || []).includes("verticalPower")) || (d.goalKeys || []).includes("vertical")));
  const audit = E.pr5GoalAuditRows(state, p, "2026-10-15");
  assert.equal(audit.find((r) => r.key === "vertical").active, false);
});

test("push-up goal is first-class planner data", () => {
  const state = baseState({ metrics: { pushupBest: [{ date: "2026-08-20", v: 33 }] } });
  const rows = E.pr5GoalAuditRows(state, plan("2026-09-15", state), "2026-09-15");
  assert.equal(E.normalizeGoalKey("100 pushups"), "pushup");
  assert.ok(rows.some((r) => r.key === "pushup"), "expected push-up goal in audit rows");
});

test("local coach can pause or prioritize long-term goals", () => {
  const state = baseState();
  const p = plan("2026-09-15", state);
  assert.equal(E.normalizeGoalKey("fiveK"), "fiveK");
  let r = E.localCoachTurn(state, p, "2026-09-15", "i dont care about dunking anymore");
  assert.ok(r.actions.some((a) => a.type === "set_goal" && a.key === "vertical" && a.active === false));
  r = E.localCoachTurn(state, p, "2026-09-15", "make 5K the main goal");
  assert.ok(r.actions.some((a) => a.type === "set_goal" && a.key === "fiveK" && a.priority === 1.35));
});

test("local coach can pin combine upper today and lower tomorrow", () => {
  const state = baseState({ settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } } });
  const p = plan("2026-08-20", state);
  const r = E.localCoachTurn(state, p, "2026-08-20", "today i will do upper body and tomorrow lower body");
  assert.ok(r.actions.some((a) => a.type === "move_session" && a.slot === "CAL_UP" && a.to_date === "2026-08-20"));
  assert.ok(r.actions.some((a) => a.type === "move_session" && a.slot === "CAL_LOW" && a.to_date === "2026-08-21"));

  const pinned = baseState({
    settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } },
    pins: { "2026-08-20": "CAL_UP", "2026-08-21": "CAL_LOW" },
  });
  const pinnedPlan = plan("2026-08-20", pinned);
  assert.equal(todayPlan(pinnedPlan, "2026-08-20").id, "CAL_UP");
  assert.equal(todayPlan(pinnedPlan, "2026-08-21").id, "CAL_LOW");
});

test("completed combine unlocks goal-driven training before September", () => {
  const state = baseState({
    settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } },
    pins: { "2026-08-21": "CAL_LOW" },
    ui: { combineComplete: true },
  });
  const p = plan("2026-08-20", state);
  assert.equal(p.calMode, false);
  assert.equal(todayPlan(p, "2026-08-21").id, "B");
  assert.ok(todayPlan(p, "2026-08-21").autoOverride, "pinned lower intent should still be rebuilt as a coached modular training day");
});

test("pinned upper and lower intents become coached modular training after combine", () => {
  const state = baseState({
    settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } },
    pins: { "2026-08-20": "CAL_UP", "2026-08-21": "CAL_LOW" },
    ui: { combineComplete: true },
  });
  const p = plan("2026-08-20", state);
  const upper = todayPlan(p, "2026-08-20");
  const lower = todayPlan(p, "2026-08-21");
  assert.match(upper.displayName, /Coached Training/);
  assert.ok((upper.autoOverride.modules || []).includes("fieldConditioning"));
  assert.ok((upper.autoOverride.modules || []).includes("pressStrength"));
  assert.ok((upper.autoOverride.modules || []).includes("verticalPower"), "upper coached day should be allowed a tiny lower-power/jump touch when safe");
  assert.match(lower.displayName, /Coached Training/);
  assert.ok((lower.autoOverride.modules || []).includes("lowerStrength"));
  assert.ok((lower.autoOverride.add || []).some((x) => ["sledPush", "battleRope", "ballSlam", "medBallMtClimber"].includes(x.id)));
});

test("isolated lower coached day can include a tiny upper-back touch when safe", () => {
  const state = baseState({
    settings: { weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 60 } },
    pins: { "2026-08-20": "CAL_LOW" },
    ui: { combineComplete: true },
  });
  const p = plan("2026-08-20", state);
  const lower = todayPlan(p, "2026-08-20");
  assert.match(lower.displayName, /Coached Training/);
  assert.ok((lower.autoOverride.modules || []).includes("lowerStrength"));
  assert.ok((lower.autoOverride.modules || []).includes("horizontalPull"));
});

test("large time window can combine compatible modules", () => {
  const state = baseState({ settings: { weekdayMinutes: { 0: 75, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 0 }, skillStage: 3 } });
  const p = plan("2026-09-14", state);
  assert.ok(p.days.some((d) => d.autoOverride && (d.autoOverride.modules || []).length >= 2));
  assert.ok(p.days.some((d) => d.autoOverride && (d.autoOverride.modules || []).includes("fieldConditioning")), "large weeks should surface athletic field-conditioning work when speed/vertical goals need it");
});

test("sub-15-minute availability becomes a goal-linked micro-dose", () => {
  const state = baseState({ settings: { weekdayMinutes: { 0: 6, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 0 } } });
  const p = plan("2026-09-14", state);
  const d = todayPlan(p, "2026-09-14");
  assert.ok(d.id === "MICRO" || d.id === "MICRORUN");
  assert.equal(d.availableMinutes, 6);
  assert.ok(d.autoOverride && d.autoOverride.add && d.autoOverride.add.length > 0);
  assert.ok(d.goalKeys && d.goalKeys.length > 0);
  const k = d.autoOverride.modules[0];
  assert.ok(p.projected[k] >= .5);
  assert.match(d.reasons.join(" "), /partial credit/i);
});

test("vertical progression evolves by knee stage", () => {
  assert.deepEqual(ids(E.pr5ModuleRows("verticalPower", 60, 1)), ["calfRaise", "tibRaise", "bandWalk"]);
  assert.deepEqual(ids(E.pr5ModuleRows("verticalPower", 60, 2)), ["snapDown", "lowPogo"]);
  assert.ok(E.pr5ModuleRows("verticalPower", 60, 3).some((r) => r[0] === "broadJumpDrill"));
  assert.ok(E.pr5ModuleRows("verticalPower", 60, 4).some((r) => r[0] === "jumpReach"));
});

test("adaptive module prescriptions vary and respect exercise avoidance", () => {
  const state = baseState();
  const seen = new Set();
  for (let i = 0; i < 12; i += 1) {
    seen.add(ids(E.pr5ModuleRows("pressStrength", 60, 1, state, E.addDays("2026-09-14", i))).join(","));
  }
  assert.ok(seen.size > 1, "press strength should be a menu, not one static prescription");

  const avoidBench = baseState({
    trainerMemory: { facts: [{ key: "avoid_benchA", text: "Avoid Barbell bench press when possible", date: "2026-09-14" }] },
  });
  const rows = ids(E.pr5ModuleRows("pressStrength", 60, 1, avoidBench, "2026-09-14"));
  assert.ok(!rows.includes("benchA"), "avoidance memory should remove benchA when another useful prescription exists");
  assert.ok(rows.length > 0);
});

test("field conditioning module uses coach-style athletic circuits", () => {
  const state = baseState({
    trainerMemory: { facts: [{ key: "coach_style", text: "Prefers sleds, battle ropes, med-ball slams and cornerback conditioning circuits", date: "2026-08-20" }] },
  });
  const rows = ids(E.pr5ModuleRows("fieldConditioning", 40, 3, state, "2026-09-16"));
  assert.ok(rows.some((id) => ["battleRope", "ballSlam", "sledPush", "landminePress", "walkingLungeSlam", "trapBarJump", "boxJump"].includes(id)));
});

test("equipment memory removes unavailable tibialis raises", () => {
  const state = baseState({
    trainerMemory: { facts: [{ key: "no_tibialis_machine", text: "Main gym does not have tibialis raise setup", date: "2026-08-20" }] },
  });
  for (let i = 0; i < 10; i += 1) {
    const rows = ids(E.pr5ModuleRows("verticalPower", 60, 1, state, E.addDays("2026-09-14", i)));
    assert.ok(!rows.includes("tibRaise"), "tibialis raise should be removed when main gym lacks the setup");
    assert.ok(rows.length > 0, "verticalPower should still have a useful alternative");
  }
});

test("exercise feedback progresses known and newly learned accessory loads", () => {
  let ex = { ...E.EXERCISE_DEFAULTS.hammer, weight: 15, history: [] };
  let prog = E.pr5ExerciseProgressionFromFeedback("hammer", ex, "too_easy", null);
  assert.equal(prog.nextWeight, 20);
  assert.equal(prog.changed, true);

  ex = { ...E.EXERCISE_DEFAULTS.hammer, weight: null, history: [] };
  prog = E.pr5ExerciseProgressionFromFeedback("hammer", ex, "too_easy", 15);
  assert.equal(prog.loggedWeight, 15);
  assert.equal(prog.nextWeight, 20);
  assert.equal(prog.changed, true);

  ex = { ...E.EXERCISE_DEFAULTS.benchA, weight: 135, history: [] };
  prog = E.pr5ExerciseProgressionFromFeedback("benchA", ex, "too_easy", 135);
  assert.equal(prog.nextWeight, 135, "bench should still use rep-based progression evidence");
  assert.equal(prog.changed, false);
});

test("effective list can remove exercises that were auto-added by the planner", () => {
  const state = baseState();
  const today = "2026-09-15";
  const p = plan(today, state);
  const d = p.days.find((x) => x.autoOverride && x.autoOverride.add && x.autoOverride.add.length > 0);
  assert.ok(d, "expected a goal-derived day with auto-added rows");
  const id = d.autoOverride.add[0].id;
  const override = E.mergeDayOverrides(d.autoOverride, { remove: [id], reason: "test removal" });
  const rows = E.effectiveList(E.SESSIONS[d.id], override.tier, state.sessionMods, override) || [];
  assert.ok(!ids(rows).includes(id), "removed auto-added row should not leak back into today's workout");
});

test("live workout patches add useful work or cut lower-priority rows", () => {
  const state = baseState();
  const today = "2026-09-15";
  const p = plan(today, state);
  const extendDay = p.days.find((d) => d.status === "planned" && d.id && d.id !== "REC");
  assert.ok(extendDay, "expected a planned training day");
  const extend = E.pr5LiveExtensionPatch(state, p, extendDay.date, 8);
  assert.ok(extend && extend.add && extend.add.length > 0, "extra time should create a safe add-on");
  assert.equal(extend.liveIntent, "extend");

  const shortenDay = p.days.find((d) => {
    const current = E.pr5EffectiveWorkoutForDay(state, d);
    return current && current.rows.length > 2;
  });
  assert.ok(shortenDay, "expected a multi-row session to shorten");
  const shorten = E.pr5LiveShortenPatch(state, p, shortenDay.date, 8);
  assert.ok(shorten && shorten.remove && shorten.remove.length > 0, "shortening should remove lower-priority rows");
  assert.equal(shorten.liveIntent, "shorten");
});

test("three hard days trigger recovery", () => {
  const state = baseState();
  const log = [
    { date: "2026-09-14", sessionId: "A", status: "completed", sessionRpe: 8, exercisesCompleted: ["benchA", "pullup", "csRow"] },
    { date: "2026-09-15", sessionId: "QR1", status: "completed", sessionRpe: 8, completionFraction: 1 },
    { date: "2026-09-16", sessionId: "B", status: "completed", sessionRpe: 8, exercisesCompleted: ["rdl", "hipThrust"] },
  ];
  const d = todayPlan(plan("2026-09-17", state, log), "2026-09-17");
  assert.equal(d.id, "REC");
});

test("local coach fallback extracts common trainer messages", () => {
  const state = baseState();
  const p = plan("2026-09-15", state);
  let r = E.localCoachTurn(state, p, "2026-09-15", "159.2 this morning");
  assert.ok(r.actions.some((a) => a.type === "log_metric" && a.kind === "bodyweight" && a.value === "159.2"));
  r = E.localCoachTurn(state, p, "2026-09-15", "My knee started hurting later");
  assert.ok(r.actions.some((a) => a.type === "set_knee" && a.status === "irritated"));
  assert.ok(r.actions.some((a) => a.type === "log_event" && a.body_area === "knee"));
  r = E.localCoachTurn(state, p, "2026-09-15", "only did bench + pullups - 15 minutes");
  assert.ok(r.actions.some((a) => a.type === "log_partial_session" && a.duration === 15 && a.exercises_completed.includes("bench") && a.exercises_completed.includes("pullup")));
  r = E.localCoachTurn(state, p, "2026-09-15", "Had chicken, rice + a shake");
  assert.ok(r.actions.some((a) => a.type === "log_food"));
  r = E.localCoachTurn(state, p, "2026-09-15", "30 lb curls were way too easy");
  assert.ok(r.actions.some((a) => a.type === "exercise_feedback" && a.name === "curl" && a.difficulty === "too_easy" && a.actual_weight === 30));
  r = E.localCoachTurn(state, p, "2026-09-15", "I hate lateral raises");
  assert.ok(r.actions.some((a) => a.type === "remember_fact" && a.key === "avoid_latRaise"));
  assert.ok(r.actions.some((a) => a.type === "remove_exercise" && a.name === "latRaise"));
  r = E.localCoachTurn(state, p, "2026-09-15", "traveling tomorrow, hotel only, 6 minutes");
  assert.ok(r.actions.some((a) => a.type === "set_day_constraints" && a.date === "2026-09-16" && a.travel && a.no_gym));
  assert.ok(r.actions.some((a) => a.type === "set_day_time" && a.date === "2026-09-16" && a.minutes === 6));
  r = E.localCoachTurn(state, p, "2026-09-15", "hey I have a few more minutes to spare what else can we do");
  assert.ok(r.actions.some((a) => a.type === "extend_today_session" && a.date === "2026-09-15"));
  assert.ok(!r.actions.some((a) => a.type === "set_day_time"));
  r = E.localCoachTurn(state, p, "2026-09-15", "I need to leave please remove the rest");
  assert.ok(r.actions.some((a) => a.type === "shorten_today_session" && a.date === "2026-09-15"));
  assert.ok(!r.actions.some((a) => a.type === "set_day_time"));
  r = E.localCoachTurn(state, p, "2026-09-15", "i cant do pull ups for the combine today can you make it tomorrow?");
  const defer = r.actions.find((a) => a.type === "defer_exercises");
  assert.ok(defer);
  assert.equal(defer.from_date, "2026-09-15");
  assert.equal(defer.to_date, "2026-09-16");
  assert.deepEqual([...defer.exercises].sort(), ["exPull", "pullup"]);
  assert.match(r.reply, /moved/i);
});

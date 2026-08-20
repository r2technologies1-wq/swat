from pathlib import Path

p = Path('CornerbackProject.jsx')
s = p.read_text()

MARK = '/* PR5_GOAL_DRIVEN_SCHEDULER */'
if MARK in s:
    print('PR5 goal-driven scheduler already applied')
    raise SystemExit(0)

changes = 0

def once(old, new, label):
    global s, changes
    if old not in s:
        raise RuntimeError(f'PR5 patch marker missing: {label}')
    s = s.replace(old, new, 1)
    changes += 1

# Add a small, stage-gated jump-development exercise library. These are
# modules, not a fixed "jump day".
once(
'''  abWheel:   { name: "Ab wheel / dead bug",            weight: 0,    inc: 0,  unit: "bw", cal: false, bw: true, group: "D" },
  easyAerobic20:''',
'''  abWheel:   { name: "Ab wheel / dead bug",            weight: 0,    inc: 0,  unit: "bw", cal: false, bw: true, group: "D" },
  snapDown:  { name: "Snap-down to athletic stance",    weight: 0,    inc: 0,  unit: "bw", cal: false, bw: true, group: "D" },
  lowPogo:   { name: "Low pogo contacts",               weight: 0,    inc: 0,  unit: "bw", cal: false, bw: true, group: "D" },
  broadJumpDrill: { name: "Broad jump + stick",          weight: 0,    inc: 0,  unit: "bw", cal: false, bw: true, group: "D" },
  jumpReach: { name: "Vertical jump / max-reach practice", weight: 0, inc: 0, unit: "bw", cal: false, bw: true, group: "D" },
  easyAerobic20:''',
'jump exercise library')

# Add vertical/dunk as an explicit Dec-31 outcome and a baseline field.
once(
'''  { key: "speed",  label: "Speed / agility", start: "Baseline TBD", target: "Meaningful gain, knee intact", unit: "note" },
];''',
'''  { key: "speed",  label: "Speed / agility", start: "Baseline TBD", target: "Meaningful gain, knee intact", unit: "note" },
  { key: "vertical", label: "Vertical / dunk", start: "Baseline TBD", target: "Meaningful vertical gain + progress toward dunking", unit: "note" },
];''',
'vertical goal')

once(
'''  { key: "broadJump",    label: "Broad jump (only if pain-free)", unit: "in", seed: "" },
];''',
'''  { key: "broadJump",    label: "Broad jump (only if pain-free)", unit: "in", seed: "" },
  { key: "verticalJump",  label: "Vertical jump / max-touch baseline (when knee has earned it)", unit: "in / landmark", seed: "" },
];''',
'vertical baseline')

# Preserve the existing scheduler for Combine/preseason. PR5 takes over
# normal Sep-Dec planning only.
once('function planWeek(ctx) {', 'function legacyPlanWeek(ctx) {', 'rename legacy planner')

insert_marker = '/* ===================== 5. PROGRESSION ENGINE (pure JS) ==================== */'
if insert_marker not in s:
    raise RuntimeError('PR5 patch marker missing: progression engine')

js = r'''
/* PR5_GOAL_DRIVEN_SCHEDULER */
/*
  The Dec-31 outcomes are the objective. Weekly exposure targets are a derived
  prescription, recalculated from goal progress, time remaining, actual work,
  recovery and availability. A/B/C remain useful exercise templates/carriers;
  they are not weekday identities.
*/

const PR5_STIMULI = {
  pressStrength:   { label: "Press strength", family: "upper", min: 1, max: 2 },
  verticalPull:    { label: "Vertical pull", family: "upper", min: 1, max: 2 },
  horizontalPull:  { label: "Horizontal pull", family: "upper", min: 1, max: 2 },
  lowerStrength:   { label: "Lower force", family: "lower", min: 1, max: 2 },
  qualityRun:      { label: "Quality running", family: "runHard", min: 1, max: 2 },
  easyAerobic:     { label: "Easy aerobic", family: "easy", min: 1, max: 2 },
  explosivePull:   { label: "Explosive pull / MU", family: "upper", min: 1, max: 2 },
  verticalPower:   { label: "Jump / vertical development", family: "lower", min: 0, max: 2 },
  arms:            { label: "Direct arms", family: "accessory", min: 0, max: 2, optional: true },
  core:            { label: "Core / trunk", family: "accessory", min: 1, max: 3 },
  recovery:        { label: "Low-stress recovery", family: "recovery", min: 1, max: 1 },
};

const PR5_GOAL_MAP = {
  bench:    { pressStrength: 1.55, horizontalPull: .25, core: .15 },
  mile:     { qualityRun: 1.15, easyAerobic: .55, lowerStrength: .25, verticalPower: .30 },
  fiveK:    { qualityRun: 1.20, easyAerobic: .85, lowerStrength: .20 },
  pullup:   { verticalPull: 1.35, horizontalPull: .25, core: .10 },
  mu:       { explosivePull: 1.45, verticalPull: .65, core: .15 },
  bw:       { pressStrength: .20, verticalPull: .20, horizontalPull: .20, lowerStrength: .20, arms: .20 },
  abs:      { core: .90, easyAerobic: .20, pressStrength: .10, verticalPull: .10 },
  speed:    { verticalPower: 1.00, lowerStrength: .50, qualityRun: .45, core: .15 },
  vertical: { verticalPower: 1.55, lowerStrength: .65, core: .20 },
};

const PR5_EXERCISE_STIMULI = {
  benchA: ["pressStrength"], benchC: ["pressStrength"], inclineDb: ["pressStrength"], ohp: ["pressStrength"], pushup: ["pressStrength"],
  pullup: ["verticalPull"], pulldown: ["verticalPull"],
  csRow: ["horizontalPull"], cableRow1: ["horizontalPull"], facePull: ["horizontalPull"],
  exPull: ["explosivePull", "verticalPull"], muTrans: ["explosivePull"],
  rdl: ["lowerStrength"], hipThrust: ["lowerStrength"], hamCurl: ["lowerStrength"], stepUp: ["lowerStrength"], ssRdl: ["lowerStrength"],
  snapDown: ["verticalPower"], lowPogo: ["verticalPower"], broadJumpDrill: ["verticalPower"], jumpReach: ["verticalPower"],
  hammer: ["arms"], incCurl: ["arms"], pressdown: ["arms"], ohTri: ["arms"],
  kneeRaise: ["core"], pallof: ["core"], abWheel: ["core"], farmer: ["core"],
};

const PR5_EXERCISE_AREAS = {
  benchA:["chest","shoulders","triceps"], benchC:["chest","shoulders","triceps"], inclineDb:["chest","shoulders","triceps"], ohp:["shoulders","triceps"], pushup:["chest","triceps"],
  pullup:["back","biceps"], pulldown:["back","biceps"], csRow:["back","biceps"], cableRow1:["back","biceps"], facePull:["back","shoulders"], exPull:["back","biceps"], muTrans:["back","biceps"],
  rdl:["hamstrings","glutes"], hipThrust:["glutes","hamstrings"], hamCurl:["hamstrings"], stepUp:["quads","glutes"], ssRdl:["hamstrings","glutes"],
  snapDown:["quads","glutes","calves"], lowPogo:["calves"], broadJumpDrill:["quads","glutes","hamstrings","calves"], jumpReach:["quads","glutes","calves"],
  hammer:["biceps"], incCurl:["biceps"], pressdown:["triceps"], ohTri:["triceps"], kneeRaise:["core"], pallof:["core"], abWheel:["core"],
};

function pr5Clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pr5FirstNumber(v) {
  if (v == null) return null;
  const m = String(v).match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function pr5EstimatedBench1RM(state) {
  const ex = state.exercises && state.exercises.benchA;
  let best = 0;
  ((ex && ex.history) || []).forEach((h) => {
    const w = Number(h.w || 0);
    let reps = Number(h.reps);
    if (!Number.isFinite(reps)) reps = pr5FirstNumber(h.reps);
    if (w > 0) best = Math.max(best, reps > 0 ? w * (1 + reps / 30) : w);
  });
  const cal = state.calibration && state.calibration.values ? state.calibration.values.benchBaseline : null;
  if (cal) {
    const nums = String(cal).match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length) {
      const w = Number(nums[0]), reps = nums.length > 1 ? Number(nums[1]) : 5;
      if (w > 0) best = Math.max(best, w * (1 + reps / 30));
    }
  }
  if (ex && ex.weight) best = Math.max(best, Number(ex.weight));
  return best || null;
}
function pr5GoalProgress(state, key) {
  const cal = (state.calibration && state.calibration.values) || {};
  const met = state.metrics || {};
  const ov = state.goalOverrides || {};
  if (key === "bench") {
    const cur = pr5EstimatedBench1RM(state); const target = (ov.bench && ov.bench.targetVal) || 225;
    const start = 180; return cur == null ? .05 : pr5Clamp((cur - start) / Math.max(1, target - start), 0, 1);
  }
  if (key === "mile") {
    const cur = mmssToSec(met.mileBest || cal.mile || "5:57"); const target = (ov.mile && ov.mile.targetSec) || 330;
    return cur == null ? 0 : pr5Clamp((357 - cur) / Math.max(1, 357 - target), 0, 1);
  }
  if (key === "fiveK") {
    const cur = mmssToSec(met.fiveKBest || cal.fiveK || "21:55"); const target = (ov.fiveK && ov.fiveK.targetSec) || 1200;
    return cur == null ? 0 : pr5Clamp((1315 - cur) / Math.max(1, 1315 - target), 0, 1);
  }
  if (key === "pullup") {
    const arr = met.pullupBest || []; const cur = arr.length ? Number(arr[arr.length - 1].v) : Number(cal.pullupMax || 15); const target = (ov.pullup && ov.pullup.targetVal) || 20;
    return pr5Clamp((cur - 15) / Math.max(1, target - 15), 0, 1);
  }
  if (key === "mu") return met.muscleUp ? 1 : 0;
  if (key === "bw") {
    const arr = met.bodyweight || []; const cur = arr.length ? Number(arr[arr.length - 1].v) : Number(cal.bodyweight || 158); const target = (ov.bw && ov.bw.targetVal) || 163;
    return pr5Clamp((cur - 158) / Math.max(1, target - 158), 0, 1);
  }
  if (key === "vertical") {
    const v = pr5FirstNumber(cal.verticalJump); return v == null ? 0 : .15;
  }
  return 0;
}
function pr5GoalUrgencies(state, today) {
  const blockStart = SEP_START, blockEnd = "2026-12-31";
  const timeProgress = pr5Clamp(daysBetween(blockStart, today) / Math.max(1, daysBetween(blockStart, blockEnd)), 0, 1);
  const performanceKeys = new Set(["bench","mile","fiveK","pullup","mu","speed","vertical"]);
  return GOALS.map((g) => {
    const progress = pr5GoalProgress(state, g.key);
    const base = performanceKeys.has(g.key) ? 1 : .72;
    const unknownBoost = (g.key === "speed" || g.key === "vertical") && progress === 0 ? .16 : 0;
    const lag = Math.max(0, timeProgress - progress);
    return { key: g.key, label: g.label, progress, urgency: base * (1 + 1.35 * lag + unknownBoost) };
  }).sort((a,b) => b.urgency - a.urgency);
}
function pr5DerivedBudget(state, today) {
  const urgencies = pr5GoalUrgencies(state, today);
  const scores = {};
  Object.keys(PR5_STIMULI).forEach((k) => { scores[k] = 0; });
  urgencies.forEach((g) => {
    const map = PR5_GOAL_MAP[g.key] || {};
    Object.entries(map).forEach(([k,w]) => { scores[k] = (scores[k] || 0) + g.urgency * Number(w); });
  });
  const maxScore = Math.max(.001, ...Object.keys(scores).filter((k) => k !== "recovery").map((k) => scores[k] || 0));
  const rel = (k) => (scores[k] || 0) / maxScore;
  const stage = cbStageFor(state.settings.knee, state.settings.skillStage);
  const rows = [];
  const add = (key, min, target, optional, reason) => rows.push({ key, label: PR5_STIMULI[key].label, min, target, optional: !!optional, score: scores[key] || 0, reason });
  add("pressStrength", 1, 1 + (rel("pressStrength") >= .60 ? 1 : 0), false, "Bench goal + balanced upper-body strength");
  add("verticalPull", 1, 1 + (rel("verticalPull") >= .55 ? 1 : 0), false, "Pull-up and muscle-up outcomes");
  add("horizontalPull", 1, 1 + (rel("horizontalPull") >= .48 ? 1 : 0), false, "Upper balance, scapular strength and pressing support");
  add("lowerStrength", 1, 1 + (rel("lowerStrength") >= .72 ? 1 : 0), false, "Speed / vertical force base without junk volume");
  add("qualityRun", state.settings.knee === "irritated" ? 0 : 1, state.settings.knee === "irritated" ? 1 : 1 + (rel("qualityRun") >= .58 ? 1 : 0), false, "Mile + 5K progress; low-impact substitute when knee is flagged");
  add("easyAerobic", 1, 1 + (rel("easyAerobic") >= .78 ? 1 : 0), false, "Aerobic base and recovery capacity");
  add("explosivePull", 1, 1 + (rel("explosivePull") >= .58 ? 1 : 0), false, "Muscle-up skill and pulling power");
  const jumpTarget = state.settings.knee === "irritated" ? 0 : (stage >= 3 ? 1 + (rel("verticalPower") >= .64 ? 1 : 0) : 1);
  add("verticalPower", state.settings.knee === "irritated" ? 0 : 1, jumpTarget, state.settings.knee === "irritated", stage >= 3 ? "Vertical/dunk development — power stage earned" : "Vertical/dunk foundation — landing/ankle capacity until power stage is earned");
  add("arms", 0, rel("arms") >= .45 ? 2 : 1, true, "Physique/support work; first thing dropped when time is tight");
  add("core", 1, rel("core") >= .60 ? 3 : 2, false, "Trunk stiffness for running, jumping and lifting");
  add("recovery", 1, 1, false, "Adaptation requires at least one deliberately low-stress day");
  const focus = urgencies.slice(0, 3);
  return { rows, scores, focus, stage };
}

function pr5CreditsFromExercises(ids) {
  const out = {};
  const set = new Set(ids || []);
  set.forEach((id) => (PR5_EXERCISE_STIMULI[id] || []).forEach((k) => { out[k] = 1; }));
  const foundation = ["calfRaise","tibRaise","bandWalk","stepUp"].filter((id) => set.has(id));
  if (foundation.length >= 2) out.verticalPower = Math.max(out.verticalPower || 0, 1);
  return out;
}
function pr5EntryCredits(entry) {
  const out = {};
  const slot = SLOT_OF[entry.sessionId];
  if (slot === "QR1" || slot === "QR2") {
    const f = entry.completionFraction == null ? (entry.status === "completed" ? 1 : 0) : Number(entry.completionFraction);
    if (f >= .6) out.qualityRun = 1; else if (f > 0) out.qualityRun = .5;
  }
  if (slot === "EASY") {
    const f = entry.completionFraction == null ? (entry.status === "completed" ? 1 : 0) : Number(entry.completionFraction);
    if (f >= .6 || Number(entry.duration || entry.runDuration || 0) >= 20) out.easyAerobic = 1;
    else if (f > 0) out.easyAerobic = .5;
  }
  if (Array.isArray(entry.exercisesCompleted)) Object.assign(out, pr5CreditsFromExercises(entry.exercisesCompleted));
  if (entry.status === "partial") return out;
  if (!entry.exercisesCompleted) {
    if (slot === "A") Object.assign(out, { pressStrength:1, verticalPull:1, horizontalPull:1, arms:1, core:1 });
    if (slot === "B") Object.assign(out, { lowerStrength:1, core:1 });
    if (slot === "C") Object.assign(out, { explosivePull:1, verticalPull:1, horizontalPull:1, arms:1 });
    if (slot === "D") Object.assign(out, { verticalPower:1, core:1 });
    if (slot === "REC") out.recovery = 1;
  }
  return out;
}
function pr5WeekDone(log, ws, budgetDef) {
  const done = {}; (budgetDef || []).forEach((b) => { done[b.key] = 0; });
  (log || []).forEach((e) => {
    if ((e.status !== "completed" && e.status !== "partial") || weekStartOf(e.date) !== ws) return;
    const c = pr5EntryCredits(e);
    Object.entries(c).forEach(([k,v]) => { done[k] = (done[k] || 0) + Number(v || 0); });
  });
  return done;
}
function pr5Deficit(b, projected) { return Math.max(0, Number(b.target || 0) - Number(projected[b.key] || 0)); }
function pr5BudgetPct(done, budgetDef) {
  let n=0,d=0; (budgetDef || []).filter((b) => !b.optional).forEach((b) => { n += Math.min(Number(done[b.key]||0), Number(b.target||0)); d += Number(b.target||0); });
  return d ? Math.round(100*n/d) : 100;
}

const PR5_MODULES = {
  pressStrength: { key:"pressStrength", label:"Bench strength", family:"upper", minutes:12, hard:true, areas:["chest","shoulders","triceps"] },
  verticalPull: { key:"verticalPull", label:"Pull-up strength", family:"upper", minutes:9, hard:true, areas:["back","biceps"] },
  horizontalPull: { key:"horizontalPull", label:"Row / back strength", family:"upper", minutes:9, hard:true, areas:["back","biceps"] },
  explosivePull: { key:"explosivePull", label:"Explosive pull + muscle-up", family:"upper", minutes:9, hard:true, areas:["back","biceps"] },
  lowerStrength: { key:"lowerStrength", label:"Lower force", family:"lower", minutes:22, hard:true, areas:["hamstrings","glutes","quads"] },
  verticalPower: { key:"verticalPower", label:"Vertical / jump development", family:"lower", minutes:9, hard:false, areas:["quads","glutes","calves"] },
  arms: { key:"arms", label:"Arms", family:"accessory", minutes:7, hard:false, areas:["biceps","triceps"] },
  core: { key:"core", label:"Core", family:"accessory", minutes:7, hard:false, areas:["core"] },
};
function pr5ModuleRows(key, minutes, stage) {
  if (key === "pressStrength") return minutes <= 15 ? [["benchA","3 × 5","crisp strength work · ~2 reps in reserve"]] : [["benchA","4 × 5–6","primary strength work · RPE 7–8"],["inclineDb","2 × 8–10","secondary chest only if recovered"]];
  if (key === "verticalPull") return minutes <= 15 ? [["pullup","2 × 6–8","strict · stop before form breaks"]] : [["pullup","3 × 6–8","strict; add load only when 8s are crisp"]];
  if (key === "horizontalPull") return [["csRow", minutes <= 25 ? "2 × 8–10" : "3 × 8–10","controlled horizontal pull"]];
  if (key === "explosivePull") return minutes <= 25 ? [["exPull","3 × 3","fast, crisp reps"]] : [["exPull","4 × 3","full intent while fresh"],["muTrans","3 × 3","skill, never sloppy failure"]];
  if (key === "lowerStrength") return minutes <= 25 ? [["rdl","3 × 6–8","clean hinge"],["hipThrust","2 × 8–10","strong hip extension"]] : [["rdl","3 × 6–8","primary hinge"],["hipThrust","3 × 8–10","hip extension"],["hamCurl","2 × 10–12","hamstrings"]];
  if (key === "verticalPower") {
    if (stage <= 1) return [["calfRaise","2 × 12–15","jump foundation"],["tibRaise","2 × 15–20","ankle capacity"],["bandWalk","2 × 10/side","hip stability"]];
    if (stage === 2) return [["snapDown","3 × 3","stick every landing"],["lowPogo","3 × 10","low contacts · skill, not conditioning"]];
    if (stage === 3) return [["broadJumpDrill","3 × 2","full rest · stick landing"],["lowPogo","3 × 10","elastic ankle contacts"]];
    return [["jumpReach","4 × 2","high quality · full rest · stop before fatigue"],["broadJumpDrill","3 × 2","power with clean landing"]];
  }
  if (key === "arms") return [["hammer","2 × 10–12","clean reps"],["pressdown","2 × 10–12","clean reps"]];
  if (key === "core") return [["kneeRaise","2 × 10–12","controlled"],["pallof","2 × 10/side","anti-rotation"]];
  return [];
}
function pr5AreasFromEntry(entry) {
  const out = new Set();
  if (!entry) return [];
  const slot = SLOT_OF[entry.sessionId];
  if (slot === "QR1" || slot === "QR2" || slot === "EASY") ["quads","hamstrings","glutes","calves"].forEach((a) => out.add(a));
  (entry.exercisesCompleted || []).forEach((id) => (PR5_EXERCISE_AREAS[id] || []).forEach((a) => out.add(a)));
  return [...out];
}
function pr5Overlap(a,b) { const A = new Set(a || []); return (b || []).some((x) => A.has(x)); }
function pr5EntryFamily(entry) {
  if (!entry) return null; const slot = SLOT_OF[entry.sessionId];
  if (slot === "QR1" || slot === "QR2") return "runHard"; if (slot === "EASY") return "easy"; if (slot === "REC" || slot === "MOB") return "recovery";
  const ids = new Set(entry.exercisesCompleted || []);
  if (["rdl","hipThrust","hamCurl","stepUp","snapDown","lowPogo","broadJumpDrill","jumpReach"].some((x) => ids.has(x))) return "lower";
  if (["benchA","benchC","pullup","csRow","pulldown","cableRow1","exPull","muTrans","inclineDb","ohp"].some((x) => ids.has(x))) return "upper";
  const slot2 = SLOT_OF[entry.sessionId]; return slot2 === "B" || slot2 === "D" ? "lower" : (slot2 === "A" || slot2 === "C" ? "upper" : null);
}
function pr5DynamicLabelFromEntry(entry) {
  const c = pr5EntryCredits(entry); const labels=[];
  if (c.pressStrength) labels.push("Press"); if (c.verticalPull) labels.push("Pull-ups"); if (c.horizontalPull) labels.push("Rows");
  if (c.lowerStrength) labels.push("Lower"); if (c.verticalPower) labels.push("Jump"); if (c.qualityRun) labels.push("Quality Run"); if (c.easyAerobic) labels.push("Easy Aerobic");
  if (c.explosivePull) labels.push("MU / Power"); if (c.core) labels.push("Core"); if (c.arms) labels.push("Arms");
  return labels.slice(0,3).join(" + ") || (SESSIONS[entry.sessionId] ? SESSIONS[entry.sessionId].short : "Training");
}
function pr5CarrierBaseIds(id) {
  const sess = SESSIONS[id]; if (!sess || !sess.variants) return [];
  const out = new Set(); Object.values(sess.variants).forEach((rows) => (rows || []).forEach((r) => out.add(r[0]))); return [...out];
}
function pr5ModuleRank(key, budget, projected) {
  const b = budget.rows.find((x) => x.key === key); if (!b) return -1;
  const gap = pr5Deficit(b, projected); if (gap <= 0) return -1;
  const floorGap = Math.max(0, Number(b.min||0) - Number(projected[key]||0));
  return gap * (1 + (b.score || 0)) + floorGap * 4;
}
function pr5ModuleEligible(mod, d, state, prevMeta) {
  const sys = fatigueLevelAt(state.fatigue, "systemic", d);
  if (mod.hard && sys >= 2) return false;
  if (maxAreaFatigue(state.fatigue, mod.areas || [], d) >= 2) return false;
  if (prevMeta && prevMeta.hard && mod.hard && pr5Overlap(prevMeta.areas, mod.areas)) return false;
  if (mod.family === "lower" && prevMeta && prevMeta.family === "runHard") return false;
  if (mod.family === "upper" && prevMeta && prevMeta.family === "upper" && prevMeta.hard) return false;
  if (mod.key === "verticalPower" && state.settings.knee === "irritated") return false;
  return true;
}
function pr5BuildStrengthDay(d, available, budget, projected, state, prevMeta) {
  const primaryKeys = ["pressStrength","verticalPull","horizontalPull","explosivePull","lowerStrength","verticalPower"];
  const candidates = primaryKeys.map((key) => ({ mod: PR5_MODULES[key], rank: pr5ModuleRank(key,budget,projected) }))
    .filter((x) => x.rank > 0 && pr5ModuleEligible(x.mod,d,state,prevMeta)).sort((a,b) => b.rank-a.rank);
  if (!candidates.length) return null;
  const first = candidates[0].mod; const family = first.family; const chosen=[first]; let used=first.minutes;
  candidates.slice(1).forEach((x) => {
    if (x.mod.family !== family || used + x.mod.minutes > available) return;
    chosen.push(x.mod); used += x.mod.minutes;
  });
  ["core","arms"].forEach((key) => {
    const m=PR5_MODULES[key], rank=pr5ModuleRank(key,budget,projected);
    if (rank > 0 && used + m.minutes <= available && pr5ModuleEligible(m,d,state,prevMeta)) { chosen.push(m); used += m.minutes; }
  });
  if (available <= 15 && family === "upper" && chosen.length === 1) {
    const partner = candidates.find((x) => x.mod.key !== first.key && x.mod.family === "upper");
    if (partner) chosen.push(partner.mod);
  }
  const stage = budget.stage; const rows=[]; const seen=new Set();
  chosen.forEach((m) => pr5ModuleRows(m.key, available, stage).forEach((r) => { if (!seen.has(r[0])) { seen.add(r[0]); rows.push(r); } }));
  let carrier = family === "lower" ? (state.settings.knee === "irritated" ? "BSAFE" : "B") : (chosen.some((m)=>m.key==="pressStrength") ? "A" : "C");
  if (carrier === "C" && maxAreaFatigue(state.fatigue,["chest","shoulders","triceps"],d) >= 1) carrier="CPULL";
  const labels=chosen.map((m)=>m.label);
  const focus = budget.focus.map((g)=>g.label).slice(0,2).join(" + ");
  return {
    id:carrier, family, hard:chosen.some((m)=>m.hard), areas:Array.from(new Set(chosen.flatMap((m)=>m.areas||[]))), modules:chosen.map((m)=>m.key),
    displayName:"Adaptive Session — " + labels.slice(0,3).join(" + "), displayShort:labels.slice(0,2).join(" + "),
    displayDesc:"Built from your Dec 31 outcomes, what is still unbanked this week, recovery and today's " + available + "-minute window.",
    reasons:["Goal-driven focus: " + focus + ".","A/B/C are only exercise libraries here — this composition was assembled for today."],
    autoOverride:{ tier:snapTier(available), remove:pr5CarrierBaseIds(carrier), add:rows.map((r)=>({id:r[0],sr:r[1],note:r[2]})), modules:chosen.map((m)=>m.key), reason:"Goal-derived mix · " + labels.join(" + ") },
  };
}
function pr5RunDay(kind, d, available, budget, projected, state, prevMeta) {
  const hard = kind === "qualityRun"; const lowerAreas=["quads","hamstrings","glutes","calves"];
  if (hard && (fatigueLevelAt(state.fatigue,"systemic",d)>=2 || maxAreaFatigue(state.fatigue,lowerAreas,d)>=2)) return null;
  if (hard && prevMeta && (prevMeta.family === "runHard" || prevMeta.family === "lower")) return null;
  const doneQ = Number(projected.qualityRun || 0);
  let id;
  if (hard) id = state.settings.knee === "irritated" ? (doneQ < 1 ? "XT1" : "XT2") : (doneQ < 1 ? "QR1" : "QR2");
  else id = state.settings.knee === "irritated" ? "EASYXT" : "EASY";
  const adds=[]; const modules=[kind]; let used = hard ? 30 : 25;
  ["core","arms"].forEach((key) => {
    const m=PR5_MODULES[key], rank=pr5ModuleRank(key,budget,projected);
    if (rank>0 && used+m.minutes<=available && pr5ModuleEligible(m,d,state,prevMeta)) {
      pr5ModuleRows(key,available,budget.stage).forEach((r)=>adds.push({id:r[0],sr:r[1],note:r[2]})); modules.push(key); used+=m.minutes;
    }
  });
  const runOverride = hard ? runRxFor(d,SLOT_OF[id]) : (available <= 30 ? "20–30 min conversational" : runRxFor(d,"EASY"));
  return {
    id, family:hard?"runHard":"easy", hard, areas:lowerAreas, modules,
    displayName:hard ? "Adaptive Session — Quality Run" : "Adaptive Session — Easy Aerobic" + (modules.length>1 ? " + " + modules.slice(1).map((x)=>PR5_MODULES[x].label).join(" + ") : ""),
    displayShort:hard ? "Quality Run" : "Easy Aerobic" + (modules.includes("core") ? " + Core" : ""),
    displayDesc:hard ? "Today's running dose earns the highest-value conditioning adaptation without stacking lower-body fatigue." : "Easy aerobic work builds the engine and can absorb low-fatigue accessories when recovery allows.",
    reasons:[hard ? "Mile / 5K outcomes are currently asking for a quality exposure." : "Aerobic base is still useful and recovery permits a low-stress exposure."],
    autoOverride:{ add:adds, modules, runOverride, reason:"Goal-derived " + (hard?"quality-running":"easy-aerobic") + " exposure." },
  };
}

function goalDrivenPlanWeek(ctx) {
  const state = ctx.state || { settings:ctx.settings||{}, fatigue:ctx.fatigue||{}, calibration:{values:{}}, metrics:{}, exercises:{}, goalOverrides:{} };
  const today=ctx.today, log=ctx.log||[], settings=ctx.settings||state.settings||{}, ws=weekStartOf(today);
  const dates=Array.from({length:7},(_,i)=>addDays(ws,i)); const byDate=entriesByDateFn(log);
  const budget=pr5DerivedBudget(state,today); const budgetDef=budget.rows; const done=pr5WeekDone(log,ws,budgetDef); const projected={...done};
  const days=[]; let consecutive=0; let recoveryPlaced=(done.recovery||0)>0;
  const avail=(d)=>{ const wm=settings.weekdayMinutes||{}; const v=wm[dowMon0(d)]; return v==null?60:Number(v); };
  const row=(k)=>budgetDef.find((b)=>b.key===k); const gap=(k)=>row(k)?pr5Deficit(row(k),projected):0;
  const actualMeta=(e)=>({ family:pr5EntryFamily(e), areas:pr5AreasFromEntry(e), hard:(pr5EntryFamily(e)==="upper"||pr5EntryFamily(e)==="lower"||pr5EntryFamily(e)==="runHard") });
  let prevMeta=null;
  dates.forEach((d)=>{
    const e=byDate[d];
    if (e && (e.status==="completed"||e.status==="partial"||e.status==="skipped")) {
      const short=e.status==="skipped"?"Skipped":pr5DynamicLabelFromEntry(e); days.push({date:d,id:e.sessionId,status:e.status,reasons:[],entry:e,displayShort:short,displayName:e.status==="skipped"?"Skipped / reflowed":short});
      if (e.status==="completed"||e.status==="partial") { prevMeta=actualMeta(e); consecutive = prevMeta.family && prevMeta.family!=="recovery" ? consecutive+1 : 0; if(prevMeta.family==="recovery") recoveryPlaced=true; }
      return;
    }
    if (d < today) { days.push({date:d,id:null,status:"past",reasons:[],displayShort:"—"}); prevMeta=null; consecutive=0; return; }
    if ((ctx.dayFlags||{})[d]==="exhausted" || avail(d)<15 || fatigueLevelAt(state.fatigue,"systemic",d)>=3) {
      days.push({date:d,id:"REC",status:"planned",displayName:"Recovery — Protect the Adaptation",displayShort:"Recovery",displayDesc:"No useful hard work beats recovery today.",reasons:["Recovery constraint wins over the weekly forecast."],autoOverride:null});
      projected.recovery=(projected.recovery||0)+1; recoveryPlaced=true; prevMeta={family:"recovery",areas:[],hard:false}; consecutive=0; return;
    }
    if (consecutive>=3) {
      days.push({date:d,id:"REC",status:"planned",displayName:"Recovery — Planned",displayShort:"Recovery",displayDesc:"Three training days are already stacked. Bank the adaptation before adding more work.",reasons:["Recovery guardrail: no fourth consecutive training day in the forecast."],autoOverride:null});
      projected.recovery=(projected.recovery||0)+1; recoveryPlaced=true; prevMeta={family:"recovery",areas:[],hard:false}; consecutive=0; return;
    }
    const minutes=avail(d); const candidates=[];
    const strength=pr5BuildStrengthDay(d,minutes,budget,projected,state,prevMeta);
    if(strength) {
      const rank=strength.modules.reduce((sum,k)=>sum+Math.max(0,pr5ModuleRank(k,budget,projected)),0); candidates.push({...strength,rank});
    }
    if(gap("qualityRun")>0) { const r=pr5RunDay("qualityRun",d,minutes,budget,projected,state,prevMeta); if(r) candidates.push({...r,rank:pr5ModuleRank("qualityRun",budget,projected)+1}); }
    if(gap("easyAerobic")>0) { const r=pr5RunDay("easyAerobic",d,minutes,budget,projected,state,prevMeta); if(r) candidates.push({...r,rank:pr5ModuleRank("easyAerobic",budget,projected)}); }
    const weekIx=Math.max(0,Math.floor(daysBetween(SEP_START,ws)/7)); const rotation=["upper","runHard","lower","easy"][(weekIx+dowMon0(d))%4];
    candidates.forEach((c)=>{ if(c.family===rotation)c.rank+=.18; }); candidates.sort((a,b)=>b.rank-a.rank);
    let choice=candidates[0]||null;
    const requiredRemaining=budgetDef.filter((b)=>!b.optional&&b.key!=="recovery"&&pr5Deficit(b,projected)>0).length;
    if(!choice || (requiredRemaining===0 && recoveryPlaced)) choice=null;
    if(!choice) {
      const id=gap("core")>0?"MOB":"REC"; const name=id==="MOB"?"Core / Mobility Reset":"Recovery";
      days.push({date:d,id,status:"planned",displayName:name,displayShort:name,displayDesc:"No higher-value safe stimulus is outstanding for this slot.",reasons:["The calendar is a forecast, not a streak to protect."],autoOverride:null});
      if(id==="REC"){projected.recovery=(projected.recovery||0)+1;recoveryPlaced=true;} else projected.core=(projected.core||0)+1;
      prevMeta={family:"recovery",areas:[],hard:false}; consecutive=0; return;
    }
    days.push({date:d,id:choice.id,status:"planned",reasons:choice.reasons||[],displayName:choice.displayName,displayShort:choice.displayShort,displayDesc:choice.displayDesc,autoOverride:choice.autoOverride||null});
    (choice.modules||[]).forEach((k)=>{ projected[k]=(projected[k]||0)+1; });
    prevMeta={family:choice.family,areas:choice.areas||[],hard:!!choice.hard}; consecutive++;
  });
  if(!recoveryPlaced) {
    for(let i=days.length-1;i>=0;i--){ const d=days[i]; if(d.date>=today&&d.status==="planned"){ d.id="REC";d.displayName="Recovery — Planned";d.displayShort="Recovery";d.displayDesc="The weekly forecast reserves one low-stress day so the work can turn into adaptation.";d.reasons=["Recovery is a required input to the Dec 31 plan."];d.autoOverride=null;projected.recovery=(projected.recovery||0)+1;break; } }
  }
  const pct=pr5BudgetPct(done,budgetDef); const focusText=budget.focus.map((g)=>g.label).join(" · ");
  return { days,dropped:[],notes:["Goal-derived prescription — current focus: "+focusText+". Weekly targets are outputs, not permanent rules."],done,pct,
    message:"The calendar is today's best forecast toward Dec 31. Log what actually happens and it will re-compose from the remaining goals, recovery and time.",
    phase:phaseOf(today),effPhase:phaseOf(addDays(ws,3)),calMode:false,weekStart:ws,budgetDef,strategy:{focus:budget.focus,scores:budget.scores,stage:budget.stage} };
}

function planWeek(ctx) {
  const ph=phaseOf(ctx.today); const eff=phaseOf(addDays(weekStartOf(ctx.today),3));
  if(ph==="pre"||ph==="cal"||eff==="pre"||eff==="cal") {
    const legacy=legacyPlanWeek(ctx); return {...legacy,budgetDef:BUDGET_DEF,strategy:null};
  }
  return goalDrivenPlanWeek(ctx);
}

'''
s = s.replace(insert_marker, js + insert_marker, 1)
changes += 1

# Pass the full athlete state into planning, including month forecasts.
once(
'''      fatigue: state.fatigue,
    });''',
'''      fatigue: state.fatigue,
      state,
    });''',
'app plan gets state')
once(
'''map[ws] = planWeek({ today: ctxToday, log: state.log, pins: state.pins, dayFlags: state.dayFlags, settings: state.settings, knee: state.settings.knee, fatigue: state.fatigue });''',
'''map[ws] = planWeek({ today: ctxToday, log: state.log, pins: state.pins, dayFlags: state.dayFlags, settings: state.settings, knee: state.settings.knee, fatigue: state.fatigue, state });''',
'month plan gets state')

# Budget UI reads the current goal-derived prescription.
once(
'''function BudgetLedger({ done, compact }) {
  const rows = compact
    ? BUDGET_DEF.filter((b) => ["upperStrength", "qualityRun", "lowerAthletic", "coreMobility"].includes(b.key))
    : BUDGET_DEF;''',
'''function BudgetLedger({ done, compact, budgetDef }) {
  const source = budgetDef || BUDGET_DEF;
  const compactKeys = ["pressStrength","verticalPull","qualityRun","lowerStrength","verticalPower","upperStrength","lowerAthletic","coreMobility"];
  const rows = compact ? source.filter((b) => compactKeys.includes(b.key)) : source;''',
'budget ledger dynamic source')
s = s.replace('<BudgetLedger done={plan.done} compact />', '<BudgetLedger done={plan.done} compact budgetDef={plan.budgetDef} />')
s = s.replace('<BudgetLedger done={plan.done} />', '<BudgetLedger done={plan.done} budgetDef={plan.budgetDef} />')

# Calendar/Today use generated descriptions rather than exposing carrier A/B/C.
once(
''': session ? session.name
                : "Open day"}''',
''': dayPlan.displayName || (session ? session.name : "Open day")}''',
'Today dynamic name')
once(
'''(partial ? "Partially banked: " : "Banked: ") + session.short + (partial ? "" : " ✓")''',
'''(partial ? "Partially banked: " : "Banked: ") + (dayPlan.displayShort || session.short) + (partial ? "" : " ✓")''',
'Today completed dynamic short')
once(
'''<p className="dim" style={{ fontSize: 13.5 }}>{session.desc}</p>''',
'''<p className="dim" style={{ fontSize: 13.5 }}>{dayPlan.displayDesc || session.desc}</p>''',
'Today dynamic description')
s = s.replace('{session ? session.name : "Rest day"}', '{day.displayName || (session ? session.name : "Rest day")}')
s = s.replace('{s ? s.short : ""}</span>', '{d.displayShort || (s ? s.short : "")}</span>')
s = s.replace('{s ? s.short : d.status === "past" ? "—" : "Rest"}', '{d.displayShort || (s ? s.short : d.status === "past" ? "—" : "Rest")}')

# Coach context gets the same dynamic names and current derived budget.
once(
'''    var ss = d.id ? SESSIONS[d.id].short : "rest";''',
'''    var ss = d.displayShort || (d.id ? SESSIONS[d.id].short : "rest");''',
'coach day labels')
once(
'''  var budget = BUDGET_DEF.map(function (b) { return b.label + " " + (plan.done[b.key] || 0) + "/" + b.target; }).join(", ");''',
'''  var currentBudget = plan.budgetDef || BUDGET_DEF;
  var budget = currentBudget.map(function (b) { return b.label + " " + (plan.done[b.key] || 0) + "/" + b.target; }).join(", ");''',
'coach dynamic budget')

# Make the product language match the architecture.
once(
'''<p className="small" style={{ marginTop: 8 }}><span className="helpnum">1</span>You're not chasing a calendar. Each week has a <b>budget</b> (2 upper, 2 runs, 1 lower…). Miss a day and the week reflows — nothing is "lost".</p>''',
'''<p className="small" style={{ marginTop: 8 }}><span className="helpnum">1</span>You're not chasing a split. <b>Dec 31 outcomes drive the plan.</b> The trainer derives this week's stimulus needs from your progress, then re-derives them as the data changes.</p>''',
'help goal-first')
once(
'''<p className="small" style={{ marginTop: 6 }}><span className="helpnum">3</span>The named workouts are anchors, not a split. The trainer can mix compatible modules — pull-ups + easy aerobic, arms on an easy day, or a condensed lift + light run — when that is the best way to close your weekly gaps. Tell the <b>Coach</b>: "done", "I only did 15 minutes", "that was too easy", or "rebuild the week".</p>''',
'''<p className="small" style={{ marginTop: 6 }}><span className="helpnum">3</span>A/B/C are only <b>playbook templates</b>. Today can be any safe mix of press, pull, lower, run, jump-development, arms or core modules. Actual work is banked exercise-by-exercise; the next recommendation is built from what remains.</p>''',
'help templates')
once(
'''<h1 className="big">Four workouts. Three runs. One skill track.</h1>''',
'''<h1 className="big">A playbook of modules — not a weekly split.</h1>''',
'program title')
once(
'''Every session below is the complete prescription from the program — full exercise tables with rest and purpose, plus the built-in <b style={{ color: "var(--text)" }}>15 / 25 / 40 / 60-minute versions</b> so a short day still moves the block forward. The Today screen serves the right version automatically; this page is the whole playbook.''',
'''The tables below are trusted exercise libraries the trainer can draw from. They are not Monday/Tuesday/Friday identities. The Today engine assembles the highest-value safe combination from your Dec 31 goals, current progress, recovery and available time.''',
'program copy')
once(
'''Priority if you only get four real sessions in a week: <b>A · Jam Day → one quality run → B · Drive Day → C · Ball Skills.</b> Add the second quality run and the Walkthrough as schedule and recovery allow.''',
'''There is no permanent "four-day priority order." If bench is lagging, pressing may earn more attention; if running or vertical development is lagging, the weekly prescription shifts there — while recovery rules still cap what is safe.''',
'program priority copy')
once(
'''✓min = weekly floor met · ✓ = full target. Minimums protect the block; targets grow it. Priority when compressed: A · Jam Day → one quality run → B · Drive Day → C · Ball Skills → second run → Walkthrough → Special Teams.''',
'''✓min = this week's derived floor · ✓ = this week's current target. These numbers are outputs of the Dec 31 plan, not permanent rules. Log real work and the forecast recalculates.''',
'week planner footer')

# Goal row can show the new vertical goal without pretending we know a precise baseline yet.
once(
'''  if (g.key === "abs" || g.key === "speed") { cur = "tracked at review"; pct = 0; }''',
'''  if (g.key === "abs" || g.key === "speed") { cur = "tracked at review"; pct = 0; }
  if (g.key === "vertical") { cur = snap.vertical || "baseline pending"; pct = 0; }''',
'vertical GoalRow')
once(
'''    mu: !!met.muscleUp,
  };''',
'''    mu: !!met.muscleUp,
    vertical: cal.verticalJump || null,
  };''',
'goal snapshot vertical')

if changes < 15:
    raise RuntimeError(f'PR5 patch applied too few structural changes: {changes}')

p.write_text(s)
print(f'PR5 goal-driven scheduler applied ({changes} structural changes)')

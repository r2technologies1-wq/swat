import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/* ============================================================================
   THE CORNERBACK PROJECT — adaptive personalized trainer + hybrid-athlete dashboard
   ----------------------------------------------------------------------------
   Local-first. Win the block, not the day.

   Architecture (single file, but strictly layered):
     1. Storage adapter          — window.storage (Claude) -> localStorage
                                   (self-hosted) -> in-memory fallback.
     2. HealthDataProvider       — abstraction for a future HealthKit bridge.
                                   Mock data today. Do NOT read Apple Health
                                   from browser JS; the future path is
                                   Watch -> Apple Health -> iOS companion ->
                                   this dashboard's sync endpoint.
     3. Program data             — Cornerback V3 seeded as editable data,
                                   never hard-coded inside components.
     4. Scheduling engine        — pure functions, no React. Extractable.
     5. Progression engine       — double progression + bench rule.
     6. State + persistence      — reducer-style actions, debounced save.
     7. UI                       — Today / Week / Roadmap / Performance /
                                   Calibration / Settings.
   ========================================================================== */
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, } from "recharts";
/* ============================== 1. STORAGE ================================ */
/* Persistence chain: window.storage (Claude artifacts) -> localStorage
   (only when self-hosted; never touched inside Claude) -> memory.          */
const memStore = {};
const StorageAdapter = {
    async load(key) {
        try {
            if (typeof window !== "undefined" && window.storage) {
                try {
                    const r = await window.storage.get(key);
                    if (r && r.value)
                        return JSON.parse(r.value);
                }
                catch (e) { /* key missing */ }
                return null;
            }
        }
        catch (e) { /* fall through */ }
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                const v = window.localStorage.getItem(key);
                return v ? JSON.parse(v) : null;
            }
        }
        catch (e) { /* blocked */ }
        return memStore[key] || null;
    },
    async save(key, obj) {
        const json = JSON.stringify(obj);
        try {
            if (typeof window !== "undefined" && window.storage) {
                await window.storage.set(key, json);
                return true;
            }
        }
        catch (e) { /* fall through */ }
        try {
            if (typeof window !== "undefined" && window.localStorage) {
                window.localStorage.setItem(key, json);
                return true;
            }
        }
        catch (e) { /* blocked */ }
        memStore[key] = obj;
        return true;
    },
};
const STORE_KEY = "cornerback-v1";
/* ========================= 2. HEALTH DATA PROVIDER ======================== */
/* Swap MockHealthDataProvider for a HealthKit-backed implementation later.
   The dashboard only ever talks to this interface.                          */
class HealthDataProvider {
    constructor() { this.source = "abstract"; }
    async getWorkouts() { return []; }
    async getSteps() { return null; }
    async getRunningDistance() { return null; }
    async getRestingHeartRate() { return null; }
    async getHRV() { return null; }
    async getVO2Max() { return null; }
    async getSleep() { return null; }
}
class MockHealthDataProvider extends HealthDataProvider {
    constructor() { super(); this.source = "mock"; }
    async getSteps() { return { today: 8412, sevenDayAvg: 9120 }; }
    async getRestingHeartRate() { return { latest: 52, unit: "bpm" }; }
    async getHRV() { return { latest: 68, unit: "ms" }; }
    async getVO2Max() { return { latest: 49.5, unit: "mL/kg/min" }; }
    async getSleep() { return { lastNightHrs: 7.1, coverage: "sparse" }; }
    async getRunningDistance() { return { weekMiles: 6.8 }; }
}
const healthProvider = new MockHealthDataProvider();
/* UTILS-START */
/* ============================ DATE UTILITIES ============================== */
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const parseYmd = (s) => {
    const p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
};
const addDays = (s, n) => {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n); // DST-safe
    return ymd(d);
};
const dowMon0 = (s) => (parseYmd(s).getDay() + 6) % 7; // Mon=0 ... Sun=6
const weekStartOf = (s) => addDays(s, -dowMon0(s));
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtShort = (s) => {
    const d = parseYmd(s);
    return DOW_SHORT[dowMon0(s)] + " " + (d.getMonth() + 1) + "/" + d.getDate();
};
const fmtLong = (s) => {
    const d = parseYmd(s);
    const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const W = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    return W[dowMon0(s)] + ", " + M[d.getMonth()] + " " + d.getDate();
};
/* Program phase boundaries */
const CAL_START = "2026-08-19";
const SEP_START = "2026-09-01";
function phaseOf(dateStr) {
    if (dateStr < CAL_START)
        return "pre";
    if (dateStr < SEP_START)
        return "cal";
    if (dateStr <= "2026-09-30")
        return "sep";
    if (dateStr <= "2026-10-31")
        return "oct";
    if (dateStr <= "2026-11-30")
        return "nov";
    if (dateStr <= "2026-12-31")
        return "dec";
    return "post";
}
/* September training week 1-4 (29-30 = review) */
function sepWeekIndex(dateStr) {
    const d = parseYmd(dateStr);
    if (d.getFullYear() !== 2026)
        return null;
    if (d.getMonth() !== 8)
        return null;
    if (d.getDate() >= 29)
        return "review";
    return Math.min(4, Math.floor((d.getDate() - 1) / 7) + 1);
}
/* Time-goal helpers: "5:57" -> 357 seconds */
function mmssToSec(t) {
    if (!t)
        return null;
    const m = String(t).trim().match(/^(\d+):(\d{1,2})$/);
    if (!m)
        return null;
    return Number(m[1]) * 60 + Number(m[2]);
}
function secToMmss(s) {
    if (s == null)
        return "—";
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return m + ":" + pad2(r);
}
/* ======================= 3. PROGRAM DATA (editable) ======================= */
/* Seeded from Cornerback Project V3. Weights are calibrated by the user —
   only bench A carries a suggested start (~145) per the program.            */
const EXERCISE_DEFAULTS = {
    benchA: { name: "Barbell bench press", weight: 145, inc: 5, unit: "lb", cal: true, group: "A" },
    pullup: { name: "Strict / weighted pull-up", weight: 0, inc: 5, unit: "lb added", cal: false, bw: true, group: "A" },
    csRow: { name: "Chest-supported DB row", weight: null, inc: 5, unit: "lb", cal: true, group: "A" },
    inclineDb: { name: "Incline DB press", weight: null, inc: 5, unit: "lb", cal: true, group: "A" },
    latRaise: { name: "DB lateral raise", weight: null, inc: 2.5, unit: "lb", cal: true, group: "A" },
    hammer: { name: "Hammer curl", weight: null, inc: 5, unit: "lb", cal: true, group: "A" },
    pressdown: { name: "Cable triceps pressdown", weight: null, inc: 5, unit: "lb", cal: true, group: "A" },
    kneeRaise: { name: "Hanging knee raise", weight: 0, inc: 0, unit: "bw", cal: false, bw: true, group: "A" },
    hipThrust: { name: "Hip thrust / glute bridge", weight: null, inc: 10, unit: "lb", cal: true, group: "B" },
    rdl: { name: "Romanian deadlift", weight: null, inc: 10, unit: "lb", cal: true, group: "B" },
    hamCurl: { name: "Hamstring curl", weight: null, inc: 5, unit: "lb", cal: true, group: "B" },
    stepUp: { name: "Low step-up / Spanish squat iso", weight: null, inc: 5, unit: "lb", cal: true, group: "B" },
    calfRaise: { name: "Standing calf raise", weight: null, inc: 10, unit: "lb", cal: true, group: "B" },
    tibRaise: { name: "Tibialis raise", weight: null, inc: 5, unit: "lb", cal: true, group: "B" },
    bandWalk: { name: "Lateral band walk", weight: 0, inc: 0, unit: "band", cal: false, bw: true, group: "B" },
    pallof: { name: "Pallof press", weight: null, inc: 5, unit: "lb", cal: true, group: "B" },
    exPull: { name: "Explosive pull-up", weight: 0, inc: 0, unit: "bw", cal: false, bw: true, group: "C" },
    muTrans: { name: "Band-assisted muscle-up / transition", weight: 0, inc: 0, unit: "band", cal: false, bw: true, group: "C" },
    pulldown: { name: "Lat pulldown", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    cableRow1: { name: "1-arm cable row", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    ohp: { name: "DB overhead press", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    benchC: { name: "Bench press — technique", weight: null, inc: 5, unit: "lb", cal: false, derived: "≈60–70% of Upper A bench", group: "C" },
    incCurl: { name: "Incline DB curl", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    ohTri: { name: "Rope overhead triceps extension", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    facePull: { name: "Face pull", weight: null, inc: 5, unit: "lb", cal: true, group: "C" },
    mbThrow: { name: "Medicine-ball chest throw", weight: null, inc: 2, unit: "lb ball", cal: true, group: "D" },
    farmer: { name: "Farmer carry", weight: null, inc: 10, unit: "lb/hand", cal: true, group: "D" },
    ssRdl: { name: "DB split-stance RDL", weight: null, inc: 5, unit: "lb", cal: true, group: "D" },
    pushup: { name: "Push-up", weight: 0, inc: 0, unit: "bw", cal: false, bw: true, group: "D" },
    abWheel: { name: "Ab wheel / dead bug", weight: 0, inc: 0, unit: "bw", cal: false, bw: true, group: "D" },
    easyAerobic20: { name: "Easy aerobic add-on", weight: 0, inc: 0, unit: "15–20 min", cal: false, bw: true, group: "MIX" },
};
/* Session library.
   contrib   = weekly-budget categories this session banks when completed.
   stress    = engine metadata (upper push/pull, lower, run intensity 0-3).
   variants  = time-scaled exercise lists straight from V3.
   MES = minimum effective session (15 min tier).                            */
const SESSIONS = {
    A: {
        id: "A", slot: "A", name: "Workout A · Jam Day — Upper Strength", short: "A · Jam Day",
        kind: "strength", required: true, tone: "strength",
        desc: "Primary bench-strength exposure with enough pulling and direct arm work to build a balanced upper body. Chest volume is controlled; the goal is stronger, not wrecked.",
        contrib: { upperStrength: 1 },
        stress: { push: 3, pull: 2, lower: 0, run: 0, hard: true, bench: true },
        minMinutes: 15,
        variants: {
            60: [
                ["benchA", "4 × 5–6", "2–3 min rest · RPE 7–8 · primary strength work"],
                ["pullup", "3 × 6–8", "90–120 s · strict; add load only when 8s are crisp"],
                ["csRow", "3 × 8–10", "75 s · controlled horizontal pull"],
                ["inclineDb", "2 × 8–10", "75 s · limited secondary chest"],
                ["latRaise", "3 × 12–15", "45 s"],
                ["hammer", "3 × 10–12", "45–60 s"],
                ["pressdown", "3 × 10–12", "45–60 s"],
                ["kneeRaise", "2 × 10–12", "45 s"],
            ],
            40: [
                ["benchA", "4 × 5–6", "2–3 min rest · RPE 7–8"],
                ["pullup", "3 × 6–8", "90–120 s"],
                ["csRow", "3 × 8–10", "75 s"],
                ["latRaise", "3 × 12–15", "45 s"],
                ["hammer", "3 × 10–12", "superset with pressdown"],
                ["pressdown", "3 × 10–12", "superset with curls"],
            ],
            25: [
                ["benchA", "4 × 5–6", "2–3 min rest"],
                ["pullup", "3 × 6–8", "90 s"],
                ["csRow", "2 × 8–10", "controlled"],
            ],
            15: [
                ["benchA", "4 × 5–6", "the primary stimulus"],
                ["pullup", "2 × 6–8", "strict"],
            ],
        },
        addOn: { key: "explosivePrimer", label: "3 × 3 explosive pull-up primer before strict sets", contrib: { explosivePull: 1 } },
    },
    B: {
        id: "B", slot: "B", name: "Workout B · Drive Day — Lower Strength + Knee Capacity", short: "B · Drive Day",
        kind: "strength", required: true, tone: "lower",
        desc: "Primary lower-body strength day: posterior-chain force, knee capacity, calves and trunk without forcing a squat pattern that does not currently feel right.",
        contrib: { lowerAthletic: 1, coreMobility: 1 },
        stress: { push: 0, pull: 0, lower: 3, run: 0, hard: true },
        minMinutes: 15,
        variants: {
            60: [
                ["rdl", "3 × 6–8", "90 s · technically clean hinge"],
                ["hipThrust", "3 × 8–10", "75–90 s"],
                ["hamCurl", "2–3 × 10–12", "60 s"],
                ["stepUp", "2–3 × 8/leg or 30 s iso", "pain-free option only"],
                ["calfRaise", "3 × 12–15", "45 s"],
                ["tibRaise", "2 × 15–20", "45 s"],
                ["bandWalk", "2 × 10–15/side", "45 s"],
                ["pallof", "2 × 10/side", "45 s"],
            ],
            40: [
                ["rdl", "3 × 6–8", "90 s"],
                ["hipThrust", "3 × 8–10", "75–90 s"],
                ["hamCurl", "2 × 10–12", "60 s"],
                ["stepUp", "2 × 8/leg or iso", "pain-free only"],
                ["calfRaise", "2 × 12–15", "45 s"],
            ],
            25: [
                ["rdl", "3 × 6–8", ""],
                ["hipThrust", "3 × 8–10", ""],
                ["hamCurl", "2 × 10–12", ""],
            ],
            15: [
                ["rdl", "3 × 6–8", ""],
                ["hipThrust", "2 × 8–10", ""],
            ],
        },
        addOn: { key: "stage2Primer", label: "Stage-2 primer: snap-down 3 × 3 + low pogo 3 × 10 (knee normal only)", contrib: {} },
    },
    C: {
        id: "C", slot: "C", name: "Workout C · Ball Skills — Pull Power + Muscle-Up + Arms", short: "C · Ball Skills",
        kind: "strength", required: true, tone: "strength",
        desc: "Explosive pulling and muscle-up skill lead. A light second bench exposure is included only when pressing recovery allows it; the scheduler automatically strips it when chest/shoulder fatigue is live.",
        contrib: { upperStrength: 1, explosivePull: 1 },
        stress: { push: 2, pull: 3, lower: 0, run: 0, hard: true, bench: true },
        minMinutes: 15,
        variants: {
            60: [
                ["exPull", "4 × 3", "90 s · chest toward bar, speed"],
                ["muTrans", "4 × 3", "90 s · skill, never sloppy fatigue"],
                ["pulldown", "3 × 8–10", "60–75 s"],
                ["cableRow1", "3 × 10/side", "60 s"],
                ["ohp", "3 × 8–10", "75 s"],
                ["benchC", "3 × 5", "60–70% of Upper A · fast, crisp reps only"],
                ["incCurl", "3 × 10–12", "45–60 s"],
                ["ohTri", "3 × 10–12", "45–60 s"],
                ["facePull", "2 × 12–15", "45 s"],
            ],
            40: [
                ["exPull", "4 × 3", "90 s"],
                ["muTrans", "4 × 3", "90 s"],
                ["pulldown", "3 × 8–10", "60 s"],
                ["cableRow1", "3 × 10/side", "60 s"],
                ["benchC", "3 × 5", "60–70% of Upper A · speed only"],
                ["incCurl", "2 × 10–12", "superset with triceps"],
                ["ohTri", "2 × 10–12", "superset with curls"],
            ],
            25: [
                ["exPull", "4 × 3", ""],
                ["muTrans", "3 × 3", ""],
                ["pulldown", "3 × 8–10", ""],
                ["benchC", "3 × 5", "speed only; omitted automatically when push fatigue is live"],
            ],
            15: [
                ["exPull", "4 × 3", ""],
                ["muTrans", "3 × 3", ""],
                ["pulldown", "2 × 8–10", ""],
            ],
        },
    },
    CPULL: {
        id: "CPULL", slot: "C", name: "Workout C · Pull-Only Recovery Variant", short: "C · Pull-Only",
        kind: "strength", required: true, tone: "strength", adaptive: true,
        desc: "Pressing fatigue is still live, so today keeps the muscle-up/back/arms stimulus and removes bench. OHP is also removed when shoulder fatigue is high.",
        contrib: { upperStrength: 1, explosivePull: 1 },
        stress: { push: 0, pull: 3, lower: 0, run: 0, hard: true, bench: false },
        minMinutes: 15,
        variants: {
            60: [
                ["exPull", "4 × 3", "90 s"], ["muTrans", "4 × 3", "90 s"],
                ["pulldown", "3 × 8–10", "60–75 s"], ["cableRow1", "3 × 10/side", "60 s"],
                ["incCurl", "3 × 10–12", "45–60 s"], ["ohTri", "3 × 10–12", "45–60 s"],
                ["facePull", "2 × 12–15", "45 s"],
            ],
            40: [
                ["exPull", "4 × 3", ""], ["muTrans", "4 × 3", ""], ["pulldown", "3 × 8–10", ""],
                ["cableRow1", "3 × 10/side", ""], ["incCurl", "2 × 10–12", "superset"], ["ohTri", "2 × 10–12", "superset"],
            ],
            25: [
                ["exPull", "4 × 3", ""], ["muTrans", "3 × 3", ""], ["pulldown", "3 × 8–10", ""],
                ["incCurl", "2 × 10–12", "superset"], ["ohTri", "2 × 10–12", "superset"],
            ],
            15: [["exPull", "4 × 3", ""], ["muTrans", "3 × 3", ""], ["pulldown", "2 × 8–10", ""]],
        },
    },
    BRED: {
        id: "BRED", slot: "B", name: "Workout B · Reduced Lower Dose", short: "B · Reduced",
        kind: "strength", required: true, tone: "lower", adaptive: true,
        desc: "Moderate lower-body fatigue is still present. This preserves the hinge/capacity stimulus while deliberately cutting volume.",
        contrib: { lowerAthletic: 1 },
        stress: { push: 0, pull: 0, lower: 2, run: 0, hard: true },
        minMinutes: 15,
        variants: {
            60: [["rdl", "2 × 6–8", ""], ["hipThrust", "2 × 8–10", ""], ["hamCurl", "2 × 10–12", ""], ["calfRaise", "2 × 12–15", ""], ["tibRaise", "2 × 15–20", ""], ["pallof", "2 × 10/side", ""]],
            40: [["rdl", "2 × 6–8", ""], ["hipThrust", "2 × 8–10", ""], ["hamCurl", "2 × 10–12", ""], ["calfRaise", "2 × 12–15", ""]],
            25: [["rdl", "2 × 6–8", ""], ["hipThrust", "2 × 8–10", ""], ["hamCurl", "2 × 10–12", ""]],
            15: [["rdl", "2 × 6–8", ""], ["hipThrust", "2 × 8–10", ""]],
        },
    },
    D: {
        id: "D", slot: "D", name: "Athletic Microdose — Durability + Power Base", short: "Athletic Microdose",
        kind: "strength", required: false, tone: "optional",
        desc: "Small second lower/athletic exposure: grip, unilateral hinge, feet/ankles, hips and core. It should leave you better, not cooked. Knee-approved plyometrics can layer on top.",
        contrib: { athleticMicrodose: 1, coreMobility: 1 },
        stress: { push: 0, pull: 1, lower: 1, run: 0, hard: false },
        minMinutes: 15,
        variants: {
            60: [["farmer", "3 × 30–40 yd", ""], ["ssRdl", "2 × 8/side", ""], ["calfRaise", "2 × 15", ""], ["tibRaise", "2 × 15–20", ""], ["bandWalk", "2 × 12/side", ""], ["abWheel", "2–3 × 6–10", ""]],
            40: [["farmer", "3 × 30–40 yd", ""], ["ssRdl", "2 × 8/side", ""], ["calfRaise", "2 × 15", ""], ["tibRaise", "2 × 15–20", ""], ["abWheel", "2 × 6–10", ""]],
            25: [["farmer", "3 × 30–40 yd", ""], ["ssRdl", "2 × 8/side", ""], ["calfRaise", "2 × 15", ""], ["abWheel", "2 × 6–10", ""]],
            15: [["farmer", "2 × 30–40 yd", ""], ["calfRaise", "2 × 15", ""], ["tibRaise", "2 × 15–20", ""], ["abWheel", "2 × 6–10", ""]],
        },
        addOn: { key: "stagePlyo", label: "Add current knee-approved plyometric stage", contrib: {} },
    },
    QR1: {
        id: "QR1", slot: "QR1", name: "Route Speed — Quality Run 1 (Intervals)", short: "Q1 · Routes",
        kind: "run", required: true, tone: "run",
        desc: "Time-and-effort intervals: strong is faster than threshold, never an all-out sprint. Stage-4 accelerations attach here once the knee has earned them.",
        contrib: { qualityRun: 1 },
        stress: { push: 0, pull: 0, lower: 2, run: 3, hard: true, hardRun: true },
        minMinutes: 25,
    },
    QR2: {
        id: "QR2", slot: "QR2", name: "Fourth Quarter — Quality Run 2 (Threshold)", short: "Q2 · 4th Qtr",
        kind: "run", required: true, tone: "run",
        desc: "Late-game lungs: hard but controlled, roughly an effort you could hold 35–50 minutes when fresh.",
        contrib: { qualityRun: 1 },
        stress: { push: 0, pull: 0, lower: 2, run: 3, hard: true, hardRun: true },
        minMinutes: 25,
    },
    EASY: {
        id: "EASY", slot: "EASY", name: "Walkthrough — Easy Aerobic Run", short: "Walkthrough",
        kind: "run", required: true, tone: "easy",
        desc: "Full-conversation pace. The walkthrough builds the engine that makes game days count.",
        contrib: { easyRun: 1 },
        stress: { push: 0, pull: 0, lower: 1, run: 1, hard: false },
        minMinutes: 25,
    },
    MOB: {
        id: "MOB", slot: "MOB", name: "Mobility / Core Reset", short: "Mobility",
        kind: "recovery", required: false, tone: "recovery",
        desc: "8–12 minutes: couch stretch, calves, figure-4, adductor rock-backs, pec + lat doorway work.",
        contrib: { coreMobility: 1 },
        stress: { push: 0, pull: 0, lower: 0, run: 0, hard: false },
        minMinutes: 10,
    },
    REC: {
        id: "REC", slot: "REC", name: "Film Room — Low-Stress Recovery", short: "Film Room",
        kind: "recovery", required: false, tone: "recovery",
        desc: "Walk, easy mobility, sleep. Recovery is programmed, not leftover — this is where the week's work becomes adaptation.",
        contrib: { recovery: 1, coreMobility: 1 },
        stress: { push: 0, pull: 0, lower: 0, run: 0, hard: false },
        minMinutes: 0,
    },
    /* Knee-flagged substitutes */
    XT1: {
        id: "XT1", slot: "QR1", name: "Route Speed — Low-Impact (bike / elliptical)", short: "Q1 · Routes XT",
        kind: "run", required: true, tone: "run", kneeSub: true,
        desc: "Same interval structure, zero impact. Preserves the aerobic stimulus while the knee settles.",
        contrib: { qualityRun: 1 },
        stress: { push: 0, pull: 0, lower: 1, run: 2, hard: true, hardRun: true },
        minMinutes: 25,
    },
    XT2: {
        id: "XT2", slot: "QR2", name: "Fourth Quarter — Low-Impact (bike / elliptical)", short: "Q2 · 4th XT",
        kind: "run", required: true, tone: "run", kneeSub: true,
        desc: "Controlled-hard effort without impact. The engine keeps building.",
        contrib: { qualityRun: 1 },
        stress: { push: 0, pull: 0, lower: 1, run: 2, hard: true, hardRun: true },
        minMinutes: 25,
    },
    BSAFE: {
        id: "BSAFE", slot: "B", name: "Workout B · Drive Day — Stage 1 Only (knee-safe)", short: "B · Drive Safe",
        kind: "strength", required: true, tone: "lower", kneeSub: true,
        desc: "Pain-free posterior chain only. No step-ups or primer until the knee is quiet.",
        contrib: { lowerAthletic: 1, coreMobility: 1 },
        stress: { push: 0, pull: 0, lower: 2, run: 0, hard: true },
        minMinutes: 15,
        variants: {
            60: [
                ["rdl", "3 × 6–8", "pain-free range"],
                ["hipThrust", "3 × 8–10", ""],
                ["hamCurl", "2–3 × 10–12", ""],
                ["calfRaise", "3 × 12–15", ""],
                ["tibRaise", "3 × 15–20", ""],
                ["bandWalk", "2 × 10–15/side", ""],
                ["pallof", "3 × 10/side", ""],
            ],
            40: [["rdl", "3 × 6–8", ""], ["hipThrust", "3 × 8–10", ""], ["hamCurl", "2 × 10–12", ""], ["calfRaise", "2 × 12–15", ""]],
            25: [["rdl", "3 × 6–8", ""], ["hipThrust", "3 × 8–10", ""], ["hamCurl", "2 × 10–12", ""]],
            15: [["rdl", "3 × 6–8", ""], ["hipThrust", "2 × 8–10", ""]],
        },
    },
    EASYXT: {
        id: "EASYXT", slot: "EASY", name: "Walkthrough — Incline Walk / Bike", short: "Walkthrough XT",
        kind: "run", required: true, tone: "easy", kneeSub: true,
        desc: "30–40 min conversational, zero impact.",
        contrib: { easyRun: 1 },
        stress: { push: 0, pull: 0, lower: 0, run: 1, hard: false },
        minMinutes: 25,
    },
    /* Calibration combine sessions (Aug 19–30) */
    CAL_UP: {
        id: "CAL_UP", slot: "CAL_UP", name: "Combine 1 — Upper Baselines", short: "Combine · Upper",
        kind: "cal", required: true, tone: "cal",
        desc: "Morning bodyweight + waist first. Then: controlled bench baseline (crisp set of 5, 2–3 in reserve), strict pull-up max, push-up max, explosive pull-up height.",
        contrib: {}, stress: { push: 3, pull: 2, lower: 0, run: 0, hard: true, bench: true },
        minMinutes: 25,
        calKeys: ["bodyweight", "waist", "benchBaseline", "pullupMax", "pushupMax", "exPullHeight"],
    },
    CAL_LOW: {
        id: "CAL_LOW", slot: "CAL_LOW", name: "Combine 2 — Lower Calibration", short: "Combine · Lower",
        kind: "cal", required: true, tone: "cal",
        desc: "Find Stage-1 working weights at 2–3 reps in reserve: RDL, hip thrust, hamstring curl, calf raise, tibialis. Check step-up tolerance. Optional broad jump only if fully pain-free.",
        contrib: {}, stress: { push: 0, pull: 0, lower: 3, run: 0, hard: true },
        minMinutes: 25,
        calKeys: ["rdl", "hipThrust", "hamCurl", "calfRaise", "tibRaise", "stepUp", "broadJump"],
    },
    CAL_TRACK: {
        id: "CAL_TRACK", slot: "CAL_TRACK", name: "Combine 3 — Track Measure + Easy Run", short: "Combine · Track",
        kind: "cal", required: true, tone: "cal",
        desc: "Measure the mezzanine track: laps per mile and usable straight length. Then 30–40 min easy with 2–3 relaxed strides on the straight.",
        contrib: { easyRun: 1 }, stress: { push: 0, pull: 0, lower: 1, run: 1, hard: false },
        minMinutes: 30,
        calKeys: ["trackLaps", "trackStraight"],
    },
    CAL_ACCA: {
        id: "CAL_ACCA", slot: "CAL_ACCA", name: "Combine 4 — Upper A Accessory Loads", short: "Combine · Acc A",
        kind: "cal", required: true, tone: "cal",
        desc: "Calibrate row, incline DB press, lateral raise, hammer curl, pressdown. Conservative load, low end of the rep range, 2–3 clean reps in reserve.",
        contrib: { biceps: 1, triceps: 1 }, stress: { push: 2, pull: 2, lower: 0, run: 0, hard: true },
        minMinutes: 25,
        calKeys: ["csRow", "inclineDb", "latRaise", "hammer", "pressdown"],
    },
    CAL_ACCC: {
        id: "CAL_ACCC", slot: "CAL_ACCC", name: "Combine 5 — Upper B Accessories + MU Trial", short: "Combine · Acc B",
        kind: "cal", required: true, tone: "cal",
        desc: "Calibrate pulldown, 1-arm row, DB overhead press, incline curl, overhead triceps, face pull. Finish with 2–3 band-assisted muscle-up transition trials — skill, not failure.",
        contrib: { explosivePull: 1, biceps: 1, triceps: 1 }, stress: { push: 2, pull: 3, lower: 0, run: 0, hard: true },
        minMinutes: 25,
        calKeys: ["pulldown", "cableRow1", "ohp", "incCurl", "ohTri", "facePull"],
    },
    PREP: {
        id: "PREP", slot: "PREP", name: "Preseason Prep — Mobility + Easy Movement", short: "Prep",
        kind: "recovery", required: false, tone: "recovery",
        desc: "Combine opens Wednesday, Aug 19. Today: 8–12 min mobility, easy walk or light spin. Arrive fresh.",
        contrib: { coreMobility: 1, recovery: 1 }, stress: { push: 0, pull: 0, lower: 0, run: 0, hard: false },
        minMinutes: 0,
    },
};
/* Weekly training budget — September (V3). Later months adjust at review. */
const BUDGET_DEF = [
    { key: "upperStrength", label: "Upper strength", min: 1, target: 2 },
    { key: "benchExposure", label: "Bench exposures", min: 1, target: 2 },
    { key: "lowerAthletic", label: "Primary lower", min: 1, target: 1 },
    { key: "qualityRun", label: "Quality running", min: 1, target: 2 },
    { key: "easyRun", label: "Easy aerobic", min: 1, target: 1 },
    { key: "explosivePull", label: "Muscle-up / expl. pull", min: 1, target: 2 },
    { key: "biceps", label: "Direct biceps", min: 1, target: 2 },
    { key: "triceps", label: "Direct triceps", min: 1, target: 2 },
    { key: "coreMobility", label: "Core / mobility", min: 2, target: 3 },
    { key: "recovery", label: "Low-stress recovery", min: 1, target: 1 },
    { key: "athleticMicrodose", label: "Athletic microdose", min: 0, target: 1, optional: true },
];
/* Priority ladder when the week compresses. Minimums beat bonuses; A is never auto-dropped. */
const PRIORITY = ["A", "QR1", "B", "C", "QR2", "EASY", "D"];
const DROP_ORDER = ["D", "EASY", "QR2", "C", "B", "QR1"];
const KNEE_ALT = { QR1: "XT1", QR2: "XT2", B: "BSAFE", EASY: "EASYXT" };
const SLOT_OF = {}; // XT1 -> QR1 etc.
Object.values(SESSIONS).forEach((s) => { SLOT_OF[s.id] = s.slot; });
/* September running prescriptions (time + effort, not lap counts) */
const RUN_RX = {
    1: { QR1: "6 × 90 s strong / 90 s easy", QR2: "2 × 8 min controlled-hard / 2 min easy", EASY: "35–45 min conversational" },
    2: { QR1: "5 × 2 min strong / 2 min easy", QR2: "18 min continuous controlled-hard", EASY: "40–50 min conversational" },
    3: { QR1: "4 × 3 min strong / 2 min easy", QR2: "3 × 7 min / 2 min easy", EASY: "40–55 min conversational" },
    4: { QR1: "8 × 45 s fast-relaxed / 75 s easy", QR2: "3-mile progression by effort (knee good)", EASY: "35–45 min conversational" },
    review: { QR1: "Optional light sharpening only", QR2: "Monthly review week — no mandatory max-out", EASY: "30–40 min conversational" },
    cal: { QR1: "—", QR2: "—", EASY: "30–40 min conversational + 2–3 relaxed strides" },
    fallback: { QR1: "Week-3 pattern: 4 × 3 min strong / 2 min easy (finalized at month review)", QR2: "3 × 7 min / 2 min easy (finalized at month review)", EASY: "40–55 min conversational" },
};
const ACCEL_ADDON = "Optional acceleration add-on (knee healthy): 4–6 × 8–12 s at 70–85% on the straight only. Walk back fully. Stop well before the turn. Never sprint maximally into a curve.";
const EFFORT_GUIDE = "Easy = full conversation. Threshold = hard but controlled (~35–50 min sustainable when fresh). Strong intervals = faster than threshold, never an all-out sprint.";
/* Mobility blocks (collapsible in UI) */
const MOBILITY_BLOCKS = [
    { id: "upWarm", title: "Upper warm-up · 5–6 min", body: "2 min easy cardio → band pull-aparts 2 × 10 → scapular push-ups 1 × 10 → cable/band external rotation 1 × 12/side → 2–4 ramp-up sets before bench." },
    { id: "runWarm", title: "Run warm-up · 8–10 min", body: "Easy jog 5–6 min → leg swings 10 each direction/side → ankle rocks 10/side → walking lunges only if pain-free → A-march or A-skip 2 × 15–20 yd → 2–3 progressive relaxed strides when space permits." },
    { id: "postMob", title: "Post-session mobility · 8 min", body: "Couch stretch 30–45 s/side → calf stretch 30–45 s/side → figure-4 glute 30–45 s/side → adductor rock-back 8/side → doorway pec 30 s/side → lat stretch 30 s/side." },
    { id: "deskReset", title: "Desk-day reset · 4 min", body: "Neck circles 5/direction → thoracic rotations 8/side → standing hip-flexor stretch 30 s/side → wrist circles + doorway pec 30 s. Twice on long desk days." },
];
/* Knee progression ladder (V3) */
const KNEE_LADDER = [
    { stage: 1, name: "Capacity", when: "Starting point / knee uncertain", moves: "Hip thrust or glute bridge · RDL · hamstring curl · calf raise · tibialis raise · lateral band walk · pain-free step-up or isometric" },
    { stage: 2, name: "Landing", when: "Stage 1 well tolerated", moves: "Snap-down landing · low pogo contacts · low box step-off landing · single-leg balance" },
    { stage: 3, name: "Power", when: "No adverse knee response", moves: "Small broad jump or low box jump · low-volume lateral bound with stick · med-ball throws" },
    { stage: 4, name: "Speed / COD", when: "Only after prior stages tolerate well", moves: "Short accelerations · faster strides · gradual deceleration and change-of-direction work" },
];
/* Phase metadata for the roadmap */
const PHASES = {
    pre: { chip: "PRESEASON", title: "Preseason", color: "var(--dim)" },
    cal: { chip: "PRESEASON · COMBINE", title: "Calibration Combine", color: "var(--accent)" },
    sep: { chip: "SEPTEMBER · FOUNDATION", title: "Foundation", color: "var(--accent)" },
    oct: { chip: "OCTOBER · BUILD", title: "Build", color: "var(--accent)" },
    nov: { chip: "NOVEMBER · INTENSIFY", title: "Intensify", color: "var(--warn)" },
    dec: { chip: "DECEMBER · PEAK + TEST", title: "Peak + Test", color: "var(--good)" },
    post: { chip: "BLOCK COMPLETE", title: "Complete", color: "var(--good)" },
};
const ROADMAP = [
    { key: "sep", month: "September", theme: "FOUNDATION", range: "Sep 1 – 30",
        perf: "Three-run target weeks without knee worsening. Repeatable interval + threshold rhythm. Low-level acceleration mechanics.",
        body: "Bench technique and frequency established · explosive pull-ups · pain-free lower-body pattern · routine that survives the job." },
    { key: "oct", month: "October", theme: "BUILD", range: "Oct 1 – 31",
        perf: "Longer threshold work. Intervals progress toward 5K pace. More acceleration only if September's knee response earned it.",
        body: "Bench working weights clearly higher · 16–18+ pull-ups plausible · stronger back, shoulders and arms · muscle-up transition progress." },
    { key: "nov", month: "November", theme: "INTENSIFY", range: "Nov 1 – 30",
        perf: "Race-specific 5K work around goal demands. Faster mile-oriented reps. High-quality power over extra volume.",
        body: "Heavier bench triples/singles without grinders · chest-high explosive pulls · first clean muscle-up attempts." },
    { key: "dec", month: "December", theme: "PEAK + TEST", range: "Dec 1 – 31",
        perf: "Freshen, sharpen, then test the mile and 5K. Retest speed/agility only if the knee is healthy.",
        body: "Test: 225 bench stretch goal · 20+ pull-ups · muscle-up · physique, waist and bodyweight check." },
];
const GOALS = [
    { key: "mile", label: "Mile", start: "5:57", target: "5:30", unit: "time", targetSec: 330, startSec: 357 },
    { key: "fiveK", label: "5K", start: "21:55", target: "Sub-20:00", unit: "time", targetSec: 1200, startSec: 1315 },
    { key: "bench", label: "Bench", start: "135 × ~10", target: "225 × 1 (stretch)", unit: "lb", targetVal: 225 },
    { key: "pullup", label: "Pull-ups", start: "~15 strict", target: "20+ strict", unit: "reps", targetVal: 20, startVal: 15 },
    { key: "mu", label: "Muscle-up", start: "Not yet", target: "1 clean bar MU", unit: "bool" },
    { key: "bw", label: "Bodyweight", start: "~158 lb", target: "163–168 lean", unit: "lb", bandLo: 163, bandHi: 168, startVal: 158 },
    { key: "abs", label: "Physique", start: "Lean baseline", target: "Clear abdominal definition", unit: "note" },
    { key: "speed", label: "Speed / agility", start: "Baseline TBD", target: "Meaningful gain, knee intact", unit: "note" },
];
/* Combine checklist item metadata (non-exercise entries) */
const CAL_BASELINES = [
    { key: "bodyweight", label: "Morning bodyweight", unit: "lb", seed: "158" },
    { key: "waist", label: "Waist at navel", unit: "in", seed: "" },
    { key: "mile", label: "Mile baseline", unit: "mm:ss", seed: "5:57", locked: true },
    { key: "fiveK", label: "5K baseline", unit: "mm:ss", seed: "21:55", locked: true },
    { key: "benchBaseline", label: "Controlled bench baseline (weight × reps)", unit: "e.g. 145 × 5", seed: "" },
    { key: "pullupMax", label: "Strict pull-up max", unit: "reps", seed: "15" },
    { key: "pushupMax", label: "Push-up max", unit: "reps", seed: "" },
    { key: "exPullHeight", label: "Explosive pull height", unit: "e.g. mid-chest to bar", seed: "" },
    { key: "trackLaps", label: "Track laps per mile", unit: "laps", seed: "" },
    { key: "trackStraight", label: "Usable straight length", unit: "yd", seed: "" },
    { key: "broadJump", label: "Broad jump (only if pain-free)", unit: "in", seed: "" },
];
const CAL_RULE = "Choose a conservative load. Perform the low end of the rep range. Right weight leaves ~2–3 clean reps in reserve. 5+ left → go up. 0–1 left → come down. Never calibrate to failure.";
/* ===================== TRAINER-BRAIN STIMULUS MODEL ===================== */
const EXERCISE_CREDITS = {
    benchA: ["upperStrength", "benchExposure"], benchC: ["upperStrength", "benchExposure"],
    pullup: ["upperStrength"], csRow: ["upperStrength"], pulldown: ["upperStrength"], cableRow1: ["upperStrength"], ohp: ["upperStrength"],
    exPull: ["upperStrength", "explosivePull"], muTrans: ["explosivePull"],
    hammer: ["biceps"], incCurl: ["biceps"], pressdown: ["triceps"], ohTri: ["triceps"],
    kneeRaise: ["coreMobility"], pallof: ["coreMobility"], abWheel: ["coreMobility"],
    rdl: ["lowerAthletic"], hipThrust: ["lowerAthletic"], hamCurl: ["lowerAthletic"], stepUp: ["lowerAthletic"],
    farmer: ["athleticMicrodose"], ssRdl: ["athleticMicrodose"], calfRaise: ["athleticMicrodose"], tibRaise: ["athleticMicrodose"], bandWalk: ["athleticMicrodose"],
    easyAerobic20: ["easyRun"],
};
/* Anchor sessions are templates, not body-part days. The planner may attach
   compatible micro-modules to close real weekly gaps without creating junk
   volume or breaking recovery. */
const FLEX_MODULES = {
    pullSkill: {
        id: "pullSkill", label: "Pull-up / muscle-up microdose", minutes: 8,
        add: [["exPull", "3 × 3", "fast, crisp reps"], ["pullup", "2 × 5–8", "strict; stop well before failure"]],
        credits: ["explosivePull", "upperStrength"], fatigueAreas: ["back", "biceps"],
    },
    arms: {
        id: "arms", label: "Arms microdose", minutes: 8,
        add: [["hammer", "2 × 10–12", "clean reps"], ["pressdown", "2 × 10–12", "clean reps"]],
        credits: ["biceps", "triceps"], fatigueAreas: ["biceps", "triceps"],
    },
    lowerCapacity: {
        id: "lowerCapacity", label: "Lower-capacity microdose", minutes: 8,
        add: [["calfRaise", "2 × 12–15", "controlled"], ["tibRaise", "2 × 15–20", "controlled"], ["bandWalk", "2 × 10/side", "hip stability"]],
        credits: ["athleticMicrodose"], fatigueAreas: ["calves", "glutes"],
    },
    easyAerobic: {
        id: "easyAerobic", label: "Easy aerobic add-on", minutes: 18,
        add: [["easyAerobic20", "15–20 min", "full-conversation pace after lifting"]],
        credits: ["easyRun"], fatigueAreas: ["quads", "hamstrings", "calves"],
    },
};
function mergeDayOverrides(autoOverride, userOverride) {
    const a = autoOverride || {};
    const u = userOverride || {};
    const rem = Array.from(new Set([...(a.remove || []), ...(u.remove || [])]));
    const seen = new Set();
    const add = [...(a.add || []), ...(u.add || [])].filter((x) => {
        const id = x && x.id ? x.id : Array.isArray(x) ? x[0] : null;
        if (!id || seen.has(id))
            return false;
        seen.add(id);
        return true;
    }).map((x) => Array.isArray(x) ? { id: x[0], sr: x[1], note: x[2] } : x);
    return {
        ...a, ...u,
        tier: u.tier || a.tier,
        remove: rem,
        add,
        runOverride: u.runOverride || a.runOverride,
        reason: [a.reason, u.reason].filter(Boolean).join(" "),
        modules: [...(a.modules || []), ...(u.modules || [])],
    };
}
function entryDidAny(entry, ids) {
    if (!entry || (entry.status !== "completed" && entry.status !== "partial"))
        return false;
    const done = new Set(entry.exercisesCompleted || []);
    return (ids || []).some((id) => done.has(id));
}
const SESSION_FATIGUE_AREAS = {
    A: ["chest", "shoulders", "triceps", "back", "biceps"],
    C: ["back", "biceps", "shoulders", "triceps", "chest"],
    CPULL: ["back", "biceps", "triceps"],
    B: ["hamstrings", "glutes", "quads", "calves"],
    BRED: ["hamstrings", "glutes", "calves"],
    D: ["hamstrings", "glutes", "calves", "core"],
    QR1: ["quads", "hamstrings", "glutes", "calves"], QR2: ["quads", "hamstrings", "glutes", "calves"],
    XT1: ["quads", "hamstrings", "glutes"], XT2: ["quads", "hamstrings", "glutes"],
    EASY: ["quads", "hamstrings", "calves"], EASYXT: ["quads", "hamstrings"],
};
const FATIGUE_AREAS = ["chest", "shoulders", "triceps", "back", "biceps", "quads", "hamstrings", "glutes", "calves", "core"];
const FEEL_RPE = { "Very Easy": 4, Easy: 5, Good: 7, Appropriate: 7, Hard: 8.5, "Very Hard": 9.5 };
function normalizeFatigueLevel(v) {
    if (typeof v === "string") {
        const q = v.toLowerCase();
        if (q === "high" || q === "very high" || q === "severe")
            return 3;
        if (q === "moderate" || q === "medium")
            return 2;
        if (q === "low" || q === "mild")
            return 1;
        if (q === "none" || q === "good")
            return 0;
    }
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : 0;
}
function fatigueLevelAt(fatigue, area, dateStr) {
    if (!fatigue)
        return 0;
    const rec = area === "systemic" ? fatigue.systemic : ((fatigue.areas || {})[area]);
    if (!rec || !rec.date)
        return 0;
    const elapsed = Math.max(0, daysBetween(rec.date, dateStr));
    // Simple coaching heuristic: high -> moderate -> low -> gone across ~72h unless the user reports continued fatigue.
    return Math.max(0, normalizeFatigueLevel(rec.level) - elapsed);
}
function maxAreaFatigue(fatigue, areas, dateStr) {
    return Math.max(0, ...(areas || []).map((a) => fatigueLevelAt(fatigue, a, dateStr)));
}
function fatiguePenaltyForSession(sessionId, dateStr, fatigue) {
    const local = maxAreaFatigue(fatigue, SESSION_FATIGUE_AREAS[sessionId] || [], dateStr);
    const sys = fatigueLevelAt(fatigue, "systemic", dateStr);
    return local * 2 + sys * 2;
}
function creditsFromExercises(exerciseIds) {
    const out = {};
    (exerciseIds || []).forEach((id) => (EXERCISE_CREDITS[id] || []).forEach((k) => { out[k] = 1; }));
    return out;
}
function entryCredits(entry) {
    const sess = SESSIONS[entry.sessionId];
    if (!sess)
        return {};
    if (entry.manualContrib)
        return { ...entry.manualContrib };
    const out = {};
    const slot = SLOT_OF[entry.sessionId];
    // Running credit is independent from any strength micro-modules attached to the day.
    if (sess.kind === "run") {
        if (slot === "QR1" || slot === "QR2") {
            const f = entry.completionFraction == null ? (entry.status === "completed" ? 1 : 0) : Number(entry.completionFraction);
            if (f >= .6)
                out.qualityRun = 1;
            else if (f > 0)
                out.qualityRun = .5;
        }
        else if (slot === "EASY") {
            const f = entry.completionFraction == null ? (entry.status === "completed" ? 1 : 0) : Number(entry.completionFraction);
            if (f >= .6 || (entry.runDuration || 0) >= 20)
                out.easyRun = 1;
            else if (f > 0 || (entry.runDuration || 0) > 0)
                out.easyRun = .5;
        }
    }
    if (Array.isArray(entry.exercisesCompleted)) {
        const ex = creditsFromExercises(entry.exercisesCompleted);
        Object.entries(ex).forEach(([k, v]) => { out[k] = Math.max(out[k] || 0, v); });
        if (entry.extras && entry.extras.explosivePrimer)
            out.explosivePull = 1;
        if (entry.extras && entry.extras.cbSkill)
            out.coreMobility = Math.max(out.coreMobility || 0, 1);
        if (slot === "D" && entry.exercisesCompleted.length)
            out.athleticMicrodose = 1;
        if (Object.keys(out).length || sess.kind === "strength")
            return out;
    }
    if (entry.status === "partial")
        return out;
    return { ...out, ...(sess.contrib || {}) }; // legacy/full-session fallback
}
function entrySatisfiesSlot(entry) {
    if (!entry)
        return false;
    if (entry.status === "completed")
        return true;
    if (entry.status !== "partial")
        return false;
    const ids = new Set(entry.exercisesCompleted || []);
    const slot = SLOT_OF[entry.sessionId];
    if (slot === "A")
        return ids.has("benchA");
    if (slot === "B")
        return ids.has("rdl") || ids.has("hipThrust");
    if (slot === "C")
        return ids.has("exPull") || ids.has("muTrans") || ids.has("pulldown");
    if (slot === "D")
        return ids.size > 0;
    if (slot === "QR1" || slot === "QR2")
        return (entry.completionFraction || 0) >= .6;
    if (slot === "EASY")
        return (entry.duration || 0) >= 20;
    return false;
}
function applyFatigueRecord(fatigue, area, level, date, note) {
    const next = { areas: { ...((fatigue && fatigue.areas) || {}) }, systemic: fatigue && fatigue.systemic ? { ...fatigue.systemic } : null };
    const rec = { level: normalizeFatigueLevel(level), date, note: note || "" };
    if (area === "systemic")
        next.systemic = rec;
    else if (FATIGUE_AREAS.includes(area))
        next.areas[area] = rec;
    return next;
}
function applySessionFeelFatigue(fatigue, sessionId, date, feel) {
    const rpe = FEEL_RPE[feel] || 0;
    if (rpe < 8)
        return fatigue;
    let next = fatigue || { areas: {}, systemic: null };
    const level = rpe >= 9 ? 3 : 2;
    (SESSION_FATIGUE_AREAS[sessionId] || []).forEach((a) => { next = applyFatigueRecord(next, a, level, date, "session felt " + String(feel).toLowerCase()); });
    if (rpe >= 9)
        next = applyFatigueRecord(next, "systemic", 2, date, "very hard session");
    return next;
}
function adaptiveSessionId(slotId, dateStr, knee, fatigue, idOn) {
    let id = knee === "irritated" && KNEE_ALT[slotId] ? KNEE_ALT[slotId] : slotId;
    if (slotId === "C" && id === "C") {
        const pushFatigue = Math.max(fatigueLevelAt(fatigue, "chest", dateStr), fatigueLevelAt(fatigue, "shoulders", dateStr), fatigueLevelAt(fatigue, "triceps", dateStr));
        const yesterday = idOn(addDays(dateStr, -1));
        if (pushFatigue >= 2 || SLOT_OF[yesterday] === "A")
            id = "CPULL";
    }
    if (slotId === "B" && id === "B") {
        const lowerFatigue = maxAreaFatigue(fatigue, ["hamstrings", "glutes", "quads", "calves"], dateStr);
        if (lowerFatigue === 2)
            id = "BRED";
    }
    return id;
}
function expectedCreditsForPlannedSession(sessionId, minutes) {
    const sess = SESSIONS[sessionId];
    if (!sess)
        return {};
    const out = { ...(sess.contrib || {}) };
    if (sess.variants) {
        const tier = snapTier(minutes == null ? 60 : minutes);
        const rows = sess.variants[tier] || sess.variants[60] || [];
        const ex = creditsFromExercises(rows.map((r) => r[0]));
        Object.entries(ex).forEach(([k, v]) => { out[k] = Math.max(out[k] || 0, v); });
    }
    return out;
}
function buildAutoFlexOverrides(assign, dayInfo, weekDates, doneNow, avail, fatigue, knee) {
    const ov = {};
    const projected = { ...doneNow };
    Object.entries(assign).forEach(([d, a]) => {
        const credits = expectedCreditsForPlannedSession(a.id, avail(d));
        Object.entries(credits).forEach(([k, v]) => { projected[k] = Math.max(projected[k] || 0, v); });
    });
    const need = (k) => { const def = BUDGET_DEF.find((b) => b.key === k); return def && (projected[k] || 0) < def.target; };
    const canUseModule = (m, d) => maxAreaFatigue(fatigue, m.fatigueAreas || [], d) < 2 && fatigueLevelAt(fatigue, "systemic", d) < 2;
    const addModule = (d, module, reason) => {
        if (!ov[d])
            ov[d] = { add: [], modules: [], reason: "" };
        module.add.forEach((r) => ov[d].add.push({ id: r[0], sr: r[1], note: r[2] }));
        ov[d].modules.push(module.id);
        ov[d].reason = [ov[d].reason, reason].filter(Boolean).join(" ");
        module.credits.forEach((k) => { projected[k] = Math.max(projected[k] || 0, 1); });
    };
    for (const d of weekDates) {
        if (!assign[d] || (dayInfo[d] && (dayInfo[d].status === "completed" || dayInfo[d].status === "partial")))
            continue;
        const sid = assign[d].id;
        const slot = SLOT_OF[sid];
        const mins = avail(d);
        const prevEntry = dayInfo[addDays(d, -1)] && dayInfo[addDays(d, -1)].entry;
        // Easy days are prime mixing territory: aerobic stays easy, upper micro-work can fill real gaps.
        if (slot === "EASY" && mins >= 35) {
            let mixed = false;
            if (need("explosivePull") && canUseModule(FLEX_MODULES.pullSkill, d) && !entryDidAny(prevEntry, ["pullup", "exPull", "muTrans", "hammer", "incCurl"])) {
                addModule(d, FLEX_MODULES.pullSkill, "Mixed day: easy aerobic plus a short pull-skill microdose closes an outstanding goal without turning this into a hard day.");
                mixed = true;
            }
            if ((need("biceps") || need("triceps")) && canUseModule(FLEX_MODULES.arms, d) && !entryDidAny(prevEntry, ["hammer", "incCurl", "pressdown", "ohTri", "benchA", "inclineDb", "ohp"])) {
                addModule(d, FLEX_MODULES.arms, "A short arms block is attached because direct arm work is still outstanding and recovery permits it.");
                mixed = true;
            }
            if (need("athleticMicrodose") && knee !== "irritated" && canUseModule(FLEX_MODULES.lowerCapacity, d) && mins >= 50) {
                addModule(d, FLEX_MODULES.lowerCapacity, "Low-fatigue ankle/hip capacity rides with the easy day instead of consuming another full training day.");
                mixed = true;
            }
            if (mixed)
                ov[d].runOverride = mins >= 50 ? "25–35 min conversational + listed micro-modules" : "20–30 min conversational + listed micro-modules";
        }
        // A recovered upper day may trade some accessory time for easy aerobic volume.
        if ((slot === "C") && need("easyRun") && mins >= 55 && canUseModule(FLEX_MODULES.easyAerobic, d)) {
            const nextSid = assign[addDays(d, 1)] && assign[addDays(d, 1)].id;
            if (!(nextSid && SESSIONS[nextSid] && SESSIONS[nextSid].stress.hardRun)) {
                if (!ov[d])
                    ov[d] = { add: [], modules: [], reason: "" };
                ov[d].tier = Math.min(40, mins >= 40 ? 40 : 25);
                addModule(d, FLEX_MODULES.easyAerobic, "Mixed day: the upper session is condensed and finished with easy aerobic work because that stimulus is still missing.");
            }
        }
        // Optional athletic day can absorb small upper deficits rather than creating another separate gym day.
        if (slot === "D" && mins >= 35) {
            if (need("biceps") || need("triceps")) {
                if (canUseModule(FLEX_MODULES.arms, d))
                    addModule(d, FLEX_MODULES.arms, "Special Teams absorbs a small arm deficit instead of creating a separate body-part day.");
            }
            if (need("explosivePull") && mins >= 45 && canUseModule(FLEX_MODULES.pullSkill, d)) {
                addModule(d, FLEX_MODULES.pullSkill, "Special Teams also carries a short pull-skill exposure because it is still outstanding.");
            }
        }
    }
    return ov;
}
/* ===================== 4. SCHEDULING ENGINE (pure JS) ===================== */
/* No React below this line until ENGINE-END. The engine answers one question:
   "What is the highest-value safe thing to do today, given the 4-month goals
    and what has already been done this week?"                               */
function entriesByDateFn(log) {
    const m = {};
    for (const e of log) {
        const cur = m[e.date];
        const rank = (st) => (st === "completed" ? 3 : st === "partial" ? 2 : st === "skipped" ? 1 : 0);
        if (!cur || rank(e.status) >= rank(cur.status) || (rank(e.status) === rank(cur.status) && (e.ts || 0) > (cur.ts || 0)))
            m[e.date] = e;
    }
    return m;
}
function weekBudgetState(log, ws) {
    const done = {};
    BUDGET_DEF.forEach((b) => { done[b.key] = 0; });
    for (const e of log) {
        if (e.status !== "completed" && e.status !== "partial")
            continue;
        if (weekStartOf(e.date) !== ws)
            continue;
        const credits = entryCredits(e);
        Object.entries(credits).forEach(([k, v]) => { done[k] = (done[k] || 0) + v; });
    }
    return done;
}
function calibrationRemaining(log) {
    const doneSlots = new Set(log.filter((e) => e.status === "completed").map((e) => SLOT_OF[e.sessionId]));
    return ["CAL_UP", "CAL_LOW", "CAL_TRACK", "CAL_ACCA", "CAL_ACCC"].filter((id) => !doneSlots.has(id));
}
function weekTemplate(effPhase, log) {
    if (effPhase === "cal" || effPhase === "pre") {
        const undone = calibrationRemaining(log);
        return { required: [...undone.slice(0, 3), "EASY"], optional: [], calMode: true };
    }
    return { required: ["A", "QR1", "B", "C", "QR2", "EASY"], optional: ["D"], calMode: false };
}
function runRxFor(dateStr, slot) {
    const ph = phaseOf(dateStr);
    if (ph === "cal" || ph === "pre")
        return RUN_RX.cal[slot] || RUN_RX.cal.EASY;
    if (ph === "sep") {
        const w = sepWeekIndex(dateStr);
        return (RUN_RX[w] || RUN_RX.fallback)[slot];
    }
    return RUN_RX.fallback[slot];
}
function workloadPct(done) {
    let num = 0, den = 0;
    for (const b of BUDGET_DEF) {
        if (b.optional)
            continue;
        num += Math.min(done[b.key] || 0, b.target);
        den += b.target;
    }
    return den ? Math.round((100 * num) / den) : 0;
}
function weekMessage(pct, skipped, calMode) {
    if (calMode) {
        return skipped > 0
            ? "A missed combine day just moves — the baselines still get captured this week."
            : "Combine week: capture baselines fresh. No heroics required.";
    }
    if (skipped > 0)
        return "You missed " + skipped + " day" + (skipped > 1 ? "s" : "") + ", but you are still " + pct + "% through this week's target workload. The plan already reflowed.";
    if (pct >= 100)
        return "Weekly target workload fully banked. Anything else is bonus.";
    return pct + "% of this week's target workload banked. Win the block, not the day.";
}
function buildReasons(slotId, rid, d, ctx2) {
    const r = [];
    const s = SESSIONS[rid];
    const pr = PRIORITY.indexOf(slotId);
    if (ctx2.tplCal) {
        r.push("Combine session — establishes the baselines September is built on.");
    }
    else if (pr === 0) {
        r.push("Top of the priority ladder: the main bench exposure anchors the week.");
    }
    else if (pr >= 0) {
        r.push("Highest-value outstanding exposure (priority " + (pr + 1) + " of " + PRIORITY.length + ").");
    }
    const prev = ctx2.idOn(addDays(d, -1));
    if (prev && SESSIONS[prev]) {
        const ps = SESSIONS[prev];
        if (s.stress.hardRun && !ps.stress.hardRun)
            r.push("Yesterday: " + ps.short + " — legs are clear for quality running.");
        else if (s.stress.bench && !ps.stress.bench)
            r.push("No pressing yesterday (" + ps.short + ") — bench arrives fresh.");
        else
            r.push("Follows " + ps.short + " without a fatigue conflict.");
    }
    else {
        r.push("Fresh day — no conflicting fatigue in front of it.");
    }
    if (rid !== slotId && s.kneeSub)
        r.push("Knee flagged — swapped to a pain-free version that keeps the stimulus.");
    if (rid === "CPULL")
        r.push("Pressing fatigue is still live — pull-only C keeps progress without stacking more pressing.");
    if (rid === "BRED")
        r.push("Lower-body fatigue is moderate — reduced B preserves the stimulus without forcing full volume.");
    if (fatigueLevelAt(ctx2.fatigue, "systemic", d) >= 2)
        r.push("Recent whole-body fatigue is still being respected in today's dose.");
    if (ctx2.relaxed)
        r.push("Tight week: back-to-back quality days accepted deliberately, not by accident.");
    if (s.stress.hardRun) {
        const other = Object.keys(ctx2.assign).find((k) => k !== d && SESSIONS[ctx2.assign[k].id] && SESSIONS[ctx2.assign[k].id].stress.hardRun);
        if (other)
            r.push("Spaced from " + fmtShort(other) + "'s hard session — ~48 h when practical.");
    }
    return r.slice(0, 3);
}
function planWeek(ctx) {
    const { today, log } = ctx;
    const settings = ctx.settings || {};
    const knee = ctx.knee || "good";
    const pins = ctx.pins || {};
    const dayFlags = ctx.dayFlags || {};
    const fatigue = ctx.fatigue || { areas: {}, systemic: null };
    const ws = weekStartOf(today);
    const weekDates = [];
    for (let i = 0; i < 7; i++)
        weekDates.push(addDays(ws, i));
    const byDate = entriesByDateFn(log);
    const effPhase = phaseOf(addDays(ws, 3));
    const phase = phaseOf(today);
    const dayInfo = {};
    for (const d of weekDates) {
        const e = byDate[d];
        if (e && (e.status === "completed" || e.status === "partial"))
            dayInfo[d] = { id: e.sessionId, status: e.status, reasons: [], entry: e };
        else if (e && e.status === "skipped")
            dayInfo[d] = { id: e.sessionId, status: "skipped", reasons: [], entry: e };
        else if (d < today)
            dayInfo[d] = { id: null, status: "past", reasons: [] };
    }
    const tpl = weekTemplate(effPhase, log);
    const doneSlotCount = {};
    for (const d of weekDates) {
        const di = dayInfo[d];
        if (di && (di.status === "completed" || di.status === "partial") && entrySatisfiesSlot(di.entry)) {
            const sl = SLOT_OF[di.id];
            doneSlotCount[sl] = (doneSlotCount[sl] || 0) + 1;
        }
    }
    let required = tpl.required.filter((id) => !(doneSlotCount[SLOT_OF[id]] > 0));
    const notes = [];
    if (!tpl.calMode) {
        const prevWs = addDays(ws, -7);
        const prevDone = weekBudgetState(log, prevWs);
        const anyPrev = log.some((e) => weekStartOf(e.date) === prevWs && (e.status === "completed" || e.status === "partial"));
        const anyPrevPhase = phaseOf(addDays(prevWs, 3));
        const carries = [];
        if (anyPrev && anyPrevPhase !== "cal" && anyPrevPhase !== "pre") {
            if ((prevDone.upperStrength || 0) < 1 && required.includes("A"))
                carries.push("A");
            if ((prevDone.qualityRun || 0) < 1 && required.includes("QR1"))
                carries.push("QR1");
            if ((prevDone.lowerAthletic || 0) < 1 && required.includes("B"))
                carries.push("B");
        }
        if (carries.length) {
            required = [...carries, ...required.filter((id) => !carries.includes(id))];
            notes.push("Missed minimums from last week are front-loaded: " + carries.map((id) => SESSIONS[id].short).join(", ") + ".");
        }
    }
    const avail = (d) => {
        const wm = settings.weekdayMinutes || {};
        const v = wm[dowMon0(d)];
        return v == null ? 60 : v;
    };
    const plannable = weekDates.filter((d) => d >= today && !byDate[d] && dayFlags[d] !== "exhausted");
    const dropped = [];
    const usable = plannable.filter((d) => avail(d) >= 15);
    let maxReq = Math.max(0, usable.length - 1);
    if (usable.length <= 1)
        maxReq = usable.length;
    if (required.length > maxReq) {
        for (const dropId of DROP_ORDER) {
            if (required.length <= maxReq)
                break;
            const ix = required.indexOf(dropId);
            if (ix >= 0) {
                required.splice(ix, 1);
                dropped.push({ id: dropId, reason: "Week compressed — protected recovery instead of cramming." });
            }
        }
        while (required.length > maxReq && required.length > 0) {
            const cut = required.pop();
            dropped.push({ id: cut, reason: "Not enough safe days left this week." });
        }
    }
    const assign = {};
    const idOn = (d) => {
        if (assign[d])
            return assign[d].id;
        const di = dayInfo[d];
        return di && (di.status === "completed" || di.status === "partial") ? di.id : null;
    };
    const sMeta = (id) => (id ? SESSIONS[id] : null);
    const isHardRunId = (id) => { const s = sMeta(id); return !!(s && s.stress && s.stress.hardRun); };
    const isLowerHeavyId = (id) => { const s = sMeta(id); return !!(s && s.stress && s.stress.lower >= 2 && !s.stress.hardRun); };
    const isBenchId = (id) => { const s = sMeta(id); return !!(s && s.stress && s.stress.bench); };
    const isHardId = (id) => { const s = sMeta(id); return !!(s && s.stress && s.stress.hard); };
    function violations(d, id, relax) {
        const prev = idOn(addDays(d, -1));
        const next = idOn(addDays(d, 1));
        const prev2 = idOn(addDays(d, -2));
        const v = [];
        if (isHardRunId(id) && (isHardRunId(prev) || isHardRunId(next)))
            v.push("runAdj");
        if (isHardRunId(id) && isLowerHeavyId(prev))
            v.push("lowerBeforeRun");
        if (isLowerHeavyId(id) && isHardRunId(next))
            v.push("lowerBeforeRun");
        if (isBenchId(id) && (isBenchId(prev) || isBenchId(next)))
            v.push("benchAdj");
        const prevEntry = byDate[addDays(d, -1)];
        if (isBenchId(id) && entryDidAny(prevEntry, ["pressdown", "ohTri"]))
            v.push("directTricepsBeforeBench");
        if (!relax.includes("threeHard") && isHardId(id) && isHardId(prev) && isHardId(prev2))
            v.push("threeHard");
        if (isHardId(id) && fatigueLevelAt(fatigue, "systemic", d) >= 3)
            v.push("systemicFatigue");
        if (isHardId(id) && maxAreaFatigue(fatigue, SESSION_FATIGUE_AREAS[id] || [], d) >= 3)
            v.push("localFatigue");
        return v;
    }
    for (const pd of Object.keys(pins)) {
        const slotId = pins[pd];
        if (weekStartOf(pd) !== ws)
            continue;
        if (pd < today)
            continue;
        if (byDate[pd])
            continue;
        const ix = required.indexOf(slotId);
        if (ix < 0)
            continue;
        const rid = adaptiveSessionId(slotId, pd, knee, fatigue, idOn);
        if (avail(pd) < Math.max(15, (SESSIONS[rid] && SESSIONS[rid].minMinutes) || 15))
            continue;
        assign[pd] = { id: rid, reasons: ["Pinned here by you."], pinned: true };
        required.splice(ix, 1);
    }
    for (const slotId of [...required]) {
        let best = null;
        for (const relax of [[], ["threeHard"]]) {
            for (let i = 0; i < plannable.length; i++) {
                const d = plannable[i];
                if (assign[d])
                    continue;
                if (avail(d) < 15)
                    continue;
                const rid = adaptiveSessionId(slotId, d, knee, fatigue, idOn);
                if (tpl.calMode && SESSIONS[rid].kind === "cal" && d < CAL_START)
                    continue;
                const v = violations(d, rid, relax);
                if (v.length)
                    continue;
                let score = i + fatiguePenaltyForSession(rid, d, fatigue);
                if (slotId === "QR2") {
                    const otherRun = Object.keys(assign).find((k) => isHardRunId(assign[k].id)) ||
                        weekDates.find((k) => { const di = dayInfo[k]; return di && (di.status === "completed" || di.status === "partial") && isHardRunId(di.id); });
                    if (otherRun && Math.abs(daysBetween(otherRun, d)) < 2)
                        score += 3;
                }
                if (slotId === "C") {
                    const aDay = Object.keys(assign).find((k) => SLOT_OF[assign[k].id] === "A") ||
                        weekDates.find((k) => { const di = dayInfo[k]; return di && (di.status === "completed" || di.status === "partial") && SLOT_OF[di.id] === "A"; });
                    if (aDay && Math.abs(daysBetween(aDay, d)) < 2)
                        score += 2;
                }
                if (tpl.calMode && SESSIONS[rid].kind === "cal") {
                    const prev = idOn(addDays(d, -1));
                    if (prev && SESSIONS[prev] && SESSIONS[prev].kind === "cal")
                        score += 1;
                }
                if (best == null || score < best.score)
                    best = { d, id: rid, score, relaxed: relax.length > 0 };
            }
            if (best)
                break;
        }
        if (best) {
            const rid = best.id;
            const reasons = buildReasons(slotId, rid, best.d, { assign, idOn, tplCal: tpl.calMode, relaxed: best.relaxed, fatigue });
            assign[best.d] = { id: rid, reasons };
        }
        else {
            dropped.push({ id: slotId, reason: "No day left that fits it safely — it stays outstanding, not forgotten." });
        }
        const ix = required.indexOf(slotId);
        if (ix >= 0)
            required.splice(ix, 1);
    }
    if (!tpl.calMode && dropped.length === 0 && !(doneSlotCount.D > 0)) {
        const free = plannable.filter((d) => !assign[d] && avail(d) >= 25);
        if (free.length >= 2) {
            const d = free[free.length - 1];
            if (violations(d, "D", []).length === 0) {
                assign[d] = { id: "D", reasons: ["Optional bonus — every required exposure already fits this week.", "First session removed if the week tightens."] };
            }
        }
    }
    const doneNow = weekBudgetState(log, ws);
    const autoFlex = buildAutoFlexOverrides(assign, dayInfo, weekDates, doneNow, avail, fatigue, knee);
    const assignedContrib = {};
    Object.entries(assign).forEach(([d, a]) => {
        const sess = SESSIONS[a.id];
        const baseCredits = expectedCreditsForPlannedSession(a.id, avail(d));
        Object.entries(baseCredits).forEach(([k, v]) => { assignedContrib[k] = Math.max(assignedContrib[k] || 0, v); });
        const ao = autoFlex[d];
        if (ao && Array.isArray(ao.add)) {
            const credits = creditsFromExercises(ao.add.map((x) => x.id));
            Object.entries(credits).forEach(([k, v]) => { assignedContrib[k] = Math.max(assignedContrib[k] || 0, v); });
        }
    });
    const projected = (k) => (doneNow[k] || 0) + (assignedContrib[k] || 0);
    let recPlaced = (doneNow.recovery || 0) > 0;
    for (const d of weekDates) {
        if (dayInfo[d] || assign[d])
            continue;
        if (d < today)
            continue;
        if (dayFlags[d] === "exhausted") {
            assign[d] = { id: "REC", reasons: ["You flagged fatigue — recovery keeps the week honest.", "The outstanding session stays on the board, not on your conscience."] };
            recPlaced = true;
            continue;
        }
        if (avail(d) < 15) {
            assign[d] = { id: "REC", reasons: ["No training window today — programmed recovery."] };
            recPlaced = true;
            continue;
        }
        if (!recPlaced) {
            assign[d] = { id: "REC", reasons: ["Every week banks at least one low-stress day. This is it."] };
            recPlaced = true;
            continue;
        }
        if (projected("coreMobility") < 3) {
            assign[d] = { id: "MOB", reasons: ["Open day — a short mobility exposure moves the core/mobility budget."] };
            assignedContrib.coreMobility = (assignedContrib.coreMobility || 0) + 1;
            continue;
        }
        assign[d] = { id: "REC", reasons: ["Nothing outstanding fits better here — recover and stay fresh."] };
    }
    const days = weekDates.map((d) => {
        if (dayInfo[d])
            return { date: d, ...dayInfo[d] };
        const a = assign[d];
        if (a)
            return { date: d, id: a.id, status: "planned", reasons: a.reasons, pinned: !!a.pinned, autoOverride: autoFlex[d] || null };
        return { date: d, id: null, status: d < today ? "past" : "rest", reasons: [] };
    });
    const pct = workloadPct(doneNow);
    const skippedCount = days.filter((x) => x.status === "skipped").length;
    return {
        days, dropped, notes, done: doneNow, pct,
        message: weekMessage(pct, skippedCount, tpl.calMode),
        phase, effPhase, calMode: tpl.calMode, weekStart: ws,
    };
}
/* ===================== 5. PROGRESSION ENGINE (pure JS) ==================== */
/* Double progression for accessories; deliberate +5 rule for bench A.       */
function progressExercise(ex, marker) {
    if (ex.weight == null)
        return ex;
    const inc = ex.inc || 5;
    let w = ex.weight;
    if (marker === "up")
        w = ex.weight + inc;
    if (marker === "down")
        w = Math.max(0, ex.weight - inc);
    return { ...ex, weight: w };
}
function benchNext(reps, weight) {
    const valid = reps.filter((r) => Number.isFinite(r) && r > 0);
    if (valid.length >= 4 && valid.every((r) => r >= 6)) {
        return { next: weight + 5, up: true, msg: "All four sets hit 6 clean — +5 lb next Upper A." };
    }
    return { next: weight, up: false, msg: "Repeat " + weight + " lb until all four sets reach 6 clean reps with ~2 in reserve." };
}
function goalSnapshot(state) {
    const cal = (state.calibration && state.calibration.values) || {};
    const met = state.metrics || {};
    const bwLog = met.bodyweight || [];
    const lastBw = bwLog.length ? bwLog[bwLog.length - 1].v : Number(cal.bodyweight) || 158;
    const pull = met.pullupBest || [];
    const lastPull = pull.length ? pull[pull.length - 1].v : Number(cal.pullupMax) || 15;
    const bench = (state.exercises && state.exercises.benchA) || { weight: 145, history: [] };
    const bestBench = (bench.history || []).reduce((m, h) => Math.max(m, h.w || 0), bench.weight || 0);
    return {
        lastBw, lastPull, bestBench,
        mile: met.mileBest || cal.mile || "5:57",
        fiveK: met.fiveKBest || cal.fiveK || "21:55",
        mu: !!met.muscleUp,
    };
}
function pctToward(cur, start, target) {
    if (cur == null || target === start)
        return 0;
    return Math.max(0, Math.min(100, Math.round((100 * (cur - start)) / (target - start))));
}
function pctTimeToward(curStr, startSec, targetSec) {
    const c = mmssToSec(curStr);
    if (c == null)
        return 0;
    return Math.max(0, Math.min(100, Math.round((100 * (startSec - c)) / (startSec - targetSec))));
}
/* --------- Program library data: full PDF tables + cornerback track ------- */
const SESSION_TABLES = {
    A: [
        ["benchA", "4 × 5–6", "2–3 min", "Primary bench-strength exposure; RPE 7–8"], ["pullup", "3 × 6–8", "90–120 s", "Vertical pull / relative strength"],
        ["csRow", "3 × 8–10", "75 s", "Horizontal pull"], ["inclineDb", "2 × 8–10", "75 s", "Controlled secondary chest"],
        ["latRaise", "3 × 12–15", "45 s", "Side delts"], ["hammer", "3 × 10–12", "45–60 s", "Biceps / brachialis"],
        ["pressdown", "3 × 10–12", "45–60 s", "Direct triceps"], ["kneeRaise", "2 × 10–12", "45 s", "Core"],
    ],
    B: [
        ["rdl", "3 × 6–8", "90 s", "Primary hinge"], ["hipThrust", "3 × 8–10", "75–90 s", "Hip extension"],
        ["hamCurl", "2–3 × 10–12", "60 s", "Hamstrings"], ["stepUp", "2–3 sets", "60 s", "Pain-free knee capacity"],
        ["calfRaise", "3 × 12–15", "45 s", "Calves"], ["tibRaise", "2 × 15–20", "45 s", "Anterior shin"],
        ["bandWalk", "2 × 10–15/side", "45 s", "Hip stability"], ["pallof", "2 × 10/side", "45 s", "Anti-rotation core"],
    ],
    C: [
        ["exPull", "4 × 3", "90 s", "Explosive pull"], ["muTrans", "4 × 3", "90 s", "Muscle-up skill"], ["pulldown", "3 × 8–10", "60–75 s", "Lats"],
        ["cableRow1", "3 × 10/side", "60 s", "Back / scapula"], ["ohp", "3 × 8–10", "75 s", "Shoulders"],
        ["benchC", "3 × 5", "90 s", "60–70% speed bench; auto-removed if push fatigue is live"], ["incCurl", "3 × 10–12", "45–60 s", "Biceps"],
        ["ohTri", "3 × 10–12", "45–60 s", "Triceps"], ["facePull", "2 × 12–15", "45 s", "Rear delts / scapula"],
    ],
    D: [
        ["farmer", "3 × 30–40 yd", "60 s", "Grip/trunk"], ["ssRdl", "2 × 8/side", "60 s", "Unilateral hinge"],
        ["calfRaise", "2 × 15", "45 s", "Feet/ankles"], ["tibRaise", "2 × 15–20", "45 s", "Shin capacity"],
        ["bandWalk", "2 × 12/side", "45 s", "Hip stability"], ["abWheel", "2–3 × 6–10", "45 s", "Core"],
    ],
};
const TIER_LINES = {
    A: "60: full balanced upper · 40: bench + pulls + shoulders/arms · 25: bench + pull-up + row · 15: bench + pull-up only.",
    B: "60: full lower capacity · 40: main hinge/hip + knee/calf · 25: RDL + hip thrust + ham curl · 15: RDL + hip thrust.",
    C: "60: full pull-power/arms + speed bench if recovered · 40/25: condensed · 15: muscle-up/pull only. Scheduler converts to pull-only when pressing fatigue is live.",
    D: "Optional athletic microdose: feet/ankles, hips, grip and core. It should not create major fatigue.",
};
const SESSION_CB_NOTES = {
    A: "Chest volume is intentionally controlled: bench is the performance priority, but back volume equals or exceeds pressing and direct arm work stays in the plan.",
    B: "Optional Stage-2 plyometric primer, only if the knee feels normal: snap-down to athletic stance 3×3 + low pogo 3×10 contacts. Skill contacts, not conditioning.",
    C: "Explosive work comes first while fresh. If chest/shoulders are not recovered, bench technique is the first thing dropped.",
    D: "",
};
const FLOW = [
    ["Sep 1–7", "A / Q1 / Film Room / B / Q2 / C / Walkthrough", "Learn movements; conservative knee loading"],
    ["Sep 8–14", "Film Room or D / A / Q1 / Film Room / B / Q2 / C", "Add consistency, not exhaustion"],
    ["Sep 15–21", "Walkthrough / A / Q1 / Film Room / B / Q2 / C", "Best normal training week"],
    ["Sep 22–28", "Walkthrough / A / Q1 / Film Room / B reduced / Q2 / C reduced", "Consolidate fatigue"],
    ["Sep 29–30", "D or Walkthrough / monthly review", "Finish fresh; no mandatory max-out"],
];
const CB_SKILL = [
    { stage: 1, name: "Footwork & Patterning", pace: "walk–march pace, zero cutting", drills: [
            "Backpedal walk → smooth jog transitions — 4 × 15 yd",
            "Slow hip turns, open left/right (no plant-and-cut) — 2 × 5/side",
            "Line quick-steps: forward-back + lateral taps — 3 × 20 s",
            "A-march — 2 × 15–20 yd",
        ], note: "Pure patterning. Legal from day one — this is coverage footwork without knee cost." },
    { stage: 2, name: "Landings & Stance", pace: "skill contacts, not conditioning", drills: [
            "Snap-down to athletic stance — 3 × 3",
            "Low pogo contacts — 3 × 10",
            "Low box step-off landing + stick — 3 × 3",
            "Mirror shuffle at half speed (no reactive cuts) — 2 × 15 s",
        ], note: "Only when the knee feels completely normal." },
    { stage: 3, name: "Power", pace: "low volume, full intent", drills: [
            "Small broad jump + stick — 3 × 2",
            "Lateral bound + stick — 3 × 3/side",
            "Medicine-ball chest throw from stance — 3 × 3",
        ], note: "Requires no adverse knee response at Stage 2 first." },
    { stage: 4, name: "Speed & Change of Direction", pace: "the cornerback layer", drills: [
            "Accelerations 8–12 s @ 70–85% on the straight — 4–6, walk back fully",
            "Backpedal → turn-and-run build-ups — 4/side",
            "W-drill: walk-through first, then jog tempo",
            "Gradual deceleration reps before any harder cutting",
        ], note: "Only after Stages 1–3 tolerate well. Never sprint maximal speed into a curve." },
];
function cbStageFor(knee, setting) {
    if (knee === "irritated")
        return 1;
    const cap = knee === "watch" ? 2 : 4;
    return Math.max(1, Math.min(cap, setting || 1));
}
function restOf(session, exId) {
    const slot = SLOT_OF[session.id];
    const t = SESSION_TABLES[slot];
    if (!t)
        return "";
    const row = t.find((r) => r[0] === exId);
    return row ? row[2] : "";
}
/* -------- Session composition: base program + user modifications --------- */
function effectiveList(session, tier, mods, dayOverride) {
    var effTier = dayOverride && dayOverride.tier ? dayOverride.tier : tier;
    var base = session.variants ? (session.variants[effTier] || session.variants[60]) : [];
    var m = (mods || {})[SLOT_OF[session.id]] || {};
    var removed = [...(m.remove || []), ...((dayOverride && dayOverride.remove) || [])];
    var list = base.filter(function (row) { return removed.indexOf(row[0]) < 0; });
    if ((effTier === 60 || effTier === 40) && m.add) {
        m.add.forEach(function (a) { list = list.concat([[a.id, a.sr, "your add"]]); });
    }
    if (dayOverride && Array.isArray(dayOverride.add)) {
        dayOverride.add.forEach(function (a) { list = list.concat([[a.id, a.sr || "2 × 8–12", a.note || "coach add"]]); });
    }
    return list.length ? list : null;
}
/* ------------------ Coach (chat assistant) pure helpers ------------------ */
function buildCoachSystem(state, plan, today) {
    var dayLines = plan.days.map(function (d) {
        var ss = d.id ? SESSIONS[d.id].short : "rest";
        return DOW_SHORT[dowMon0(d.date)] + " " + d.date.slice(5) + " " + ss + " (" + d.status + ")";
    }).join("; ");
    var budget = BUDGET_DEF.map(function (b) { return b.label + " " + (plan.done[b.key] || 0) + "/" + b.target; }).join(", ");
    var ov = state.goalOverrides || {};
    var goals = GOALS.map(function (g) { return g.label + " -> " + ((ov[g.key] && ov[g.key].label) || g.target); }).join("; ");
    var kneeTxt = state.settings.knee;
    var skillTxt = cbStageFor(kneeTxt, state.settings.skillStage);
    var benchW = state.exercises.benchA.weight;
    var todayPlan = plan.days.find(function (d) { return d.date === today; });
    var todaySession = todayPlan && todayPlan.id ? SESSIONS[todayPlan.id] : null;
    var mergedTodayOverride = mergeDayOverrides(todayPlan && todayPlan.autoOverride, (state.dayWorkoutOverrides || {})[today]);
    var todayList = todaySession ? (effectiveList(todaySession, snapTier(state.settings.weekdayMinutes[dowMon0(today)] || 60), state.sessionMods, mergedTodayOverride) || []) : [];
    var todayExerciseText = todayList.map(function (r) { return (state.exercises[r[0]] ? state.exercises[r[0]].name : r[0]) + " " + r[1]; }).join("; ") || "none";
    var fatigueParts = [];
    FATIGUE_AREAS.concat(["systemic"]).forEach(function (a) { var lv = fatigueLevelAt(state.fatigue, a, today); if (lv > 0)
        fatigueParts.push(a + "=" + lv); });
    var memory = ((state.coachMemory || {}).observations || []).slice(-8).map(function (o) { return o.date + ": " + o.text; }).join(" | ") || "none yet";
    var recentFood = (state.nutrition || []).slice(-4).map(function (n) { return n.date + ": " + n.text; }).join(" | ") || "none";
    return ("You are the personalized trainer/coach brain inside the Cornerback Project. The app is the body/database; you are the adaptive reasoning layer. Motto: win the block, not the day. Never use shame or streak language. Be concise, specific, and action-oriented.\n" +
        "Today: " + today + " (phase " + plan.effPhase + "). Knee: " + kneeTxt + ". Coverage Skills stage: " + skillTxt + "/4. Bench working weight: " + benchW + " lb.\n" +
        "Week: " + dayLines + ".\nBudget: " + budget + ". Goals: " + goals + ".\n" +
        "Today's prescribed session: " + (todaySession ? todaySession.name : "none") + ". Exercises: " + todayExerciseText + ".\n" +
        "Current fatigue (0-3, decays unless re-reported): " + (fatigueParts.join(", ") || "none") + ".\n" +
        "Recent coaching observations: " + memory + ".\nRecent food/context: " + recentFood + ".\n" +
        "CORE BEHAVIOR: The static program is the starting hypothesis. A/B/C are anchor templates, NOT a push/pull/legs split and NOT sacred day types. The trainer may intelligently combine compatible stimuli on the same day (for example easy aerobic + pull-up skill + a short arms block, or condensed Upper C + 15–20 min easy aerobic) when that better serves the weekly goals. Actual performance data changes future prescription inside safe program constraints. If the user reports what actually happened, update structured state — do not only give advice. A session can be full, partial, skipped, substituted, or mixed. Credit only exercises/stimuli actually completed. Do not create debt for every missed accessory. Primary stimuli matter more than optional accessories.\n" +
        "If the user says the workout was too hard: identify local vs systemic fatigue, log it, and use adjust_week_from_feedback. Hard Upper A should suppress pressing but can leave legs available; hard Lower or hard run should protect the next 24-48h of lower-body intensity. If very hard/systemically wrecked, protect recovery.\n" +
        "If the user says too easy: do NOT punish with random volume. For an accessory that was clearly too easy, use exercise_feedback too_easy (one normal increment). For bench, prefer log_bench with actual reps/RIR evidence rather than a blind jump. For running, record the observation and progress conservatively rather than making a huge one-session jump.\n" +
        "During a workout you may modify TODAY: if an exercise hurts, remove it; if equipment is unavailable, remove/replace only what is needed; if time collapses, use set_today_time and preserve the highest-value remaining work. Pain is not a challenge to push through.\n" +
        "Food/lifestyle notes are low-friction context. Log them when the user volunteers them; do not demand calories/macros.\n" +
        "Respond with ONLY raw JSON, no markdown/fences, shape {\"reply\":\"...\",\"actions\":[...]}.\n" +
        "Allowed actions:\n" +
        "complete_session {date?, feel?}; log_partial_session {date?, duration?, exercises_completed?, exercises_skipped?, feel?, session_rpe?, completion_fraction?, notes?}; skip_session {date?, reason?}; recalc_week {}; move_session {slot,to_date};\n" +
        "adjust_week_from_feedback {date?, session_rpe?, fatigue_areas?, systemic_fatigue?, pain_areas?, notes?}; set_fatigue {area,level,note?}; exercise_feedback {name,difficulty,observed_rir?,note?} difficulty=too_easy|appropriate|too_hard; modify_today_session {remove_exercises?,add_exercises?,reason?}; set_today_time {minutes};\n" +
        "log_bench {weight,reps?}; set_bench_weight {weight}; log_metric {kind,value}; log_food {text}; log_note {text}; set_goal {key,target}; set_knee {status}; set_availability {dow,minutes}; flag_exhausted {}; add_exercise {session,name,sets_reps?,weight?}; remove_exercise {name,session?}; set_exercise_weight {name,weight}; set_skill_stage {stage}.\n" +
        "Exercise names can be natural language. Dates YYYY-MM-DD; omit date for today. Multiple actions allowed. Never invent completed training. If the user says 'I only did bench and pullups', use log_partial_session — not complete_session. If they say 'that was brutal, adjust my week', use adjust_week_from_feedback so the calendar actually changes.");
}
function parseCoachReply(text) {
    if (!text)
        return { reply: "I did not get a response. Try again.", actions: [] };
    var t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    var i = t.indexOf("{");
    var j = t.lastIndexOf("}");
    if (i >= 0 && j > i) {
        try {
            var obj = JSON.parse(t.slice(i, j + 1));
            return { reply: typeof obj.reply === "string" ? obj.reply : "", actions: Array.isArray(obj.actions) ? obj.actions : [] };
        }
        catch (e) { /* fall through */ }
    }
    return { reply: t.slice(0, 400), actions: [] };
}
function goalTargetToOverride(key, target) {
    var s = String(target).trim();
    if (key === "mile" || key === "fiveK") {
        var sec = mmssToSec(s);
        if (sec == null)
            return null;
        return { label: s, targetSec: sec };
    }
    var n = parseFloat(s);
    if (!Number.isFinite(n))
        return null;
    return { label: s.indexOf("lb") >= 0 || key === "pullup" ? s : s + (key === "bw" ? " lb" : key === "bench" ? " lb" : ""), targetVal: n };
}
/* ENGINE-END */
/* ========================= 6. STATE + PERSISTENCE ========================= */
import { Check, X, ChevronDown, ChevronRight, ChevronLeft, Clock, Moon, Zap, Activity, Calendar, Settings as SettingsIcon, RefreshCw, AlertTriangle, TrendingUp, Target, ArrowRight, Plus, MessageCircle, Send, Bell } from "lucide-react";
function freshDefaultState() {
    const exercises = {};
    Object.entries(EXERCISE_DEFAULTS).forEach(([id, def]) => { exercises[id] = { ...def, history: [] }; });
    const calValues = {};
    CAL_BASELINES.forEach((b) => { calValues[b.key] = b.seed || ""; });
    return {
        version: 2,
        settings: {
            weekdayMinutes: { 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 75, 6: 60 },
            knee: "good",
            simDate: "",
            reminderOn: false,
            reminderTime: "07:00",
            aiProvider: "claude",
            openaiKey: "",
            coachEndpoint: "",
            skillStage: 1,
        },
        exercises,
        calibration: { values: calValues, savedAt: {} },
        pins: {},
        dayFlags: {},
        dayWorkoutOverrides: {},
        fatigue: { areas: {}, systemic: null },
        coachMemory: { observations: [] },
        log: [],
        nutrition: [],
        notesLog: [],
        sessionMods: {},
        chat: [],
        goalOverrides: {},
        health: { connected: false },
        metrics: { bodyweight: [], waist: [], pullupBest: [], mileBest: null, fiveKBest: null, muscleUp: false },
        ui: { onboarded: false, helpDismissed: false, lastReminder: "" },
    };
}
function mergeState(def, saved) {
    if (!saved)
        return def;
    const out = { ...def, ...saved };
    out.settings = { ...def.settings, ...(saved.settings || {}) };
    out.settings.weekdayMinutes = { ...def.settings.weekdayMinutes, ...((saved.settings || {}).weekdayMinutes || {}) };
    out.metrics = { ...def.metrics, ...(saved.metrics || {}) };
    out.calibration = {
        values: { ...def.calibration.values, ...(((saved.calibration || {}).values) || {}) },
        savedAt: { ...(((saved.calibration || {}).savedAt) || {}) },
    };
    out.exercises = {};
    Object.keys(def.exercises).forEach((id) => {
        out.exercises[id] = { ...def.exercises[id], ...((saved.exercises || {})[id] || {}) };
        if (!Array.isArray(out.exercises[id].history))
            out.exercises[id].history = [];
    });
    out.pins = { ...(saved.pins || {}) };
    out.dayFlags = { ...(saved.dayFlags || {}) };
    out.dayWorkoutOverrides = { ...(saved.dayWorkoutOverrides || {}) };
    out.fatigue = { areas: { ...(((saved.fatigue || {}).areas) || {}) }, systemic: (saved.fatigue || {}).systemic || null };
    out.coachMemory = { observations: Array.isArray((saved.coachMemory || {}).observations) ? saved.coachMemory.observations : [] };
    out.log = Array.isArray(saved.log) ? saved.log : [];
    out.nutrition = Array.isArray(saved.nutrition) ? saved.nutrition : [];
    out.notesLog = Array.isArray(saved.notesLog) ? saved.notesLog : [];
    out.sessionMods = { ...(saved.sessionMods || {}) };
    out.chat = Array.isArray(saved.chat) ? saved.chat : [];
    out.goalOverrides = { ...(saved.goalOverrides || {}) };
    out.health = { ...def.health, ...(saved.health || {}) };
    out.ui = { ...def.ui, ...(saved.ui || {}) };
    return out;
}
function useAppState() {
    const [state, setState] = useState(null);
    const loadedRef = useRef(false);
    useEffect(() => {
        let alive = true;
        StorageAdapter.load(STORE_KEY).then((saved) => {
            if (!alive)
                return;
            setState(mergeState(freshDefaultState(), saved));
            loadedRef.current = true;
        });
        return () => { alive = false; };
    }, []);
    useEffect(() => {
        if (!loadedRef.current || !state)
            return;
        const t = setTimeout(() => { StorageAdapter.save(STORE_KEY, state); }, 500);
        return () => clearTimeout(t);
    }, [state]);
    return [state, setState];
}
function makeActions(setState, notify) {
    const up = (fn) => setState((prev) => (prev ? fn(prev) : prev));
    return {
        completeSession(date, sessionId, payload = {}) {
            if (payload.benchReps && SLOT_OF[sessionId] === "A" && payload.benchWeight != null) {
                notify(benchNext(payload.benchReps, payload.benchWeight).msg);
            }
            up((s) => {
                const exercisesCompleted = Array.isArray(payload.exercisesCompleted) ? payload.exercisesCompleted : null;
                const exercisesSkipped = Array.isArray(payload.exercisesSkipped) ? payload.exercisesSkipped : [];
                const status = payload.status || (exercisesCompleted && exercisesSkipped.length ? "partial" : "completed");
                const entry = {
                    date, sessionId, status,
                    duration: payload.duration || null,
                    exercisesCompleted,
                    exercisesSkipped,
                    completionFraction: payload.completionFraction == null ? null : Number(payload.completionFraction),
                    sessionRpe: payload.sessionRpe || (payload.feel ? FEEL_RPE[payload.feel] || null : null),
                    feel: payload.feel || null,
                    extras: payload.extras || {}, note: payload.note || payload.notes || "", data: payload.data || {}, ts: Date.now(),
                };
                let exercises = { ...s.exercises };
                if (payload.benchReps && SLOT_OF[sessionId] === "A") {
                    const ex = exercises.benchA;
                    const w = payload.benchWeight != null ? payload.benchWeight : ex.weight;
                    const res = benchNext(payload.benchReps, w);
                    exercises.benchA = { ...ex, weight: res.next, history: [...ex.history, { date, w, reps: payload.benchReps.join("/"), rir: payload.benchRir || null }] };
                    entry.data.bench = { w, reps: payload.benchReps.join("/") };
                }
                if (payload.markers) {
                    Object.entries(payload.markers).forEach(([exId, marker]) => {
                        if (exercisesCompleted && !exercisesCompleted.includes(exId))
                            return;
                        if (!exercises[exId] || marker === "stay") {
                            if (exercises[exId] && exercises[exId].weight != null)
                                exercises[exId] = { ...exercises[exId], history: [...exercises[exId].history, { date, w: exercises[exId].weight, m: "=" }] };
                            return;
                        }
                        const before = exercises[exId].weight;
                        exercises[exId] = progressExercise(exercises[exId], marker);
                        exercises[exId] = { ...exercises[exId], history: [...exercises[exId].history, { date, w: before, m: marker === "up" ? "+" : "-" }] };
                    });
                }
                const pins = { ...s.pins };
                delete pins[date];
                const dayFlags = { ...s.dayFlags };
                delete dayFlags[date];
                const dayWorkoutOverrides = { ...(s.dayWorkoutOverrides || {}) };
                delete dayWorkoutOverrides[date];
                const fatigue = applySessionFeelFatigue(s.fatigue, sessionId, date, payload.feel);
                const obs = [...((s.coachMemory || {}).observations || [])];
                if (status === "partial")
                    obs.push({ date, text: "Partial " + SESSIONS[sessionId].short + ": completed " + ((exercisesCompleted || []).join(", ") || "some work") + (exercisesSkipped.length ? "; skipped " + exercisesSkipped.join(", ") : "") });
                if (payload.feel === "Very Easy" || payload.feel === "Very Hard" || payload.feel === "Hard")
                    obs.push({ date, text: SESSIONS[sessionId].short + " felt " + payload.feel.toLowerCase() + (payload.note ? " — " + payload.note : "") });
                return { ...s, exercises, pins, dayFlags, dayWorkoutOverrides, fatigue, coachMemory: { observations: obs.slice(-80) }, log: [...s.log, entry] };
            });
            if (payload.status === "partial" || (payload.exercisesSkipped && payload.exercisesSkipped.length))
                notify("Partial work banked. Only what you actually did gets credit; important missing stimuli stay available later.");
        },
        skipSession(date, sessionId, reason) {
            up((s) => ({ ...s, log: [...s.log, { date, sessionId, status: "skipped", reason: reason || "", ts: Date.now() }] }));
            notify("Logged. The week just reflowed around it — nothing is lost.");
        },
        undoDay(date) {
            up((s) => ({ ...s, log: s.log.filter((e) => e.date !== date) }));
        },
        setKnee(k) {
            up((s) => ({ ...s, settings: { ...s.settings, knee: k } }));
            if (k === "irritated")
                notify("Provoking work swapped for pain-free alternatives. Don't train through it.");
            if (k === "good")
                notify("Knee cleared — full programming restored.");
        },
        setSkillStage(n) {
            const v = Math.max(1, Math.min(4, Number(n) || 1));
            up((s) => ({ ...s, settings: { ...s.settings, skillStage: v } }));
            notify("Coverage Skills → Stage " + v + ". Knee status still caps what actually runs.");
        },
        flagExhausted(date) {
            up((s) => ({ ...s, dayFlags: { ...s.dayFlags, [date]: "exhausted" } }));
            notify("Recovery today. The session stays on the board — the body doesn't care which weekday it happens.");
        },
        clearFlag(date) {
            up((s) => { const f = { ...s.dayFlags }; delete f[date]; return { ...s, dayFlags: f }; });
        },
        setDayWorkoutOverride(date, patch) {
            up((s) => {
                const all = { ...(s.dayWorkoutOverrides || {}) };
                const cur = { ...(all[date] || {}) };
                all[date] = { ...cur, ...patch,
                    remove: patch.remove ? Array.from(new Set([...(cur.remove || []), ...patch.remove])) : (cur.remove || []),
                    add: patch.add ? [...(cur.add || []), ...patch.add] : (cur.add || []),
                };
                return { ...s, dayWorkoutOverrides: all };
            });
        },
        setFatigueArea(area, level, date, note) {
            up((s) => {
                const fatigue = applyFatigueRecord(s.fatigue, area, level, date, note);
                const obs = [...((s.coachMemory || {}).observations || []), { date, text: "Fatigue " + area + "=" + normalizeFatigueLevel(level) + (note ? " — " + note : "") }];
                return { ...s, fatigue, coachMemory: { observations: obs.slice(-80) } };
            });
        },
        adjustWeekFromFeedback(date, payload) {
            up((s) => {
                let fatigue = s.fatigue || { areas: {}, systemic: null };
                const rpe = Number(payload.session_rpe || payload.sessionRpe || 0);
                const defaultLevel = rpe >= 9 ? 3 : rpe >= 8 ? 2 : rpe >= 7 ? 1 : 0;
                const areas = payload.fatigue_areas || payload.fatigueAreas || [];
                if (Array.isArray(areas))
                    areas.forEach((a) => { if (FATIGUE_AREAS.includes(String(a)))
                        fatigue = applyFatigueRecord(fatigue, String(a), defaultLevel || 2, date, payload.notes); });
                else if (areas && typeof areas === "object")
                    Object.entries(areas).forEach(([a, lv]) => { if (FATIGUE_AREAS.includes(a))
                        fatigue = applyFatigueRecord(fatigue, a, lv, date, payload.notes); });
                const sys = payload.systemic_fatigue != null ? payload.systemic_fatigue : payload.systemicFatigue;
                if (sys != null)
                    fatigue = applyFatigueRecord(fatigue, "systemic", sys, date, payload.notes);
                else if (rpe >= 9)
                    fatigue = applyFatigueRecord(fatigue, "systemic", 2, date, payload.notes || "very hard session");
                const pain = payload.pain_areas || payload.painAreas || [];
                const obsText = "Training feedback" + (rpe ? " RPE " + rpe : "") + (areas && (Array.isArray(areas) ? areas.length : Object.keys(areas).length) ? "; fatigue " + JSON.stringify(areas) : "") + (pain && pain.length ? "; pain " + pain.join(", ") : "") + (payload.notes ? " — " + payload.notes : "");
                const obs = [...((s.coachMemory || {}).observations || []), { date, text: obsText }];
                const log = s.log.map((e) => e.date === date && (e.status === "completed" || e.status === "partial") ? { ...e, sessionRpe: rpe || e.sessionRpe, feedback: payload, tsFeedback: Date.now() } : e);
                return { ...s, fatigue, log, coachMemory: { observations: obs.slice(-80) } };
            });
            notify("Feedback logged. The remaining week now re-scores around your fatigue and what you actually completed.");
        },
        recordExerciseFeedback(exId, difficulty, date, observedRir, note) {
            up((s) => {
                const ex = s.exercises[exId];
                if (!ex)
                    return s;
                let nextWeight = ex.weight;
                if (exId !== "benchA" && exId !== "benchC" && ex.weight != null) {
                    if (difficulty === "too_easy")
                        nextWeight = ex.weight + (ex.inc || 5);
                    if (difficulty === "too_hard")
                        nextWeight = Math.max(0, ex.weight - (ex.inc || 5));
                }
                const updated = { ...ex, weight: nextWeight, history: [...(ex.history || []), { date, w: ex.weight, feedback: difficulty, rir: observedRir == null ? null : observedRir, note: note || "" }] };
                const obs = [...((s.coachMemory || {}).observations || []), { date, text: ex.name + " felt " + difficulty.replace("_", " ") + (observedRir != null ? " (RIR ~" + observedRir + ")" : "") + (nextWeight !== ex.weight ? "; next load " + nextWeight + " " + ex.unit : "") }];
                return { ...s, exercises: { ...s.exercises, [exId]: updated }, coachMemory: { observations: obs.slice(-80) } };
            });
            notify(difficulty === "too_easy" ? "Logged — next accessory load nudged up one normal step." : difficulty === "too_hard" ? "Logged — next accessory load reduced one step." : "Exercise feedback logged.");
        },
        pinSession(date, slotId) {
            up((s) => {
                const pins = { ...s.pins };
                Object.keys(pins).forEach((d) => { if (pins[d] === slotId && weekStartOf(d) === weekStartOf(date))
                    delete pins[d]; });
                pins[date] = slotId;
                return { ...s, pins };
            });
            notify("Moved. Everything else re-planned around it.");
        },
        recalc() { up((s) => ({ ...s })); notify("Week rebuilt around what you've completed."); },
        saveCalValue(key, val) {
            up((s) => ({ ...s, calibration: { ...s.calibration, values: { ...s.calibration.values, [key]: val }, savedAt: { ...s.calibration.savedAt, [key]: Date.now() } } }));
        },
        setExerciseWeight(id, weight) {
            up((s) => ({ ...s, exercises: { ...s.exercises, [id]: { ...s.exercises[id], weight } } }));
        },
        logMetric(kind, v, date) {
            up((s) => {
                const m = { ...s.metrics };
                if (kind === "bodyweight")
                    m.bodyweight = [...m.bodyweight, { date, v }];
                if (kind === "waist")
                    m.waist = [...m.waist, { date, v }];
                if (kind === "pullup")
                    m.pullupBest = [...m.pullupBest, { date, v }];
                if (kind === "mile")
                    m.mileBest = v;
                if (kind === "fiveK")
                    m.fiveKBest = v;
                if (kind === "muscleUp")
                    m.muscleUp = !!v;
                return { ...s, metrics: m };
            });
            notify("Logged.");
        },
        setAvailability(dow, minutes) {
            up((s) => ({ ...s, settings: { ...s.settings, weekdayMinutes: { ...s.settings.weekdayMinutes, [dow]: minutes } } }));
        },
        setSimDate(v) { up((s) => ({ ...s, settings: { ...s.settings, simDate: v } })); },
        importJson(text) {
            try {
                const obj = JSON.parse(text);
                up(() => mergeState(freshDefaultState(), obj));
                notify("Data imported.");
                return true;
            }
            catch (e) {
                notify("Import failed — that isn't valid JSON.");
                return false;
            }
        },
        resetAll() { setState(freshDefaultState()); notify("Fresh slate. The program is still the program."); },
        logFood(date, text) {
            up((s) => ({ ...s, nutrition: [...s.nutrition, { date, text, ts: Date.now() }].slice(-120) }));
        },
        logNote(date, text) {
            up((s) => {
                const obs = [...((s.coachMemory || {}).observations || []), { date, text: String(text) }];
                return { ...s, notesLog: [...s.notesLog, { date, text, ts: Date.now() }].slice(-120), coachMemory: { observations: obs.slice(-80) } };
            });
        },
        setCoachEndpoint(v) { up((s) => ({ ...s, settings: { ...s.settings, coachEndpoint: v } })); },
        addCustomExercise(slot, name, sr, weight) {
            const id = "cx_" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 28);
            up((s) => {
                const exercises = { ...s.exercises };
                if (!exercises[id])
                    exercises[id] = { name: name, unit: "lb", group: slot, weight: weight != null ? weight : null, inc: 5, cal: false, history: [] };
                else if (weight != null)
                    exercises[id] = { ...exercises[id], weight };
                const mods = { ...(s.sessionMods || {}) };
                const m = { ...(mods[slot] || {}) };
                m.add = [...(m.add || []).filter((a) => a.id !== id), { id, sr: sr || "3 × 8–10" }];
                m.remove = (m.remove || []).filter((x) => x !== id);
                mods[slot] = m;
                return { ...s, exercises, sessionMods: mods };
            });
            notify(name + " added to " + (slot === "B" ? "Lower" : slot === "D" ? "Full-Body" : "Upper " + slot) + " days.");
        },
        removeExerciseFromSlot(slot, exId, exName) {
            up((s) => {
                const mods = { ...(s.sessionMods || {}) };
                const m = { ...(mods[slot] || {}) };
                m.add = (m.add || []).filter((a) => a.id !== exId);
                if (!String(exId).startsWith("cx_"))
                    m.remove = [...(m.remove || []).filter((x) => x !== exId), exId];
                mods[slot] = m;
                return { ...s, sessionMods: mods };
            });
            notify(exName + " removed from " + slot + " days.");
        },
        setGoalOverride(key, ov) {
            up((s) => ({ ...s, goalOverrides: { ...s.goalOverrides, [key]: ov } }));
        },
        logBenchEntry(date, weight, reps) {
            up((s) => {
                const ex = s.exercises.benchA;
                let next = ex.weight;
                if (Array.isArray(reps) && reps.length >= 4)
                    next = benchNext(reps, weight).next;
                return { ...s, exercises: { ...s.exercises, benchA: { ...ex, weight: next != null ? next : ex.weight, history: [...ex.history, { date, w: weight, reps: Array.isArray(reps) ? reps.join("/") : "" }] } } };
            });
        },
        setReminder(on, time) {
            up((s) => ({ ...s, settings: { ...s.settings, reminderOn: on, reminderTime: time || s.settings.reminderTime } }));
        },
        markReminded(date) { up((s) => ({ ...s, ui: { ...s.ui, lastReminder: date } })); },
        setAIProvider(p) { up((s) => ({ ...s, settings: { ...s.settings, aiProvider: p } })); },
        setOpenAIKey(k) { up((s) => ({ ...s, settings: { ...s.settings, openaiKey: k } })); },
        setHealthConnected(b) {
            up((s) => ({ ...s, health: { ...s.health, connected: !!b } }));
            notify(b ? "Health feed connected (demo data for now)." : "Health feed disconnected.");
        },
        pushChat(msg) { up((s) => ({ ...s, chat: [...s.chat, { ...msg, ts: Date.now() }].slice(-40) })); },
        clearChat() { up((s) => ({ ...s, chat: [] })); },
        dismissHelp() { up((s) => ({ ...s, ui: { ...s.ui, helpDismissed: true } })); },
        replayOnboarding() { up((s) => ({ ...s, ui: { ...s.ui, onboarded: false, helpDismissed: false } })); },
        completeOnboarding(p) {
            up((s) => {
                const exercises = { ...s.exercises };
                if (p.bench)
                    exercises.benchA = { ...exercises.benchA, weight: Number(p.bench) || exercises.benchA.weight };
                const metrics = { ...s.metrics };
                if (p.bw)
                    metrics.bodyweight = [...metrics.bodyweight, { date: p.date, v: p.bw }];
                const calibration = { ...s.calibration, values: { ...s.calibration.values, bodyweight: p.bw || s.calibration.values.bodyweight } };
                return {
                    ...s, exercises, metrics, calibration,
                    settings: { ...s.settings, weekdayMinutes: { ...s.settings.weekdayMinutes, ...(p.minutes || {}) }, reminderOn: !!p.reminderOn, reminderTime: p.reminderTime || s.settings.reminderTime },
                    health: { connected: !!p.health },
                    ui: { ...s.ui, onboarded: true },
                };
            });
            notify("You're set. Today's session is on the board.");
        },
    };
}
/* ================================ 7. UI =================================== */
const CSS = `
:root{
  --bg:#0A0E15; --panel:#101724; --panel2:#0C1320; --raise:#141D2E;
  --line:#1D2736; --line2:#27344A;
  --text:#E8EDF4; --dim:#7E8CA0; --faint:#55627A;
  --accent:#6B9BEF; --accent2:#3E68B8;
  --good:#43C98A; --warn:#DFAE4F; --bad:#D96B6B; --ice:#9FB6D9;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg)}
.cb{min-height:100vh;background:
  radial-gradient(1200px 500px at 70% -10%, rgba(107,155,239,0.07), transparent 60%),
  var(--bg);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
.cb ::selection{background:rgba(107,155,239,.3)}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px 80px}
.topbar{position:sticky;top:0;z-index:40;background:rgba(10,14,21,.86);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.topin{max-width:1080px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:baseline;gap:10px;white-space:nowrap}
.brand .cbmark{font-family:var(--mono);font-weight:700;font-size:13px;color:var(--bg);background:var(--accent);padding:3px 7px;border-radius:4px;letter-spacing:.08em}
.brand .cbname{font-weight:800;letter-spacing:.22em;font-size:12px;color:var(--text);text-transform:uppercase}
.phasechip{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--ice);border:1px solid var(--line2);border-radius:999px;padding:4px 10px;white-space:nowrap}
.tabs{display:flex;gap:2px;margin-left:auto;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{appearance:none;background:none;border:none;color:var(--dim);font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;padding:8px 12px;cursor:pointer;border-radius:6px;white-space:nowrap}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);background:var(--raise)}
.tab:focus-visible,.btn:focus-visible,.chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}
.card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:16px}
.card.tight{padding:14px 16px}
h1.big{font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.15;margin-top:6px}
h2.sec{font-size:16px;font-weight:750;margin-bottom:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.dim{color:var(--dim)} .faint{color:var(--faint)} .small{font-size:12.5px}
.num{font-family:var(--mono);font-variant-numeric:tabular-nums}
.hr{border:none;border-top:1px solid var(--line);margin:14px 0}
.btn{appearance:none;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--raise);color:var(--text);padding:9px 14px;border-radius:8px;font-size:13px;font-weight:650;cursor:pointer;transition:border-color .15s,background .15s}
.btn:hover{border-color:var(--accent2)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#0A0E15}
.btn.primary:hover{background:#82ABF2}
.btn.good{background:var(--good);border-color:var(--good);color:#07130D}
.btn.subtle{background:none;border-color:var(--line)}
.btn.warn{border-color:rgba(223,174,79,.55);color:var(--warn);background:none}
.btn.sm{padding:6px 10px;font-size:12px}
.btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{appearance:none;border:1px solid var(--line2);background:none;color:var(--dim);padding:6px 12px;border-radius:999px;font-size:12.5px;font-weight:650;cursor:pointer;font-family:var(--mono)}
.chip:hover{color:var(--text)}
.chip.active{background:var(--accent);border-color:var(--accent);color:#0A0E15}
.bar{height:5px;background:var(--raise);border-radius:3px;overflow:hidden;position:relative}
.barfill{height:100%;background:var(--accent);border-radius:3px;transition:width .4s ease}
.barfill.full{background:var(--good)}
.budgetrow{display:grid;grid-template-columns:180px 1fr 56px;gap:12px;align-items:center;padding:7px 0}
.budgetrow .lab{font-size:12.5px;color:var(--dim)}
.budgetrow .cnt{text-align:right;font-size:12.5px}
.daystrip{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:14px}
.daycell{border:1px solid var(--line);border-radius:10px;padding:10px 10px 12px;min-height:104px;background:var(--panel2);position:relative;display:flex;flex-direction:column;gap:6px}
.daycell.today{border-color:var(--accent2);box-shadow:0 0 0 1px var(--accent2) inset}
.daycell.completed{border-color:rgba(67,201,138,.4)}
.daycell.optional{border-style:dashed}
.daycell .dlab{font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--faint)}
.daycell .dname{font-size:12.5px;font-weight:700;line-height:1.25}
.daycell .dstat{margin-top:auto;display:flex;align-items:center;gap:5px;font-size:10.5px;color:var(--dim)}
.exrow{display:grid;grid-template-columns:1fr auto;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}
.exrow:last-child{border-bottom:none}
.exname{font-weight:650;font-size:13.5px}
.exmeta{font-size:11.5px;color:var(--dim)}
.wchip{font-family:var(--mono);font-size:12px;color:var(--ice);border:1px solid var(--line2);border-radius:6px;padding:3px 8px;white-space:nowrap;align-self:center}
.wchip.missing{color:var(--warn);border-color:rgba(223,174,79,.4)}
.mes{display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.12em;color:var(--good);border:1px solid rgba(67,201,138,.4);padding:3px 8px;border-radius:999px}
.reason{display:flex;gap:8px;font-size:12.5px;color:var(--dim);margin-top:5px}
.reason:before{content:"—";color:var(--faint)}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:var(--raise);border:1px solid var(--line2);border-radius:10px;padding:11px 18px;font-size:13px;z-index:100;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:92vw}
.input,.select{background:var(--panel2);border:1px solid var(--line2);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;font-family:var(--mono);width:100%}
.input:focus,.select:focus{outline:none;border-color:var(--accent)}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:11px;color:var(--dim);letter-spacing:.06em;text-transform:uppercase;font-family:var(--mono)}
.tri{display:flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.tri button{appearance:none;background:none;border:none;color:var(--dim);padding:5px 10px;font-size:12px;cursor:pointer;font-family:var(--mono)}
.tri button.on.up{background:rgba(67,201,138,.2);color:var(--good)}
.tri button.on.stay{background:var(--raise);color:var(--text)}
.tri button.on.down{background:rgba(217,107,107,.16);color:var(--bad)}
.collapse-head{display:flex;align-items:center;gap:8px;cursor:pointer;padding:10px 0;border:none;background:none;color:var(--text);width:100%;text-align:left;font-size:13.5px;font-weight:650}
.collapse-body{padding:2px 0 12px 26px;color:var(--dim);font-size:13px;border-bottom:1px solid var(--line)}
.scorehead{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;flex-wrap:wrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:12px;background:var(--panel2)}
.kpi .v{font-family:var(--mono);font-size:19px;font-weight:700;margin-top:2px}
.kpi .l{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-family:var(--mono)}
.goalrow{display:grid;grid-template-columns:110px 1fr 130px;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
.goalrow:last-child{border-bottom:none}
.modal-scrim{position:fixed;inset:0;background:rgba(5,8,13,.72);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:22px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.monthcard{border-left:2px solid var(--line2);padding-left:16px;margin-top:18px}
.monthcard.on{border-left-color:var(--accent)}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:.12em;border:1px solid var(--line2);border-radius:4px;padding:2px 6px;color:var(--dim)}
.footer-safety{margin-top:28px;padding:16px;border:1px solid var(--line);border-radius:10px;color:var(--faint);font-size:12px;line-height:1.6}
@media (max-width:840px){
  .grid2{grid-template-columns:1fr}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .daystrip{grid-template-columns:repeat(7,minmax(86px,1fr));overflow-x:auto;padding-bottom:6px}
  .budgetrow{grid-template-columns:130px 1fr 52px}
  .goalrow{grid-template-columns:84px 1fr 110px}
  h1.big{font-size:22px}
}
.daycell.click{cursor:pointer;text-align:left;appearance:none;font-family:inherit}
.daycell.click:hover{border-color:var(--accent2)}
.seg{display:flex;border:1px solid var(--line2);border-radius:8px;overflow:hidden}
.seg button{appearance:none;border:none;background:none;color:var(--dim);padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.06em}
.seg button.on{background:var(--raise);color:var(--text)}
.mhead{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:12px;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
.mhead div{padding:0 4px}
.mrow{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:6px}
.mcell{appearance:none;font-family:inherit;text-align:left;border:1px solid var(--line);border-radius:8px;background:var(--panel2);min-height:64px;padding:6px 7px;cursor:pointer;display:flex;flex-direction:column;gap:2px;color:var(--text)}
.mcell:hover{border-color:var(--accent2)}
.mcell.today{border-color:var(--accent2);box-shadow:0 0 0 1px var(--accent2) inset}
.mcell.completed{border-color:rgba(67,201,138,.35)}
.mcell.out{opacity:.32}
.mcell .mdate{font-size:10.5px;color:var(--faint)}
.mcell .mname{font-size:10.5px;font-weight:700;line-height:1.2}
.mcell .mic{margin-top:auto}
.fab{position:fixed;right:22px;bottom:22px;z-index:70;width:52px;height:52px;border-radius:50%;background:var(--accent);color:#0A0E15;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(107,155,239,.35)}
.fab:hover{background:#82ABF2}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(400px,100vw);z-index:80;background:var(--panel);border-left:1px solid var(--line2);display:flex;flex-direction:column;box-shadow:-16px 0 50px rgba(0,0,0,.45)}
.drawer-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
.drawer-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
.bub{max-width:86%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap}
.bub.user{align-self:flex-end;background:var(--accent2);color:#EAF1FD;border-bottom-right-radius:4px}
.bub.coach{align-self:flex-start;background:var(--raise);border:1px solid var(--line);border-bottom-left-radius:4px}
.actchip{display:inline-block;font-family:var(--mono);font-size:10.5px;color:var(--good);border:1px solid rgba(67,201,138,.35);border-radius:6px;padding:2px 7px;margin:4px 4px 0 0}
.drawer-in{display:flex;gap:8px;padding:12px 14px;border-top:1px solid var(--line)}
.quickchips{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 10px}
.ob-scrim{position:fixed;inset:0;z-index:90;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto}
.ob{max-width:520px;width:100%;background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line2);border-radius:16px;padding:28px}
.ob-dots{display:flex;gap:6px;margin-top:20px}
.ob-dots span{width:22px;height:3px;border-radius:2px;background:var(--line2)}
.ob-dots span.on{background:var(--accent)}
.helpnum{font-family:var(--mono);color:var(--accent);font-weight:700;margin-right:8px}
.ptable{display:grid;grid-template-columns:1.5fr 0.9fr 0.6fr 1.7fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12.5px;align-items:baseline}
.ptable:last-of-type{border-bottom:none}
.ptable.phead{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line2)}
@media (max-width:840px){
  .ptable{grid-template-columns:1.3fr 0.9fr 0.6fr;font-size:12px}
  .ptable div:nth-child(4){display:none}
}
@media (max-width:840px){
  .drawer{width:100vw}
}
@media (prefers-reduced-motion:reduce){
  .barfill{transition:none}
}
`;
/* ------------------------------- atoms ---------------------------------- */
function Bar({ val, max, full }) {
    const pct = max > 0 ? Math.min(100, Math.round((100 * val) / max)) : 0;
    return (_jsx("div", { className: "bar", children: _jsx("div", { className: "barfill" + (full || pct >= 100 ? " full" : ""), style: { width: pct + "%" } }) }));
}
function Collapse({ title, children, defaultOpen }) {
    const [open, setOpen] = useState(!!defaultOpen);
    return (_jsxs("div", { children: [_jsxs("button", { className: "collapse-head", onClick: () => setOpen(!open), children: [open ? _jsx(ChevronDown, { size: 15 }) : _jsx(ChevronRight, { size: 15 }), " ", title] }), open && _jsx("div", { className: "collapse-body", children: children })] }));
}
function Toast({ msg }) {
    if (!msg)
        return null;
    return _jsx("div", { className: "toast", children: msg });
}
function Modal({ onClose, children }) {
    return (_jsx("div", { className: "modal-scrim", onClick: onClose, children: _jsx("div", { className: "modal", onClick: (e) => e.stopPropagation(), children: children }) }));
}
function statusIcon(status, id) {
    const s = id ? SESSIONS[id] : null;
    if (status === "completed")
        return _jsx(Check, { size: 12, color: "var(--good)" });
    if (status === "partial")
        return _jsx(Check, { size: 12, color: "var(--warn)" });
    if (status === "skipped")
        return _jsx(ArrowRight, { size: 12, color: "var(--dim)" });
    if (s && s.kind === "recovery")
        return _jsx(Moon, { size: 12, color: "var(--dim)" });
    if (s && s.kind === "run")
        return _jsx(Activity, { size: 12, color: "var(--ice)" });
    if (s && s.kind === "cal")
        return _jsx(Target, { size: 12, color: "var(--accent)" });
    if (s && s.kind === "strength")
        return _jsx(Zap, { size: 12, color: "var(--ice)" });
    return null;
}
function snapTier(mins) {
    if (mins >= 60)
        return 60;
    if (mins >= 40)
        return 40;
    if (mins >= 25)
        return 25;
    return 15;
}
function tierLabel(t) { return t === 15 ? "15 min · MES" : t + " min"; }
/* ------------------------------ TODAY VIEW ------------------------------- */
function KneeSelector({ knee, setKnee }) {
    const opts = [["good", "Knee: good"], ["watch", "Knee: watch"], ["irritated", "Knee: flagged"]];
    return (_jsx("div", { className: "chips", children: opts.map(([k, l]) => (_jsx("button", { className: "chip" + (knee === k ? " active" : ""), onClick: () => setKnee(k), children: l }, k))) }));
}
function ExerciseList({ session, tier, state, goCalibrate, date, autoOverride }) {
    const override = mergeDayOverrides(autoOverride, date ? (state.dayWorkoutOverrides || {})[date] : null);
    const list = effectiveList(session, tier, state.sessionMods, override);
    if (!list)
        return null;
    return (_jsxs("div", { style: { marginTop: 10 }, children: [override && (override.remove || []).length > 0 && _jsxs("p", { className: "small", style: { color: "var(--warn)", marginBottom: 8 }, children: ["Coach-adjusted today: ", override.reason || "some work was removed to match recovery/time."] }), list.map(([exId, sr, note], i) => {
                const ex = state.exercises[exId];
                const hasW = ex && ex.weight != null && !ex.bw;
                return (_jsxs("div", { className: "exrow", children: [_jsxs("div", { children: [_jsx("div", { className: "exname", children: ex ? ex.name : exId }), _jsxs("div", { className: "exmeta", children: [_jsx("span", { className: "num", children: sr }), restOf(session, exId) ? " · rest " + restOf(session, exId) : "", note ? " · " + note : ""] })] }), ex && ex.bw ? _jsx("span", { className: "wchip", children: ex.unit })
                            : hasW ? _jsxs("span", { className: "wchip num", children: [ex.weight, " ", ex.unit] })
                                : ex && ex.derived && state.exercises.benchA.weight ? _jsxs("span", { className: "wchip num", children: ["\u2248", Math.round((state.exercises.benchA.weight * 0.65) / 5) * 5, " lb"] })
                                    : _jsx("button", { className: "wchip missing", onClick: goCalibrate, style: { cursor: "pointer", background: "none" }, children: "calibrate \u2192" })] }, i));
            })] }));
}
function TriToggle({ value, onChange }) {
    return (_jsxs("div", { className: "tri", children: [_jsx("button", { className: value === "down" ? "on down" : "", onClick: () => onChange("down"), title: "Reduce next time", children: "\u2193" }), _jsx("button", { className: value === "stay" ? "on stay" : "", onClick: () => onChange("stay"), title: "Stay", children: "=" }), _jsx("button", { className: value === "up" ? "on up" : "", onClick: () => onChange("up"), title: "Hit top reps clean \u2014 progress", children: "\u2191" })] }));
}
function WorkoutPanel({ session, tier, state, actions, today, onDone, autoOverride }) {
    const override = mergeDayOverrides(autoOverride, (state.dayWorkoutOverrides || {})[today]);
    const effectiveTier = override.tier || tier;
    const list = effectiveList(session, effectiveTier, state.sessionMods, override) || [];
    const signature = list.map((r) => r[0]).join("|") + ":" + effectiveTier;
    const [feel, setFeel] = useState(null);
    const [markers, setMarkers] = useState({});
    const [doneMap, setDoneMap] = useState({});
    const [benchW, setBenchW] = useState(state.exercises.benchA.weight || 145);
    const [benchReps, setBenchReps] = useState(["", "", "", ""]);
    const [pullups, setPullups] = useState("");
    const [note, setNote] = useState("");
    const [addOnOn, setAddOnOn] = useState(false);
    const [cbOn, setCbOn] = useState(false);
    const cbSlotOk = ["A", "B", "QR1"].indexOf(SLOT_OF[session.id]) >= 0;
    const isA = SLOT_OF[session.id] === "A";
    useEffect(() => { const m = {}; list.forEach((r) => { m[r[0]] = true; }); setDoneMap(m); }, [signature]);
    const weighted = list.map(([exId]) => exId).filter((exId, i, arr) => arr.indexOf(exId) === i).filter((exId) => {
        const ex = state.exercises[exId];
        return ex && !ex.bw && ex.weight != null && !(isA && exId === "benchA");
    });
    const save = () => {
        const completedIds = list.map((r) => r[0]).filter((id) => doneMap[id] !== false);
        const skippedIds = list.map((r) => r[0]).filter((id) => doneMap[id] === false);
        const payload = { feel, note, markers, extras: {}, data: {}, duration: effectiveTier, exercisesCompleted: completedIds, exercisesSkipped: skippedIds, status: skippedIds.length ? "partial" : "completed", sessionRpe: FEEL_RPE[feel] || null };
        if (session.kind === "run")
            payload.completionFraction = 1;
        if (session.addOn && addOnOn)
            payload.extras[session.addOn.key] = true;
        if (cbSlotOk && cbOn)
            payload.extras.cbSkill = true;
        if (isA && completedIds.includes("benchA")) {
            const reps = benchReps.map((r) => parseInt(r, 10)).filter((n) => Number.isFinite(n));
            if (reps.length) {
                payload.benchReps = benchReps.map((r) => parseInt(r, 10) || 0);
                payload.benchWeight = Number(benchW) || state.exercises.benchA.weight;
            }
            if (pullups.trim())
                payload.data.pullups = pullups.trim();
        }
        actions.completeSession(today, session.id, payload);
        onDone();
    };
    return (_jsxs("div", { className: "card tight", style: { borderColor: "var(--line2)" }, children: [_jsx("div", { className: "eyebrow", children: "Log what actually happened" }), _jsx("p", { className: "small dim", style: { marginTop: 5 }, children: "Tap any exercise or micro-module you skipped. Mixed days are intentional: the trainer credits only what you actually did and leaves important missing stimuli available later." }), list.length > 0 && _jsx("div", { style: { marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }, children: list.map(([exId]) => { const ex = state.exercises[exId]; const on = doneMap[exId] !== false; return _jsxs("button", { className: "chip" + (on ? " active" : ""), onClick: () => setDoneMap({ ...doneMap, [exId]: !on }), children: [on ? "✓ " : "skip · ", ex ? ex.name : exId] }, exId); }) }), isA && doneMap.benchA !== false && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "small dim", style: { marginBottom: 6 }, children: "Bench working sets (optional detail, but drives progression)" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [_jsx("input", { className: "input", style: { width: 84 }, value: benchW, onChange: (e) => setBenchW(e.target.value) }), _jsx("span", { className: "dim small", children: "lb \u00D7" }), benchReps.map((r, i) => _jsx("input", { className: "input", style: { width: 52 }, placeholder: "S" + (i + 1), value: r, onChange: (e) => setBenchReps(benchReps.map((x, j) => (j === i ? e.target.value : x))) }, i))] }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }, children: [_jsx("span", { className: "small dim", children: "Pull-ups" }), _jsx("input", { className: "input", style: { width: 140 }, placeholder: "8/8/7", value: pullups, onChange: (e) => setPullups(e.target.value) })] })] })), weighted.length > 0 && _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "small dim", style: { marginBottom: 4 }, children: "Load feedback \u2014 \u2191 only when clean top-of-range reps still leave ~1\u20132 reps" }), weighted.filter((id) => doneMap[id] !== false).map((exId) => { const ex = state.exercises[exId]; return _jsxs("div", { className: "exrow", children: [_jsxs("div", { children: [_jsx("div", { className: "exname", children: ex.name }), _jsxs("div", { className: "exmeta num", children: [ex.weight, " ", ex.unit, markers[exId] === "up" ? " → " + (ex.weight + (ex.inc || 5)) + " next" : markers[exId] === "down" ? " → " + Math.max(0, ex.weight - (ex.inc || 5)) + " next" : ""] })] }), _jsx(TriToggle, { value: markers[exId] || "stay", onChange: (m) => setMarkers({ ...markers, [exId]: m }) })] }, exId); })] }), (session.addOn || cbSlotOk) && _jsxs("div", { style: { marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }, children: [session.addOn && _jsxs("button", { className: "chip" + (addOnOn ? " active" : ""), onClick: () => setAddOnOn(!addOnOn), children: [addOnOn ? "✓ " : "+ ", session.addOn.label] }), cbSlotOk && _jsxs("button", { className: "chip" + (cbOn ? " active" : ""), onClick: () => setCbOn(!cbOn), children: [cbOn ? "✓ " : "+ ", "Coverage skills done"] })] }), _jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "small dim", style: { marginBottom: 6 }, children: "How hard was this?" }), _jsx("div", { className: "chips", children: ["Very Easy", "Easy", "Appropriate", "Hard", "Very Hard"].map((f) => _jsx("button", { className: "chip" + (feel === f ? " active" : ""), onClick: () => setFeel(f), children: f }, f)) })] }), _jsx("div", { style: { marginTop: 12 }, children: _jsx("input", { className: "input", placeholder: "Anything the trainer should remember? soreness, pain, too easy, equipment, etc.", value: note, onChange: (e) => setNote(e.target.value) }) }), _jsxs("div", { className: "btnrow", children: [_jsxs("button", { className: "btn good", onClick: save, children: [_jsx(Check, { size: 15 }), " Bank Actual Work"] }), _jsx("button", { className: "btn subtle", onClick: onDone, children: "Close" })] })] }));
}
function SkipModal({ onClose, onSkip }) {
    const reasons = ["Work", "Travel", "Fatigue", "Soreness", "Injury / pain", "Personal", "Other"];
    return (_jsxs(Modal, { onClose: onClose, children: [_jsx("div", { className: "eyebrow", children: "Skip today" }), _jsx("h2", { className: "sec", style: { marginTop: 6 }, children: "No streak to lose here" }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: "The session stays outstanding and the rest of the week re-plans around it. Reason is optional \u2014 it just sharpens future scheduling." }), _jsx("div", { className: "chips", style: { marginTop: 14 }, children: reasons.map((r) => (_jsx("button", { className: "chip", onClick: () => onSkip(r), children: r }, r))) }), _jsxs("div", { className: "btnrow", children: [_jsx("button", { className: "btn subtle", onClick: () => onSkip(""), children: "Skip without a reason" }), _jsx("button", { className: "btn subtle", onClick: onClose, children: "Cancel" })] })] }));
}
function MoveModal({ plan, today, slotId, onClose, onMove }) {
    const options = plan.days.filter((d) => d.date > today && (d.status === "planned" || d.status === "rest"));
    return (_jsxs(Modal, { onClose: onClose, children: [_jsx("div", { className: "eyebrow", children: "Move session" }), _jsx("h2", { className: "sec", style: { marginTop: 6 }, children: "Pick its new home" }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: "Everything else re-plans around the pin \u2014 recovery rules included." }), _jsxs("div", { className: "chips", style: { marginTop: 14 }, children: [options.map((d) => (_jsx("button", { className: "chip", onClick: () => onMove(d.date), children: fmtShort(d.date) }, d.date))), options.length === 0 && _jsx("span", { className: "small faint", children: "No open days left this week \u2014 skip instead and next week's plan front-loads it." })] }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "btn subtle", onClick: onClose, children: "Cancel" }) })] }));
}
function BudgetLedger({ done, compact }) {
    const rows = compact
        ? BUDGET_DEF.filter((b) => ["upperStrength", "qualityRun", "lowerAthletic", "coreMobility"].includes(b.key))
        : BUDGET_DEF;
    return (_jsx("div", { children: rows.map((b) => {
            const v = done[b.key] || 0;
            return (_jsxs("div", { className: "budgetrow", children: [_jsxs("div", { className: "lab", children: [b.label, b.optional ? " ·" : ""] }), _jsx(Bar, { val: v, max: b.target }), _jsxs("div", { className: "cnt num", children: [v, " / ", b.target, v >= b.min && v < b.target ? " ✓min" : v >= b.target ? " ✓" : ""] })] }, b.key));
        }) }));
}
function nextMilestone(phase) {
    if (phase === "pre")
        return "Combine opens Wed, Aug 19 — arrive fresh, not pre-fatigued.";
    if (phase === "cal")
        return "Sep 1 — Foundation begins with your calibrated loads, not guesses.";
    if (phase === "sep")
        return "Sep 29–30 monthly review: running trend, bench trend, knee tolerance, recovery.";
    if (phase === "oct")
        return "Oct 31 review — October decides how much intensity November has earned.";
    if (phase === "nov")
        return "December test window: mile, 5K, 225 attempt, 20+ pull-ups, muscle-up.";
    if (phase === "dec")
        return "Freshen, sharpen, test. The block was won in September–November.";
    return "Block complete — set the next one.";
}
function TodayView({ state, actions, plan, today, setTab }) {
    const dayPlan = plan.days.find((d) => d.date === today) || { status: "rest", id: null, reasons: [] };
    const session = dayPlan.id ? SESSIONS[dayPlan.id] : null;
    const phase = phaseOf(today);
    const availToday = state.settings.weekdayMinutes[dowMon0(today)];
    const defaultTier = snapTier(availToday == null ? 60 : availToday);
    const [tier, setTier] = useState(defaultTier);
    const [panelOpen, setPanelOpen] = useState(false);
    const [skipOpen, setSkipOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const mergedOverride = mergeDayOverrides(dayPlan.autoOverride, (state.dayWorkoutOverrides || {})[today]);
    const coachTier = mergedOverride.tier;
    useEffect(() => { setTier(coachTier || defaultTier); setPanelOpen(false); }, [today, dayPlan.id, coachTier, defaultTier]);
    const completed = dayPlan.status === "completed" || dayPlan.status === "partial";
    const partial = dayPlan.status === "partial";
    const isRun = session && session.kind === "run";
    const isCal = session && session.kind === "cal";
    const slot = session ? SLOT_OF[session.id] : null;
    const runRx = isRun ? (mergedOverride.runOverride || runRxFor(today, slot)) : null;
    const showAccel = isRun && slot === "QR1" && state.settings.knee === "good" && (phase === "sep" || phase === "oct" || phase === "nov");
    const cbStage = cbStageFor(state.settings.knee, state.settings.skillStage);
    const showCB = session && ["A", "B", "QR1"].indexOf(slot) >= 0 && !completed;
    return (_jsxs("div", { children: [_jsx(HelpCard, { state: state, actions: actions }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "scorehead", children: [_jsxs("div", { children: [_jsxs("div", { className: "eyebrow", children: [fmtLong(today), " \u00B7 ", PHASES[phase].chip] }), _jsx("h1", { className: "big", children: completed ? (partial ? "Partially banked: " : "Banked: ") + session.short + (partial ? "" : " ✓")
                                            : session ? session.name
                                                : "Open day" })] }), _jsx(KneeSelector, { knee: state.settings.knee, setKnee: actions.setKnee })] }), phase === "pre" && (_jsxs("p", { className: "small dim", style: { marginTop: 10 }, children: ["Preseason. The combine opens ", _jsx("b", { style: { color: "var(--text)" }, children: "Wednesday, Aug 19" }), " \u2014 baseline tests and load calibration, spread across ~10 days so nothing is exhausting. Today stays light on purpose."] })), !completed && session && (_jsxs("div", { style: { marginTop: 8 }, children: [_jsx("p", { className: "dim", style: { fontSize: 13.5 }, children: session.desc }), _jsxs("div", { style: { marginTop: 10 }, children: [_jsx("div", { className: "eyebrow", children: "Why this, today" }), dayPlan.reasons.map((r, i) => (_jsx("div", { className: "reason", children: r }, i))), dayPlan.pinned && _jsx("div", { className: "reason", children: "Pinned here by you." })] }), (session.variants || (mergedOverride.add && mergedOverride.add.length)) && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }, children: [_jsxs("div", { className: "eyebrow", children: [_jsx(Clock, { size: 11, style: { verticalAlign: "-1px" } }), " Time available"] }), tier === 15 && _jsx("span", { className: "mes", children: "MINIMUM EFFECTIVE SESSION" })] }), _jsx("div", { className: "chips", style: { marginTop: 8 }, children: [15, 25, 40, 60].map((t) => (_jsx("button", { className: "chip" + (tier === t ? " active" : ""), onClick: () => setTier(t), children: tierLabel(t) }, t))) }), tier === 15 && _jsx("p", { className: "small dim", style: { marginTop: 8 }, children: "Not a failed version of the long workout \u2014 the highest-priority stimulus, preserved on a busy day." }), mergedOverride.reason && _jsx("p", { className: "small", style: { color: "var(--accent)", marginTop: 8 }, children: mergedOverride.reason }), _jsx(ExerciseList, { session: session, tier: tier, state: state, date: today, autoOverride: dayPlan.autoOverride, goCalibrate: () => setTab("CALIBRATION") })] })), isRun && (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "eyebrow", children: "Prescription" }), _jsx("div", { className: "num", style: { fontSize: 17, marginTop: 6, color: "var(--ice)" }, children: runRx }), _jsx("p", { className: "small dim", style: { marginTop: 8 }, children: EFFORT_GUIDE }), showAccel && _jsx("p", { className: "small", style: { marginTop: 8, color: "var(--warn)" }, children: ACCEL_ADDON }), !state.calibration.values.trackLaps && (phase === "cal" || phase === "sep") && (_jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "Track unmeasured \u2014 workouts stay time/effort based until laps-per-mile is entered in Calibration." }))] })), isCal && (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "eyebrow", children: "Calibration rule" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: CAL_RULE }), _jsx("div", { className: "btnrow", children: _jsxs("button", { className: "btn sm", onClick: () => setTab("CALIBRATION"), children: [_jsx(Target, { size: 14 }), " Enter results in Calibration"] }) })] })), showCB && (_jsx("div", { style: { marginTop: 14 }, children: _jsxs(Collapse, { title: "Coverage Skills · Stage " + cbStage + " — " + CB_SKILL[cbStage - 1].name + " (8–10 min after warm-up)", children: [CB_SKILL[cbStage - 1].drills.map((d, i) => (_jsx("p", { style: { marginTop: i ? 4 : 0 }, children: d }, i))), _jsx("p", { className: "small", style: { marginTop: 8, color: "var(--warn)" }, children: CB_SKILL[cbStage - 1].note }), _jsx("p", { className: "small faint", style: { marginTop: 4 }, children: "Advance stages in Settings \u2014 or just tell the Coach. Knee status caps the stage automatically." })] }) })), !panelOpen && (_jsxs("div", { className: "btnrow", children: [_jsxs("button", { className: "btn primary", onClick: () => setPanelOpen(true), children: [_jsx(Zap, { size: 15 }), " Start Workout"] }), _jsxs("button", { className: "btn", onClick: () => setPanelOpen(true), children: [_jsx(Check, { size: 15 }), " Complete Workout"] }), session.required !== false && session.kind !== "recovery" && (_jsx("button", { className: "btn subtle", onClick: () => setSkipOpen(true), children: "Skip Today" })), _jsx("button", { className: "btn subtle", onClick: () => setMoveOpen(true), children: "Move / Reschedule" })] })), !panelOpen && (_jsxs("div", { className: "btnrow", style: { marginTop: 8 }, children: [_jsxs("button", { className: "btn warn sm", onClick: () => actions.setKnee("irritated"), children: [_jsx(AlertTriangle, { size: 13 }), " Knee Doesn't Feel Good"] }), _jsxs("button", { className: "btn subtle sm", onClick: () => actions.flagExhausted(today), children: [_jsx(Moon, { size: 13 }), " I'm Exhausted"] }), session.variants && tier < 60 && (_jsxs("button", { className: "btn subtle sm", onClick: () => setTier(tier === 15 ? 25 : tier === 25 ? 40 : 60), children: [_jsx(Plus, { size: 13 }), " I Have More Time Than Expected"] }))] }))] })), !completed && !session && (_jsx("p", { className: "dim", style: { marginTop: 8 }, children: "Nothing scheduled. Rest is part of the program." })), completed && (_jsxs("div", { style: { marginTop: 8 }, children: [_jsxs("p", { className: "dim", style: { fontSize: 13.5 }, children: [partial ? "Partial work is banked; omitted important stimuli can be recovered later" : "Today's work is in the bank", dayPlan.entry && dayPlan.entry.feel ? " — felt " + dayPlan.entry.feel.toLowerCase() : "", ". Optional add-on: 8 minutes of post-session mobility below."] }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "btn subtle sm", onClick: () => actions.undoDay(today), children: "Undo today's log" }) })] }))] }), panelOpen && session && (_jsx(WorkoutPanel, { session: session, tier: tier, state: state, actions: actions, today: today, autoOverride: dayPlan.autoOverride, onDone: () => setPanelOpen(false) })), _jsxs("div", { className: "grid2", children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "This week's budget" }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(BudgetLedger, { done: plan.done, compact: true }) }), _jsx("p", { className: "small dim", style: { marginTop: 10 }, children: plan.message }), _jsxs("div", { className: "btnrow", children: [_jsxs("button", { className: "btn sm", onClick: actions.recalc, children: [_jsx(RefreshCw, { size: 13 }), " Recalculate My Week"] }), _jsx("button", { className: "btn subtle sm", onClick: () => setTab("ROADMAP"), children: "Roadmap \u2192" })] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Next checkpoint" }), _jsx("p", { style: { marginTop: 8, fontSize: 13.5 }, children: nextMilestone(phase) }), _jsx("hr", { className: "hr" }), _jsx("div", { className: "eyebrow", children: "Trainer state" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: (() => { const f = FATIGUE_AREAS.concat(["systemic"]).map((a) => [a, fatigueLevelAt(state.fatigue, a, today)]).filter((x) => x[1] > 0); return f.length ? "Live fatigue: " + f.map((x) => x[0] + " " + x[1] + "/3").join(" · ") + ". Tell Coach if this is wrong or has resolved." : "No live fatigue flags. Tell Coach if something is sore, unusually easy/hard, or different from the plan."; })() }), _jsx("hr", { className: "hr" }), _jsx("div", { className: "eyebrow", children: "Recovery note" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: state.settings.knee === "irritated"
                                    ? "Knee is flagged: impact and provoking lower work are swapped out until you clear it. Pain-free posterior chain and low-impact cardio keep the block moving."
                                    : "Accumulate the adaptations. Do not protect the streak. If sleep or the job wrecked you, the Exhausted button is the strong move, not the weak one." })] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Warm-ups & mobility" }), _jsx("div", { style: { marginTop: 6 }, children: MOBILITY_BLOCKS.map((m) => (_jsx(Collapse, { title: m.title, children: _jsx("p", { children: m.body }) }, m.id))) })] }), skipOpen && (_jsx(SkipModal, { onClose: () => setSkipOpen(false), onSkip: (r) => { actions.skipSession(today, session.id, r); setSkipOpen(false); } })), moveOpen && session && (_jsx(MoveModal, { plan: plan, today: today, slotId: slot, onClose: () => setMoveOpen(false), onMove: (d) => { actions.pinSession(d, slot); setMoveOpen(false); } }))] }));
}
/* ------------------------------- WEEK VIEW ------------------------------- */
function SessionDetailModal({ day, state, actions, plan, today, setTab, onClose }) {
    const session = day.id ? SESSIONS[day.id] : null;
    const slot = session ? SLOT_OF[session.id] : null;
    const [tier, setTier] = useState(snapTier(state.settings.weekdayMinutes[dowMon0(day.date)] == null ? 60 : state.settings.weekdayMinutes[dowMon0(day.date)]));
    const entry = state.log.filter((e) => e.date === day.date && (e.status === "completed" || e.status === "partial")).slice(-1)[0];
    const inThisWeek = weekStartOf(day.date) === plan.weekStart;
    const moveTargets = inThisWeek && day.status === "planned" && slot && SLOT_OF[day.id] !== "REC"
        ? plan.days.filter((d) => d.date !== day.date && d.date >= today && (d.status === "planned" || d.status === "rest"))
        : [];
    const isRun = session && session.kind === "run";
    const isCal = session && session.kind === "cal";
    const isRec = session && (session.kind === "recovery");
    return (_jsxs(Modal, { onClose: onClose, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: 10 }, children: [_jsxs("div", { children: [_jsx("div", { className: "eyebrow", children: fmtLong(day.date) }), _jsx("h2", { className: "sec", style: { marginTop: 4, fontSize: 18 }, children: session ? session.name : "Rest day" })] }), _jsx("button", { className: "btn subtle sm", onClick: onClose, style: { alignSelf: "flex-start" }, children: _jsx(X, { size: 14 }) })] }), _jsxs("div", { style: { marginTop: 4 }, children: [_jsx("span", { className: "badge", style: day.status === "completed" ? { color: "var(--good)", borderColor: "rgba(67,201,138,.4)" } : {}, children: day.status === "completed" ? "COMPLETED" : day.status === "partial" ? "PARTIAL" : day.status === "skipped" ? "MOVED ON" : day.status === "planned" ? (weekStartOf(day.date) === plan.weekStart ? "PLANNED" : "PROJECTED") : day.status === "past" ? "NOT LOGGED" : "OPEN" }), session && session.required === false && session.kind !== "recovery" && _jsx("span", { className: "badge", style: { marginLeft: 6 }, children: "OPTIONAL" })] }), session && _jsx("p", { className: "small dim", style: { marginTop: 10 }, children: session.desc }), !session && _jsx("p", { className: "small dim", style: { marginTop: 10 }, children: "Nothing scheduled \u2014 rest is programmed, not a gap." }), session && session.variants && (_jsxs("div", { style: { marginTop: 12, maxHeight: "40vh", overflowY: "auto" }, children: [_jsx("div", { className: "chips", children: [15, 25, 40, 60].map((t) => (_jsx("button", { className: "chip" + (tier === t ? " active" : ""), onClick: () => setTier(t), children: tierLabel(t) }, t))) }), _jsx(ExerciseList, { session: session, tier: tier, state: state, goCalibrate: () => { onClose(); setTab("CALIBRATION"); } })] })), isRun && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "eyebrow", children: "Prescription" }), _jsx("div", { className: "num", style: { fontSize: 16, marginTop: 4, color: "var(--ice)" }, children: runRxFor(day.date, slot) }), _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: EFFORT_GUIDE })] })), isCal && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "eyebrow", children: "Calibration rule" }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: CAL_RULE })] })), isRec && (_jsx("p", { className: "small dim", style: { marginTop: 10 }, children: "Walk, easy mobility, breathing. The stimulus was earlier in the week \u2014 this is where it turns into adaptation." })), entry && (_jsxs("p", { className: "small", style: { marginTop: 10, color: "var(--good)" }, children: ["Logged", entry.feel ? " — felt " + entry.feel.toLowerCase() : "", entry.data && entry.data.bench ? " · bench " + entry.data.bench.w + " × " + entry.data.bench.reps : "", entry.data && entry.data.pullups ? " · pull-ups " + entry.data.pullups : ""] })), _jsxs("div", { className: "btnrow", children: [day.date === today && day.status === "planned" && (_jsxs("button", { className: "btn primary", onClick: () => { onClose(); setTab("TODAY"); }, children: [_jsx(Zap, { size: 14 }), " Log it on Today"] })), (day.status === "completed" || day.status === "partial") && (_jsx("button", { className: "btn subtle sm", onClick: () => { actions.undoDay(day.date); onClose(); }, children: "Undo this day" })), moveTargets.length > 0 && (_jsxs("div", { style: { width: "100%" }, children: [_jsx("div", { className: "small dim", style: { margin: "6px 0" }, children: "Move this session to:" }), _jsx("div", { className: "chips", children: moveTargets.map((d) => (_jsx("button", { className: "chip", onClick: () => { actions.pinSession(d.date, slot); onClose(); }, children: fmtShort(d.date) }, d.date))) })] }))] })] }));
}
function monthWeeks(anchor) {
    const y = parseInt(anchor.slice(0, 4), 10), m = parseInt(anchor.slice(5, 7), 10);
    const lastDay = new Date(y, m, 0).getDate();
    const pad = (n) => String(n).padStart(2, "0");
    let ws = weekStartOf(anchor + "-01");
    const end = weekStartOf(anchor + "-" + pad(lastDay));
    const out = [];
    while (ws <= end) {
        out.push(ws);
        ws = addDays(ws, 7);
    }
    return out;
}
function MonthView({ state, today, anchor, setAnchor, onDay }) {
    const weeks = monthWeeks(anchor);
    const plans = useMemo(() => {
        const map = {};
        weeks.forEach((ws) => {
            const ctxToday = weekStartOf(today) === ws ? today : (ws > today ? ws : addDays(ws, 6));
            map[ws] = planWeek({ today: ctxToday, log: state.log, pins: state.pins, dayFlags: state.dayFlags, settings: state.settings, knee: state.settings.knee, fatigue: state.fatigue });
        });
        return map;
    }, [state, anchor, today]);
    const y = parseInt(anchor.slice(0, 4), 10), m = parseInt(anchor.slice(5, 7), 10);
    const label = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const shift = (d) => {
        const nm = new Date(y, m - 1 + d, 1);
        setAnchor(nm.getFullYear() + "-" + String(nm.getMonth() + 1).padStart(2, "0"));
    };
    return (_jsxs("div", { style: { marginTop: 14 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("button", { className: "btn subtle sm", onClick: () => shift(-1), children: _jsx(ChevronLeft, { size: 14 }) }), _jsx("div", { style: { fontWeight: 750, minWidth: 150, textAlign: "center" }, children: label }), _jsx("button", { className: "btn subtle sm", onClick: () => shift(1), children: _jsx(ChevronRight, { size: 14 }) }), _jsx("span", { className: "small faint", style: { marginLeft: "auto" }, children: "Tap a day for the full session" })] }), _jsx("div", { className: "mhead", children: DOW_SHORT.map((d) => (_jsx("div", { children: d }, d))) }), weeks.map((ws) => (_jsx("div", { className: "mrow", children: plans[ws].days.map((d) => {
                    const inMonth = d.date.slice(0, 7) === anchor;
                    const s = d.id ? SESSIONS[d.id] : null;
                    return (_jsxs("button", { className: "mcell" + (d.date === today ? " today" : "") + ((d.status === "completed" || d.status === "partial") ? " completed" : "") + (inMonth ? "" : " out"), onClick: () => onDay(d, plans[ws]), children: [_jsx("span", { className: "mdate num", children: parseInt(d.date.slice(8), 10) }), _jsx("span", { className: "mname", children: s ? s.short : "" }), _jsx("span", { className: "mic", children: statusIcon(d.status, d.id) })] }, d.date));
                }) }, ws)))] }));
}
function WeekPlanner({ state, actions, plan, today, setTab }) {
    const [mode, setMode] = useState("week");
    const [anchor, setAnchor] = useState(today.slice(0, 7));
    const [detail, setDetail] = useState(null);
    return (_jsxs("div", { style: { marginTop: 14, border: "1px solid var(--line)", borderRadius: 10, padding: "14px 14px 16px", background: "var(--panel2)" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }, children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: mode === "week" ? "This week · " + fmtShort(plan.weekStart) : "Month planner" }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsxs("div", { className: "seg", children: [_jsx("button", { className: mode === "week" ? "on" : "", onClick: () => setMode("week"), children: "Week" }), _jsx("button", { className: mode === "month" ? "on" : "", onClick: () => { setAnchor(today.slice(0, 7)); setMode("month"); }, children: "Month" })] }), _jsxs("button", { className: "btn sm", onClick: actions.recalc, children: [_jsx(RefreshCw, { size: 13 }), " Recalculate"] })] })] }), _jsx("p", { className: "small dim", style: { marginTop: 8 }, children: plan.message }), plan.notes.map((n, i) => (_jsx("p", { className: "small", style: { color: "var(--warn)", marginTop: 6 }, children: n }, i))), mode === "week" && (_jsxs("div", { children: [_jsx("div", { className: "daystrip", children: plan.days.map((d) => {
                            const s = d.id ? SESSIONS[d.id] : null;
                            const cls = "daycell click" +
                                (d.date === today ? " today" : "") +
                                ((d.status === "completed" || d.status === "partial") ? " completed" : "") +
                                (s && s.required === false && s.kind !== "recovery" ? " optional" : "");
                            return (_jsxs("button", { className: cls, onClick: () => setDetail({ day: d }), children: [_jsx("div", { className: "dlab", children: fmtShort(d.date).toUpperCase() }), _jsx("div", { className: "dname", style: { color: d.status === "skipped" ? "var(--faint)" : "var(--text)" }, children: s ? s.short : d.status === "past" ? "—" : "Rest" }), _jsxs("div", { className: "dstat", children: [statusIcon(d.status, d.id), _jsx("span", { children: d.status === "completed" ? "done" :
                                                    d.status === "partial" ? "partial" :
                                                        d.status === "skipped" ? "moved on" :
                                                            d.status === "planned" ? (d.pinned ? "pinned" : s && s.kind === "recovery" ? "recovery" : s && s.required === false ? "optional" : "planned") :
                                                                d.status === "past" ? "" : "open" })] })] }, d.date));
                        }) }), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "Tap any day for the full workout \u2014 exercises, weights, and run prescription." }), plan.dropped.length > 0 && (_jsxs("p", { className: "small faint", style: { marginTop: 6 }, children: ["Deliberately not crammed in this week: ", plan.dropped.map((x) => SESSIONS[x.id].short).join(", "), " \u2014 ", plan.dropped[0].reason] }))] })), mode === "month" && (_jsx(MonthView, { state: state, today: today, anchor: anchor, setAnchor: setAnchor, onDay: (d) => setDetail({ day: d }) })), _jsx("hr", { className: "hr" }), _jsxs("div", { className: "eyebrow", children: ["Training budget \u2014 ", plan.calMode ? "combine block" : "how this week feeds the goals"] }), _jsx("div", { style: { marginTop: 8 }, children: plan.calMode ? _jsx(CalProgressMini, { state: state }) : _jsx(BudgetLedger, { done: plan.done }) }), !plan.calMode && (_jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "\u2713min = weekly floor met \u00B7 \u2713 = full target. Minimums protect the block; targets grow it. Priority when compressed: A \u00B7 Jam Day \u2192 one quality run \u2192 B \u00B7 Drive Day \u2192 C \u00B7 Ball Skills \u2192 second run \u2192 Walkthrough \u2192 Special Teams." })), detail && (_jsx(SessionDetailModal, { day: detail.day, state: state, actions: actions, plan: plan, today: today, setTab: setTab, onClose: () => setDetail(null) }))] }));
}
function CalProgressMini({ state }) {
    const done = state.log.filter((e) => e.status === "completed" && SESSIONS[e.sessionId] && SESSIONS[e.sessionId].kind === "cal").map((e) => SLOT_OF[e.sessionId]);
    const all = ["CAL_UP", "CAL_LOW", "CAL_TRACK", "CAL_ACCA", "CAL_ACCC"];
    const vals = state.calibration.values;
    const wDone = Object.keys(EXERCISE_DEFAULTS).filter((id) => EXERCISE_DEFAULTS[id].cal && state.exercises[id].weight != null).length;
    const wAll = Object.keys(EXERCISE_DEFAULTS).filter((id) => EXERCISE_DEFAULTS[id].cal).length;
    return (_jsxs("div", { children: [_jsxs("div", { className: "budgetrow", children: [_jsx("div", { className: "lab", children: "Combine sessions" }), _jsx(Bar, { val: done.length, max: all.length }), _jsxs("div", { className: "cnt num", children: [done.length, " / ", all.length] })] }), _jsxs("div", { className: "budgetrow", children: [_jsx("div", { className: "lab", children: "Working weights set" }), _jsx(Bar, { val: wDone, max: wAll }), _jsxs("div", { className: "cnt num", children: [wDone, " / ", wAll] })] }), _jsxs("div", { className: "budgetrow", children: [_jsx("div", { className: "lab", children: "Track measured" }), _jsx(Bar, { val: vals.trackLaps ? 1 : 0, max: 1 }), _jsx("div", { className: "cnt num", children: vals.trackLaps ? "1 / 1" : "0 / 1" })] })] }));
}
/* ------------------------------ PROGRAM VIEW ----------------------------- */
function ProgramTable({ slot }) {
    const rows = SESSION_TABLES[slot] || [];
    return (_jsxs("div", { style: { marginTop: 8 }, children: [_jsxs("div", { className: "ptable phead", children: [_jsx("div", { children: "Exercise" }), _jsx("div", { children: "Sets \u00D7 reps" }), _jsx("div", { children: "Rest" }), _jsx("div", { children: "Purpose" })] }), rows.map((r, i) => {
                const ex = EXERCISE_DEFAULTS[r[0]];
                return (_jsxs("div", { className: "ptable", children: [_jsx("div", { style: { fontWeight: 650 }, children: ex ? ex.name : r[0] }), _jsx("div", { className: "num", style: { color: "var(--ice)" }, children: r[1] }), _jsx("div", { className: "num dim", children: r[2] }), _jsx("div", { className: "dim", children: r[3] })] }, i));
            }), _jsxs("p", { className: "small", style: { marginTop: 10, color: "var(--accent)" }, children: [_jsx(Clock, { size: 11, style: { verticalAlign: "-1px" } }), " Time options \u2014 ", TIER_LINES[slot]] }), SESSION_CB_NOTES[slot] && _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: SESSION_CB_NOTES[slot] })] }));
}
function ProgramView({ state, actions, setTab }) {
    const cbStage = cbStageFor(state.settings.knee, state.settings.skillStage);
    const mods = state.sessionMods || {};
    return (_jsxs("div", { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "The playbook \u00B7 Cornerback Project V3" }), _jsx("h1", { className: "big", children: "Four workouts. Three runs. One skill track." }), _jsxs("p", { className: "small dim", style: { marginTop: 8 }, children: ["Every session below is the complete prescription from the program \u2014 full exercise tables with rest and purpose, plus the built-in ", _jsx("b", { style: { color: "var(--text)" }, children: "15 / 25 / 40 / 60-minute versions" }), " so a short day still moves the block forward. The Today screen serves the right version automatically; this page is the whole playbook."] }), _jsxs("p", { className: "small", style: { marginTop: 10, color: "var(--ice)" }, children: ["Priority if you only get four real sessions in a week: ", _jsx("b", { children: "A \u00B7 Jam Day \u2192 one quality run \u2192 B \u00B7 Drive Day \u2192 C \u00B7 Ball Skills." }), " Add the second quality run and the Walkthrough as schedule and recovery allow."] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Strength sessions \u2014 full tables" }), _jsxs("div", { style: { marginTop: 6 }, children: [_jsxs(Collapse, { title: SESSIONS.A.name, defaultOpen: true, children: [_jsx(ProgramTable, { slot: "A" }), mods.A && mods.A.add && mods.A.add.length > 0 && (_jsxs("p", { className: "small", style: { marginTop: 8, color: "var(--good)" }, children: ["Your adds: ", mods.A.add.map((a) => (state.exercises[a.id] ? state.exercises[a.id].name : a.id) + " (" + a.sr + ")").join(", ")] }))] }), _jsx(Collapse, { title: SESSIONS.B.name, children: _jsx(ProgramTable, { slot: "B" }) }), _jsx(Collapse, { title: SESSIONS.C.name, children: _jsx(ProgramTable, { slot: "C" }) }), _jsx(Collapse, { title: SESSIONS.D.name, children: _jsx(ProgramTable, { slot: "D" }) })] }), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "Want something in or out \u2014 say, more incline work? Tell the Coach: \"add incline bench 3\u00D78 to Jam Day.\" It lands in the 60/40-minute versions and never bloats the 15-minute minimum." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Running \u2014 September prescriptions" }), _jsxs("div", { className: "ptable phead", style: { gridTemplateColumns: "0.5fr 1.4fr 1.4fr 1fr" }, children: [_jsx("div", { children: "Wk" }), _jsx("div", { children: "Q1 \u00B7 Routes" }), _jsx("div", { children: "Q2 \u00B7 4th Quarter" }), _jsx("div", { children: "Walkthrough" })] }), [1, 2, 3, 4].map((w) => (_jsxs("div", { className: "ptable", style: { gridTemplateColumns: "0.5fr 1.4fr 1.4fr 1fr" }, children: [_jsx("div", { className: "num", style: { color: "var(--accent)" }, children: w }), _jsx("div", { className: "dim", children: RUN_RX[w].QR1 }), _jsx("div", { className: "dim", children: RUN_RX[w].QR2 }), _jsx("div", { className: "dim", children: RUN_RX[w].EASY })] }, w))), _jsx("p", { className: "small dim", style: { marginTop: 10 }, children: EFFORT_GUIDE }), _jsx("p", { className: "small", style: { marginTop: 6, color: "var(--warn)" }, children: ACCEL_ADDON }), _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "The mezzanine track is roughly 12\u201314 laps per mile, so September stays time/effort-based on purpose. Measure the straight during the Combine and October gets more precise." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Coverage Skills \u2014 the cornerback track" }), _jsxs("p", { className: "small dim", style: { marginTop: 6 }, children: ["8\u201310 minutes attached to Jam Day, Drive Day and Route Speed. This is where backpedal, hip turns, mirror work, acceleration and change-of-direction live \u2014 earned stage by stage, exactly like the program's knee ladder. Your current stage: ", _jsxs("b", { style: { color: "var(--accent)" }, children: ["Stage ", cbStage] }), cbStage !== state.settings.skillStage ? " (capped by knee status)" : "", "."] }), CB_SKILL.map((s) => (_jsxs("div", { style: { padding: "10px 0", borderBottom: s.stage < 4 ? "1px solid var(--line)" : "none", opacity: s.stage <= cbStage ? 1 : 0.55 }, children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }, children: [_jsxs("span", { className: "num", style: { color: s.stage <= cbStage ? "var(--good)" : "var(--faint)", fontWeight: 700 }, children: ["S", s.stage] }), _jsx("b", { style: { fontSize: 13.5 }, children: s.name }), _jsx("span", { className: "small faint", children: s.pace }), s.stage === cbStage && _jsx("span", { className: "badge", style: { color: "var(--accent)", borderColor: "var(--accent2)" }, children: "YOU ARE HERE" })] }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: s.drills.join(" · ") }), _jsx("p", { className: "small faint", style: { marginTop: 3 }, children: s.note })] }, s.stage))), _jsx("div", { className: "btnrow", children: _jsx("div", { className: "chips", children: [1, 2, 3, 4].map((n) => (_jsxs("button", { className: "chip" + (state.settings.skillStage === n ? " active" : ""), onClick: () => actions.setSkillStage(n), children: ["Stage ", n] }, n))) }) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Lower-body progression ladder \u2014 knee-conscious" }), KNEE_LADDER.map((k) => (_jsxs("div", { style: { padding: "10px 0", borderBottom: k.stage < 4 ? "1px solid var(--line)" : "none" }, children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline" }, children: [_jsxs("span", { className: "num", style: { color: "var(--accent)", fontWeight: 700 }, children: ["S", k.stage] }), _jsx("b", { style: { fontSize: 13.5 }, children: k.name }), _jsx("span", { className: "small faint", children: k.when })] }), _jsx("p", { className: "small dim", style: { marginTop: 3 }, children: k.moves })] }, k.stage))), _jsx("p", { className: "small", style: { color: "var(--warn)", marginTop: 12 }, children: "No exercise earns a place merely because it is \"athletic.\" Meaningful pain, swelling, instability or altered mechanics \u2192 stop or regress. September requires no heavy back squats, maximal jumps or hard cutting." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "September recommended flow \u2014 a map, not a rulebook" }), FLOW.map((f, i) => (_jsxs("div", { className: "ptable", style: { gridTemplateColumns: "0.7fr 2fr 1.3fr" }, children: [_jsx("div", { className: "num", style: { color: "var(--ice)" }, children: f[0] }), _jsx("div", { style: { fontWeight: 650 }, children: f[1] }), _jsx("div", { className: "dim", children: f[2] })] }, i))), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "If work removes a day, the engine uses the weekly budget and the priority order instead of blindly shifting every workout. That's the whole point." }), _jsx("div", { className: "btnrow", children: _jsxs("button", { className: "btn sm", onClick: () => setTab("ROADMAP"), children: [_jsx(Calendar, { size: 13 }), " See it on the Roadmap"] }) })] })] }));
}
/* ----------------------------- ROADMAP VIEW ------------------------------ */
function GoalRow({ g, snap, ov }) {
    const o = (ov || {})[g.key] || {};
    const tSec = o.targetSec != null ? o.targetSec : g.targetSec;
    const tVal = o.targetVal != null ? o.targetVal : g.targetVal;
    const tBand = o.targetVal != null ? o.targetVal : g.bandLo;
    const tLabel = o.label || g.target;
    let cur = "—", pct = 0;
    if (g.key === "mile") {
        cur = snap.mile;
        pct = pctTimeToward(snap.mile, g.startSec, tSec);
    }
    if (g.key === "fiveK") {
        cur = snap.fiveK;
        pct = pctTimeToward(snap.fiveK, g.startSec, tSec);
    }
    if (g.key === "bench") {
        cur = snap.bestBench + " lb";
        pct = Math.min(100, Math.round((100 * snap.bestBench) / tVal));
    }
    if (g.key === "pullup") {
        cur = snap.lastPull + " reps";
        pct = pctToward(snap.lastPull, g.startVal, tVal);
    }
    if (g.key === "mu") {
        cur = snap.mu ? "Done" : "Not yet";
        pct = snap.mu ? 100 : 0;
    }
    if (g.key === "bw") {
        cur = snap.lastBw + " lb";
        pct = pctToward(snap.lastBw, g.startVal, tBand);
    }
    if (g.key === "abs" || g.key === "speed") {
        cur = "tracked at review";
        pct = 0;
    }
    return (_jsxs("div", { className: "goalrow", children: [_jsx("div", { style: { fontWeight: 700, fontSize: 13.5 }, children: g.label }), _jsxs("div", { children: [_jsx(Bar, { val: pct, max: 100 }), _jsxs("div", { className: "small faint", style: { marginTop: 4 }, children: [g.start, " \u2192 ", tLabel] })] }), _jsx("div", { className: "num small", style: { textAlign: "right", color: "var(--ice)" }, children: cur })] }));
}
function RoadmapView({ state, actions, plan, today, setTab }) {
    const snap = goalSnapshot(state);
    const phase = phaseOf(today);
    const inMonths = ["sep", "oct", "nov", "dec"].indexOf(phase) >= 0;
    const blockKey = inMonths ? phase : (phase === "post" ? "post" : "aug");
    return (_jsxs("div", { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "North star \u00B7 Dec 31 targets" }), _jsx("h1", { className: "big", children: "Faster. Stronger. Leaner. More durable." }), _jsx("p", { className: "small dim", style: { marginTop: 8 }, children: "Judged by weekly accumulation and monthly progress \u2014 never by perfect daily streaks. Every bar below moves because of weeks like the one embedded further down." }), _jsx("div", { style: { marginTop: 14 }, children: GOALS.map((g) => (_jsx(GoalRow, { g: g, snap: snap, ov: state.goalOverrides }, g.key))) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Sep 1 \u2013 Dec 31 \u00B7 four blocks, one week at a time" }), blockKey === "aug" && (_jsxs("div", { className: "monthcard on", children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }, children: [_jsx("h2", { className: "sec", children: "August" }), _jsx("span", { className: "badge", children: "COMBINE" }), _jsx("span", { className: "small faint", children: "Aug 19 \u2013 30" }), _jsx("span", { className: "badge", style: { color: "var(--accent)", borderColor: "var(--accent2)" }, children: "NOW" })] }), _jsxs("p", { className: "small dim", style: { marginTop: 6 }, children: [_jsx("b", { style: { color: "var(--ice)" }, children: "Mission \u00B7 " }), "Capture every baseline fresh \u2014 bench, pull-ups, explosive pull height, track laps \u2014 and calibrate all working weights so September runs on data, not guesses."] }), _jsx(WeekPlanner, { state: state, actions: actions, plan: plan, today: today, setTab: setTab })] })), ROADMAP.map((m) => (_jsxs("div", { className: "monthcard" + (phase === m.key ? " on" : ""), children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }, children: [_jsx("h2", { className: "sec", children: m.month }), _jsx("span", { className: "badge", children: m.theme }), _jsx("span", { className: "small faint", children: m.range }), phase === m.key && _jsx("span", { className: "badge", style: { color: "var(--accent)", borderColor: "var(--accent2)" }, children: "NOW" })] }), _jsxs("p", { className: "small dim", style: { marginTop: 6 }, children: [_jsx("b", { style: { color: "var(--ice)" }, children: "Performance \u00B7 " }), m.perf] }), _jsxs("p", { className: "small dim", style: { marginTop: 4 }, children: [_jsx("b", { style: { color: "var(--ice)" }, children: "Body / strength / skill \u00B7 " }), m.body] }), phase === m.key && (_jsx(WeekPlanner, { state: state, actions: actions, plan: plan, today: today, setTab: setTab }))] }, m.key))), blockKey === "post" && (_jsxs("div", { className: "monthcard on", children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }, children: [_jsx("h2", { className: "sec", children: "Beyond Dec 31" }), _jsx("span", { className: "badge", style: { color: "var(--accent)", borderColor: "var(--accent2)" }, children: "NOW" })] }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "The block is complete \u2014 this week still plans itself while you set the next one." }), _jsx(WeekPlanner, { state: state, actions: actions, plan: plan, today: today, setTab: setTab })] })), _jsx("p", { className: "small faint", style: { marginTop: 16 }, children: "Monthly checkpoint rule: not \"did every workout happen\" \u2014 did running fitness improve, did key lifts progress, is bodyweight moving right, is the knee tolerating load, is recovery stable. Then the next month adjusts." })] }), _jsx("div", { className: "footer-safety", children: "Safety: unexplained chest pressure/tightness, fainting, marked shortness of breath, or sustained abnormal palpitations during training are reasons to stop hard exercise and seek medical evaluation. Persistent or worsening knee pain, swelling, instability, locking, or gait change should be evaluated before progressing impact or speed work." })] }));
}
/* --------------------------- PERFORMANCE VIEW ---------------------------- */
function MiniChart({ data, color, unit }) {
    if (!data || data.length < 2) {
        return _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "Two or more entries draw the trend line." });
    }
    return (_jsx("div", { style: { height: 170, marginTop: 8 }, children: _jsx(ResponsiveContainer, { width: "100%", height: "100%", children: _jsxs(LineChart, { data: data, margin: { top: 8, right: 8, bottom: 0, left: -18 }, children: [_jsx(CartesianGrid, { stroke: "#1D2736", strokeDasharray: "3 3" }), _jsx(XAxis, { dataKey: "d", tick: { fill: "#55627A", fontSize: 10, fontFamily: "monospace" }, tickLine: false, axisLine: { stroke: "#1D2736" } }), _jsx(YAxis, { domain: ["auto", "auto"], tick: { fill: "#55627A", fontSize: 10, fontFamily: "monospace" }, tickLine: false, axisLine: { stroke: "#1D2736" } }), _jsx(Tooltip, { contentStyle: { background: "#101724", border: "1px solid #27344A", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "#7E8CA0" }, formatter: (v) => [v + (unit ? " " + unit : ""), ""] }), _jsx(Line, { type: "monotone", dataKey: "v", stroke: color, strokeWidth: 2, dot: { r: 2.5, fill: color } })] }) }) }));
}
function QuickLog({ label, unit, onSave, placeholder }) {
    const [v, setV] = useState("");
    return (_jsxs("div", { style: { display: "flex", gap: 8, alignItems: "flex-end" }, children: [_jsxs("div", { className: "field", style: { flex: 1 }, children: [_jsxs("label", { children: [label, unit ? " (" + unit + ")" : ""] }), _jsx("input", { className: "input", value: v, placeholder: placeholder || "", onChange: (e) => setV(e.target.value) })] }), _jsx("button", { className: "btn sm", onClick: () => { if (v.trim()) {
                    onSave(v.trim());
                    setV("");
                } }, children: "Log" })] }));
}
function PerformanceView({ state, actions, plan, today }) {
    const snap = goalSnapshot(state);
    const [wear, setWear] = useState(null);
    useEffect(() => {
        let alive = true;
        Promise.all([healthProvider.getRestingHeartRate(), healthProvider.getHRV(), healthProvider.getVO2Max(), healthProvider.getSleep(), healthProvider.getSteps()])
            .then(([rhr, hrv, vo2, sleep, steps]) => { if (alive)
            setWear({ rhr, hrv, vo2, sleep, steps }); });
        return () => { alive = false; };
    }, []);
    const bwData = state.metrics.bodyweight.map((x) => ({ d: x.date.slice(5), v: Number(x.v) }));
    const benchData = state.exercises.benchA.history.filter((h) => h.w).map((h) => ({ d: h.date.slice(5), v: h.w }));
    const pullData = state.metrics.pullupBest.map((x) => ({ d: x.date.slice(5), v: Number(x.v) }));
    const recent = [...state.log].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    return (_jsxs("div", { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Performance ledger" }), _jsxs("div", { className: "kpis", children: [_jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Bench working" }), _jsxs("div", { className: "v", children: [state.exercises.benchA.weight, " lb"] })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Best pull-ups" }), _jsx("div", { className: "v", children: snap.lastPull })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Bodyweight" }), _jsxs("div", { className: "v", children: [snap.lastBw, " lb"] })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Week workload" }), _jsxs("div", { className: "v", children: [plan.pct, "%"] })] })] })] }), _jsxs("div", { className: "grid2", children: [_jsxs("div", { className: "card", children: [_jsxs("div", { className: "eyebrow", children: [_jsx(TrendingUp, { size: 11, style: { verticalAlign: "-1px" } }), " Bench working weight"] }), _jsx(MiniChart, { data: benchData, color: "#6B9BEF", unit: "lb" })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Bodyweight" }), _jsx(MiniChart, { data: bwData, color: "#43C98A", unit: "lb" })] })] }), _jsxs("div", { className: "grid2", children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Strict pull-up tests" }), _jsx(MiniChart, { data: pullData, color: "#DFAE4F", unit: "reps" })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Log a number" }), _jsxs("div", { style: { display: "grid", gap: 12, marginTop: 8 }, children: [_jsx(QuickLog, { label: "Morning bodyweight", unit: "lb", placeholder: "158.4", onSave: (v) => actions.logMetric("bodyweight", v, today) }), _jsx(QuickLog, { label: "Waist at navel", unit: "in", placeholder: "31.0", onSave: (v) => actions.logMetric("waist", v, today) }), _jsx(QuickLog, { label: "Strict pull-up test", unit: "reps", placeholder: "16", onSave: (v) => actions.logMetric("pullup", Number(v), today) }), _jsx(QuickLog, { label: "Mile time trial", unit: "mm:ss", placeholder: "5:49", onSave: (v) => actions.logMetric("mile", v, today) }), _jsx(QuickLog, { label: "5K time trial", unit: "mm:ss", placeholder: "21:10", onSave: (v) => actions.logMetric("fiveK", v, today) }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("span", { className: "small dim", children: "First clean bar muscle-up" }), _jsx("button", { className: "chip" + (state.metrics.muscleUp ? " active" : ""), onClick: () => actions.logMetric("muscleUp", !state.metrics.muscleUp, today), children: state.metrics.muscleUp ? "✓ Done" : "Not yet" })] })] })] })] }), _jsxs("div", { className: "grid2", children: [_jsxs("div", { className: "card", children: [_jsxs("div", { className: "eyebrow", children: ["Wearable feed \u00B7 ", wear ? "mock provider" : "loading"] }), wear && (_jsxs("div", { className: "kpis", style: { gridTemplateColumns: "repeat(2,1fr)" }, children: [_jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Resting HR" }), _jsx("div", { className: "v", children: wear.rhr.latest })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "HRV" }), _jsx("div", { className: "v", children: wear.hrv.latest })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "VO\u2082 est" }), _jsx("div", { className: "v", children: wear.vo2.latest })] }), _jsxs("div", { className: "kpi", children: [_jsx("div", { className: "l", children: "Sleep" }), _jsxs("div", { className: "v", children: [wear.sleep.lastNightHrs, "h"] })] })] })), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "HealthDataProvider abstraction \u2014 future path: Apple Watch \u2192 Apple Health \u2192 iOS companion app \u2192 this dashboard. Browser JS never reads HealthKit directly." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Recent sessions" }), _jsxs("div", { style: { marginTop: 6 }, children: [recent.length === 0 && _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "Sessions appear here once logged." }), recent.map((e, i) => (_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line)" }, children: [_jsx("span", { className: "num small faint", style: { width: 74 }, children: fmtShort(e.date) }), _jsx("span", { style: { fontSize: 13, fontWeight: 650 }, children: SESSIONS[e.sessionId] ? SESSIONS[e.sessionId].short : e.sessionId }), _jsx("span", { className: "small", style: { marginLeft: "auto", color: e.status === "completed" ? "var(--good)" : e.status === "partial" ? "var(--warn)" : "var(--faint)" }, children: e.status === "completed" ? "✓ " + (e.feel || "done") : e.status === "partial" ? "partial" + (e.feel ? " · " + e.feel : "") : "moved on" })] }, i)))] })] })] }), _jsxs("div", { className: "grid2", children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Coach notes \u2014 how the days felt" }), _jsxs("div", { style: { marginTop: 6 }, children: [state.notesLog.length === 0 && _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "Tell the Coach how you feel (\"slept 5h, quads sore\") and it lands here." }), [...state.notesLog].slice(-6).reverse().map((n, i) => (_jsxs("div", { style: { display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)" }, children: [_jsx("span", { className: "num small faint", style: { width: 74, flexShrink: 0 }, children: fmtShort(n.date) }), _jsx("span", { className: "small dim", children: n.text })] }, i)))] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Fuel notes" }), _jsxs("div", { style: { marginTop: 6 }, children: [state.nutrition.length === 0 && _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "\"Ate a chipotle bowl + shake\" \u2192 logged here. Awareness beats macros math for this block." }), [...state.nutrition].slice(-6).reverse().map((n, i) => (_jsxs("div", { style: { display: "flex", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line)" }, children: [_jsx("span", { className: "num small faint", style: { width: 74, flexShrink: 0 }, children: fmtShort(n.date) }), _jsx("span", { className: "small dim", children: n.text })] }, i)))] })] })] })] }));
}
/* --------------------------- CALIBRATION VIEW ---------------------------- */
function CalibrationView({ state, actions }) {
    const groups = [["A", "Upper A accessories"], ["B", "Lower athletic"], ["C", "Upper B accessories"], ["D", "Full-body optional"]];
    const calDoneSlots = new Set(state.log.filter((e) => e.status === "completed").map((e) => SLOT_OF[e.sessionId]));
    return (_jsxs("div", { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Aug 19 \u2013 30 \u00B7 combine + calibration" }), _jsx("h1", { className: "big", children: "Baselines first. Then the block." }), _jsx("p", { className: "small dim", style: { marginTop: 8 }, children: "Nothing in September runs on guessed weights. Establish the data without exhausting yourself \u2014 these values auto-populate every September workout, and you can override any of them here at any time." }), _jsxs("div", { className: "card tight", style: { marginTop: 14, borderColor: "var(--accent2)", background: "var(--panel2)" }, children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "Calibration rule" }), _jsx("p", { className: "small", style: { marginTop: 6 }, children: CAL_RULE })] }), _jsxs("div", { style: { marginTop: 14 }, children: [_jsx("div", { className: "eyebrow", children: "Combine sessions" }), ["CAL_UP", "CAL_LOW", "CAL_TRACK", "CAL_ACCA", "CAL_ACCC"].map((id) => (_jsxs("div", { style: { display: "flex", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line)", alignItems: "baseline" }, children: [calDoneSlots.has(id) ? _jsx(Check, { size: 14, color: "var(--good)", style: { flexShrink: 0, position: "relative", top: 2 } }) : _jsx("span", { className: "num faint", style: { width: 14 }, children: "\u00B7" }), _jsxs("div", { children: [_jsx("b", { style: { fontSize: 13.5 }, children: SESSIONS[id].name }), _jsx("p", { className: "small dim", style: { marginTop: 2 }, children: SESSIONS[id].desc })] })] }, id))), _jsx("p", { className: "small faint", style: { marginTop: 8 }, children: "The Today screen schedules these across the window. Complete them from Today; enter the numbers here." })] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Baseline tests & measurements" }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12, marginTop: 10 }, children: CAL_BASELINES.map((b) => (_jsxs("div", { className: "field", children: [_jsxs("label", { children: [b.label, b.unit ? " · " + b.unit : ""] }), _jsx("input", { className: "input", value: state.calibration.values[b.key] || "", placeholder: b.seed || "", onChange: (e) => actions.saveCalValue(b.key, e.target.value) })] }, b.key))) }), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "Mile 5:57 and 5K 21:55 are the established baselines \u2014 retested in December. Track laps-per-mile and straight length unlock more precise October running." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Working weights \u2014 populate September automatically" }), groups.map(([g, label]) => {
                        const list = Object.entries(state.exercises).filter(([, ex]) => ex.group === g && (ex.cal || ex.weight != null) && !ex.bw);
                        if (!list.length)
                            return null;
                        return (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "small", style: { color: "var(--ice)", fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", fontSize: 11 }, children: label }), list.map(([id, ex]) => (_jsxs("div", { className: "exrow", children: [_jsxs("div", { children: [_jsx("div", { className: "exname", children: ex.name }), _jsxs("div", { className: "exmeta", children: [ex.weight == null ? "not calibrated — conservative load, 2–3 in reserve" : "progresses by " + (ex.inc || 5) + " " + ex.unit.split(" ")[0], id === "benchA" ? " · +5 only when all 4 sets hit 6 clean" : ""] })] }), _jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center" }, children: [_jsx("input", { className: "input", style: { width: 84 }, value: ex.weight == null ? "" : ex.weight, placeholder: "\u2014", onChange: (e) => { const v = e.target.value.trim(); actions.setExerciseWeight(id, v === "" ? null : Number(v)); } }), _jsx("span", { className: "small faint", style: { width: 54 }, children: ex.unit })] })] }, id)))] }, g));
                    })] })] }));
}
/* ----------------------------- SETTINGS VIEW ----------------------------- */
function SettingsView({ state, actions }) {
    const [importText, setImportText] = useState("");
    const [showExport, setShowExport] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const backend = typeof window !== "undefined" && window.storage ? "app persistent storage" : (typeof window !== "undefined" && window.localStorage ? "localStorage" : "in-memory (this session only)");
    const notifState = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    const askNotif = () => { try {
        if (typeof Notification !== "undefined" && Notification.permission === "default")
            Notification.requestPermission();
    }
    catch (e) { } };
    return (_jsxs("div", { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Default availability \u00B7 minutes per weekday" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "New job, new hours? Change these and every future week re-plans itself. 0 = no training window that day." }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 10, marginTop: 12 }, children: DOW_SHORT.map((d, i) => (_jsxs("div", { className: "field", children: [_jsx("label", { children: d }), _jsx("input", { className: "input", value: state.settings.weekdayMinutes[i], onChange: (e) => actions.setAvailability(i, Math.max(0, parseInt(e.target.value, 10) || 0)) })] }, d))) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "eyebrow", children: [_jsx(Bell, { size: 11, style: { verticalAlign: "-1px" } }), " Daily workout reminder"] }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "A \"here's today's session\" nudge at your chosen time. Works while the app is open in a tab; true background push arrives with the iOS companion." }), _jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }, children: [_jsx("button", { className: "chip" + (state.settings.reminderOn ? " active" : ""), onClick: () => { if (!state.settings.reminderOn)
                                    askNotif(); actions.setReminder(!state.settings.reminderOn, state.settings.reminderTime); }, children: state.settings.reminderOn ? "✓ Reminder on" : "Reminder off" }), _jsx("input", { className: "input", style: { width: 110 }, value: state.settings.reminderTime, onChange: (e) => actions.setReminder(state.settings.reminderOn, e.target.value), placeholder: "07:00" }), _jsxs("span", { className: "small faint", children: ["Browser permission: ", notifState] })] })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "eyebrow", children: [_jsx(MessageCircle, { size: 11, style: { verticalAlign: "-1px" } }), " AI Coach"] }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "The chat button (bottom-right) logs sessions, weights, food, goal changes and recalculations from plain English. Inside Claude it runs on a built-in Claude model \u2014 zero setup, no key. Self-hosting later? Switch to your own OpenAI key below and it just works." }), _jsxs("div", { className: "chips", style: { marginTop: 12 }, children: [_jsx("button", { className: "chip" + (state.settings.aiProvider === "claude" ? " active" : ""), onClick: () => actions.setAIProvider("claude"), children: "Built-in Claude (no key)" }), _jsx("button", { className: "chip" + (state.settings.aiProvider === "openai" ? " active" : ""), onClick: () => actions.setAIProvider("openai"), children: "My OpenAI key" })] }), state.settings.aiProvider === "openai" && (_jsxs("div", { style: { marginTop: 10 }, children: [_jsx("input", { className: "input", type: "password", placeholder: "sk-...", value: state.settings.openaiKey, onChange: (e) => actions.setOpenAIKey(e.target.value) }), _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "Stored locally with the rest of your data, sent only to api.openai.com. Note: browser calls to OpenAI are usually blocked inside Claude.ai \u2014 the coach auto-falls back to built-in Claude here and uses your key once self-hosted." })] })), _jsxs("div", { className: "field", style: { marginTop: 12 }, children: [_jsx("label", { children: "Self-host endpoint (optional)" }), _jsx("input", { className: "input", placeholder: "https://your-app.vercel.app/api/coach", value: state.settings.coachEndpoint, onChange: (e) => actions.setCoachEndpoint(e.target.value) })] }), _jsx("p", { className: "small faint", style: { marginTop: 6 }, children: "When you deploy this outside Claude, point this at a tiny server route that holds your API key (never put keys in browser code \u2014 a proxy recipe is commented in the source next to coachTurn). Chain: your endpoint \u2192 your OpenAI key \u2192 built-in Claude." }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "btn subtle sm", onClick: actions.clearChat, children: "Clear chat history" }) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "eyebrow", children: [_jsx(Activity, { size: 11, style: { verticalAlign: "-1px" } }), " Apple Health & Watch"] }), _jsxs("p", { className: "small dim", style: { marginTop: 6 }, children: ["Status: ", _jsx("b", { style: { color: state.health.connected ? "var(--good)" : "var(--warn)" }, children: state.health.connected ? "connected (demo feed)" : "not connected" }), ". Browsers can't read HealthKit directly \u2014 the app is built against a HealthDataProvider interface, so the future iOS companion (Watch \u2192 Apple Health \u2192 app) drops in without UI changes. Until then, connecting streams realistic demo data into Performance."] }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "btn sm", onClick: () => actions.setHealthConnected(!state.health.connected), children: state.health.connected ? "Disconnect" : "Connect health feed" }) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Coverage Skills stage" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "The cornerback footwork/speed track attached to Jam Day, Drive Day and Route Speed. Advance only when the current stage feels easy and the knee stays quiet \u2014 knee status caps it automatically (flagged \u2192 Stage 1, watch \u2192 Stage 2)." }), _jsx("div", { className: "chips", style: { marginTop: 10 }, children: [1, 2, 3, 4].map((n) => (_jsxs("button", { className: "chip" + (state.settings.skillStage === n ? " active" : ""), onClick: () => actions.setSkillStage(n), children: ["Stage ", n, " \u00B7 ", CB_SKILL[n - 1].name] }, n))) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Knee status" }), _jsx("div", { style: { marginTop: 10 }, children: _jsx(KneeSelector, { knee: state.settings.knee, setKnee: actions.setKnee }) }), _jsx("p", { className: "small faint", style: { marginTop: 10 }, children: "Flagged = quality runs become low-impact cardio, Lower Athletic runs Stage-1-only, accelerations disappear. Never train through significant pain \u2014 persistent symptoms get evaluated, not managed by an app." })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Preview a different date" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "See how the engine plans any week (blank = real today)." }), _jsxs("div", { style: { display: "flex", gap: 8, marginTop: 10, alignItems: "center" }, children: [_jsx("input", { className: "input", style: { maxWidth: 180 }, placeholder: "YYYY-MM-DD", value: state.settings.simDate, onChange: (e) => actions.setSimDate(e.target.value) }), state.settings.simDate && _jsx("button", { className: "btn subtle sm", onClick: () => actions.setSimDate(""), children: "Back to today" })] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Data" }), _jsxs("p", { className: "small dim", style: { marginTop: 6 }, children: ["Storage backend: ", _jsx("b", { style: { color: "var(--ice)" }, children: backend }), ". Everything lives on your side \u2014 export any time."] }), _jsxs("div", { className: "btnrow", children: [_jsx("button", { className: "btn sm", onClick: () => setShowExport(!showExport), children: showExport ? "Hide export" : "Export JSON" }), _jsx("button", { className: "btn subtle sm", onClick: actions.replayOnboarding, children: "Replay setup tour" }), !confirmReset ? (_jsx("button", { className: "btn warn sm", onClick: () => setConfirmReset(true), children: "Reset all data" })) : (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn warn sm", onClick: () => { actions.resetAll(); setConfirmReset(false); }, children: "Confirm reset \u2014 this wipes everything" }), _jsx("button", { className: "btn subtle sm", onClick: () => setConfirmReset(false), children: "Cancel" })] }))] }), showExport && (_jsx("textarea", { className: "input", style: { marginTop: 10, minHeight: 120, fontSize: 11 }, readOnly: true, value: JSON.stringify(state, null, 1), onFocus: (e) => e.target.select() })), _jsxs("div", { style: { marginTop: 12 }, children: [_jsx("div", { className: "small dim", style: { marginBottom: 6 }, children: "Import (paste an export)" }), _jsx("textarea", { className: "input", style: { minHeight: 80, fontSize: 11 }, value: importText, onChange: (e) => setImportText(e.target.value) }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "btn sm", onClick: () => { if (actions.importJson(importText))
                                        setImportText(""); }, children: "Import" }) })] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "eyebrow", children: "Program data" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "The Cornerback V3 program (sessions, budgets, running prescriptions, priorities) is seeded as an editable data layer, separate from the UI and the scheduling engine. Working weights are editable in Calibration; goals are editable by telling the Coach; deeper edits travel through export/import. October\u2013December programming finalizes at each monthly review, exactly as the program intends." })] })] }));
}
/* --------------------------------- APP ----------------------------------- */
function HelpCard({ state, actions }) {
    if (state.ui.helpDismissed)
        return null;
    return (_jsxs("div", { className: "card tight", style: { borderColor: "var(--accent2)" }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: 10 }, children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "How this works \u2014 20 seconds" }), _jsx("button", { className: "btn subtle sm", onClick: actions.dismissHelp, children: _jsx(X, { size: 13 }) })] }), _jsxs("p", { className: "small", style: { marginTop: 8 }, children: [_jsx("span", { className: "helpnum", children: "1" }), "You're not chasing a calendar. Each week has a ", _jsx("b", { children: "budget" }), " (2 upper, 2 runs, 1 lower\u2026). Miss a day and the week reflows \u2014 nothing is \"lost\"."] }), _jsxs("p", { className: "small", style: { marginTop: 6 }, children: [_jsx("span", { className: "helpnum", children: "2" }), "The buttons do the thinking. ", _jsx("b", { children: "Skip" }), ", ", _jsx("b", { children: "Move" }), ", ", _jsx("b", { children: "I'm Exhausted" }), ", ", _jsx("b", { children: "Knee" }), " \u2014 press one and the schedule rebuilds safely around it."] }), _jsxs("p", { className: "small", style: { marginTop: 6 }, children: [_jsx("span", { className: "helpnum", children: "3" }), "The named workouts are anchors, not a split. The trainer can mix compatible modules \u2014 pull-ups + easy aerobic, arms on an easy day, or a condensed lift + light run \u2014 when that is the best way to close your weekly gaps. Tell the ", _jsx("b", { children: "Coach" }), ": \"done\", \"I only did 15 minutes\", \"that was too easy\", or \"rebuild the week\"."] })] }));
}
/* ------------------------------ Coach chat ------------------------------- */
async function claudeCall(sys, msgs) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system: sys, messages: msgs }),
    });
    const d = await r.json();
    const text = (d.content || []).map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
    return parseCoachReply(text);
}
/* Self-hosting: never ship an API key in browser code. Deploy a ~15-line proxy
   (Vercel function / Replit endpoint) that forwards the request body to
   https://api.anthropic.com/v1/messages with headers
   { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01",
     "content-type": "application/json" }
   and returns the JSON unchanged. Paste its URL in Settings → AI Coach.
   The chain below tries: your proxy → your OpenAI key → built-in Claude. */
async function coachTurn(state, plan, today, userText) {
    const sys = buildCoachSystem(state, plan, today);
    const history = state.chat.slice(-8).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
    const msgs = [...history, { role: "user", content: userText }];
    if (state.settings.coachEndpoint) {
        try {
            const r = await fetch(state.settings.coachEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system: sys, messages: msgs }),
            });
            if (!r.ok)
                throw new Error("proxy " + r.status);
            const d = await r.json();
            const text = Array.isArray(d.content)
                ? d.content.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n")
                : (typeof d.text === "string" ? d.text : "");
            if (text)
                return parseCoachReply(text);
            throw new Error("proxy empty");
        }
        catch (e) { /* fall through to the next provider */ }
    }
    if (state.settings.aiProvider === "openai" && state.settings.openaiKey) {
        try {
            const r = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.settings.openaiKey },
                body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 600, messages: [{ role: "system", content: sys }].concat(msgs) }),
            });
            if (!r.ok)
                throw new Error("openai " + r.status);
            const d = await r.json();
            return parseCoachReply(d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : "");
        }
        catch (e) {
            const res = await claudeCall(sys, msgs);
            return { reply: "(OpenAI is unreachable from this environment, so the built-in coach answered. Your key kicks in automatically once self-hosted.)\n\n" + res.reply, actions: res.actions };
        }
    }
    return claudeCall(sys, msgs);
}
function findExerciseByName(exercises, name) {
    const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/s$/, "");
    const qRaw = String(name || "").toLowerCase().trim();
    const q = norm(qRaw);
    if (!q)
        return null;
    const aliases = { bench: "benchA", pullup: "pullup", curl: "hammer", tricep: "pressdown", rdl: "rdl", hipthrust: "hipThrust", pulldown: "pulldown", row: "csRow", lateralraise: "latRaise" };
    if (aliases[q] && exercises[aliases[q]])
        return [aliases[q], exercises[aliases[q]]];
    let best = null;
    Object.entries(exercises).forEach(([id, ex]) => { if (!best && (norm(ex.name) === q || norm(id) === q))
        best = [id, ex]; });
    if (best)
        return best;
    Object.entries(exercises).forEach(([id, ex]) => { const n = norm(ex.name); if (!best && (n.includes(q) || q.includes(n)))
        best = [id, ex]; });
    return best;
}
function runCoachActions(list, ctx) {
    const { state, actions, plan, today } = ctx;
    const out = [];
    const dayOf = (date) => plan.days.find((d) => d.date === date);
    (list || []).slice(0, 6).forEach((a) => {
        if (!a || typeof a.type !== "string")
            return;
        const date = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : today;
        try {
            if (a.type === "complete_session") {
                const d = dayOf(date);
                if (d && (d.status === "completed" || d.status === "partial"))
                    out.push("• " + fmtShort(date) + " was already logged");
                else if (d && d.id) {
                    const ss = SESSIONS[d.id];
                    const tier = snapTier(state.settings.weekdayMinutes[dowMon0(date)] == null ? 60 : state.settings.weekdayMinutes[dowMon0(date)]);
                    const fullList = effectiveList(ss, tier, state.sessionMods, (state.dayWorkoutOverrides || {})[date]);
                    const doneIds = fullList ? fullList.map((r) => r[0]) : null;
                    actions.completeSession(date, d.id, { feel: a.feel || null, duration: tier, exercisesCompleted: doneIds, exercisesSkipped: [] });
                    out.push("✓ " + SESSIONS[d.id].short + " logged complete · " + fmtShort(date));
                }
                else
                    out.push("• nothing planned on " + fmtShort(date));
            }
            else if (a.type === "skip_session") {
                const d = dayOf(date);
                if (d && d.id && d.status === "planned") {
                    actions.skipSession(date, d.id, a.reason || "");
                    out.push("→ " + SESSIONS[d.id].short + " skipped, week reflowed");
                }
                else
                    out.push("• nothing to skip on " + fmtShort(date));
            }
            else if (a.type === "log_partial_session") {
                const d = dayOf(date);
                const sid = d && d.id ? d.id : null;
                if (!sid) {
                    out.push("• nothing planned to log partially on " + fmtShort(date));
                }
                else {
                    const resolveMany = (arr) => (Array.isArray(arr) ? arr : []).map((x) => { if (state.exercises[x])
                        return x; const hit = findExerciseByName(state.exercises, x); return hit ? hit[0] : null; }).filter(Boolean);
                    const done = resolveMany(a.exercises_completed);
                    const skipped = resolveMany(a.exercises_skipped);
                    actions.completeSession(date, sid, { status: "partial", duration: Number(a.duration) || null, exercisesCompleted: done, exercisesSkipped: skipped, feel: a.feel || null, sessionRpe: Number(a.session_rpe) || null, completionFraction: a.completion_fraction == null ? null : Number(a.completion_fraction), note: a.notes || "" });
                    out.push("✓ partial " + SESSIONS[sid].short + " logged; only actual stimuli were credited");
                }
            }
            else if (a.type === "adjust_week_from_feedback") {
                actions.adjustWeekFromFeedback(date, a);
                out.push("✓ fatigue/recovery feedback logged; remaining week re-scored");
            }
            else if (a.type === "set_fatigue") {
                if (a.area && a.level != null) {
                    actions.setFatigueArea(String(a.area), a.level, date, a.note || "");
                    out.push("✓ fatigue " + a.area + " updated");
                }
            }
            else if (a.type === "exercise_feedback") {
                const hit = findExerciseByName(state.exercises, a.name);
                if (hit && ["too_easy", "appropriate", "too_hard"].includes(a.difficulty)) {
                    actions.recordExerciseFeedback(hit[0], a.difficulty, date, a.observed_rir, a.note);
                    out.push("✓ " + hit[1].name + " feedback saved");
                }
                else
                    out.push("• couldn't apply exercise feedback");
            }
            else if (a.type === "modify_today_session") {
                const rem = (Array.isArray(a.remove_exercises) ? a.remove_exercises : []).map((x) => { if (state.exercises[x])
                    return x; const hit = findExerciseByName(state.exercises, x); return hit ? hit[0] : null; }).filter(Boolean);
                const adds = (Array.isArray(a.add_exercises) ? a.add_exercises : []).map((x) => { const hit = findExerciseByName(state.exercises, typeof x === "string" ? x : x.name); return hit ? { id: hit[0], sr: (typeof x === "object" && x.sets_reps) || "2 × 8–12", note: "coach substitution" } : null; }).filter(Boolean);
                actions.setDayWorkoutOverride(date, { remove: rem, add: adds, reason: a.reason || "Coach adjusted today's remainder." });
                out.push("✓ today's remaining workout adjusted");
            }
            else if (a.type === "set_today_time") {
                const mins = Number(a.minutes);
                if (Number.isFinite(mins) && mins > 0) {
                    actions.setDayWorkoutOverride(date, { tier: snapTier(mins), reason: "Time changed to " + mins + " min." });
                    out.push("✓ today's session compressed to " + snapTier(mins) + "-minute tier");
                }
            }
            else if (a.type === "recalc_week") {
                actions.recalc();
                out.push("✓ week recalculated");
            }
            else if (a.type === "move_session") {
                if (PRIORITY.indexOf(a.slot) >= 0 && a.to_date && /^\d{4}-\d{2}-\d{2}$/.test(a.to_date)) {
                    actions.pinSession(a.to_date, a.slot);
                    out.push("✓ " + a.slot + " pinned to " + fmtShort(a.to_date));
                }
                else
                    out.push("• couldn't parse that move");
            }
            else if (a.type === "log_bench") {
                const w = Number(a.weight);
                const reps = Array.isArray(a.reps) ? a.reps.map(Number).filter((n) => Number.isFinite(n)) : null;
                if (Number.isFinite(w) && w > 0) {
                    actions.logBenchEntry(date, w, reps);
                    out.push("✓ bench " + w + " lb" + (reps && reps.length ? " × " + reps.join("/") : "") + " recorded");
                }
            }
            else if (a.type === "set_bench_weight") {
                const w = Number(a.weight);
                if (Number.isFinite(w) && w > 0) {
                    actions.setExerciseWeight("benchA", w);
                    out.push("✓ bench working weight → " + w + " lb");
                }
            }
            else if (a.type === "log_metric") {
                const kinds = ["bodyweight", "waist", "pullup", "mile", "fiveK", "muscleUp"];
                if (kinds.indexOf(a.kind) >= 0 && a.value != null) {
                    const v = a.kind === "pullup" ? Number(a.value) : a.kind === "muscleUp" ? !!a.value : a.value;
                    actions.logMetric(a.kind, v, date);
                    out.push("✓ " + a.kind + " → " + String(a.value));
                }
            }
            else if (a.type === "log_food") {
                if (a.text) {
                    actions.logFood(date, String(a.text).slice(0, 200));
                    out.push("✓ fuel note saved");
                }
            }
            else if (a.type === "set_goal") {
                const ov = goalTargetToOverride(a.key, a.target);
                if (ov) {
                    actions.setGoalOverride(a.key, ov);
                    out.push("✓ goal " + a.key + " → " + ov.label);
                }
                else
                    out.push("• couldn't parse that goal target");
            }
            else if (a.type === "set_knee") {
                if (["good", "watch", "irritated"].indexOf(a.status) >= 0) {
                    actions.setKnee(a.status);
                    out.push("✓ knee → " + a.status);
                }
            }
            else if (a.type === "set_availability") {
                const dw = Number(a.dow), mn = Number(a.minutes);
                if (dw >= 0 && dw <= 6 && Number.isFinite(mn)) {
                    actions.setAvailability(dw, Math.max(0, mn));
                    out.push("✓ " + DOW_SHORT[dw] + " availability → " + Math.max(0, mn) + " min");
                }
            }
            else if (a.type === "flag_exhausted") {
                actions.flagExhausted(today);
                out.push("✓ today set to recovery");
            }
            else if (a.type === "add_exercise") {
                const slot = ["A", "B", "C", "D"].indexOf(a.session) >= 0 ? a.session : "A";
                if (a.name) {
                    actions.addCustomExercise(slot, String(a.name), a.sets_reps, a.weight != null ? Number(a.weight) : null);
                    out.push("✓ " + a.name + " → " + slot + " days" + (a.sets_reps ? " (" + a.sets_reps + ")" : ""));
                }
            }
            else if (a.type === "remove_exercise") {
                const hit = findExerciseByName(state.exercises, a.name);
                if (hit) {
                    const slot = ["A", "B", "C", "D"].indexOf(a.session) >= 0 ? a.session : hit[1].group;
                    actions.removeExerciseFromSlot(slot, hit[0], hit[1].name);
                    out.push("→ " + hit[1].name + " removed from " + slot + " days");
                }
                else
                    out.push("• couldn't find an exercise named " + a.name);
            }
            else if (a.type === "set_exercise_weight") {
                const hit = findExerciseByName(state.exercises, a.name);
                const w = Number(a.weight);
                if (hit && Number.isFinite(w) && w >= 0) {
                    actions.setExerciseWeight(hit[0], w);
                    out.push("✓ " + hit[1].name + " → " + w + " lb");
                }
                else
                    out.push(hit ? "• couldn't parse that weight" : "• couldn't find an exercise named " + a.name + " — say add exercise to create it");
            }
            else if (a.type === "log_note") {
                if (a.text) {
                    actions.logNote(date, String(a.text).slice(0, 300));
                    out.push("✓ note saved");
                }
            }
            else if (a.type === "set_skill_stage") {
                const v = Number(a.stage);
                if (v >= 1 && v <= 4) {
                    actions.setSkillStage(v);
                    out.push("✓ Coverage Skills → Stage " + v);
                }
            }
        }
        catch (e) {
            out.push("• " + a.type + " failed");
        }
    });
    return out;
}
function CoachDrawer({ open, onClose, state, actions, plan, today }) {
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const scrollRef = useRef(null);
    useEffect(() => { if (scrollRef.current)
        scrollRef.current.scrollTop = 1e9; }, [state.chat.length, open, busy]);
    if (!open)
        return null;
    const send = async (preset) => {
        const t = (preset != null ? preset : input).trim();
        if (!t || busy)
            return;
        setInput("");
        actions.pushChat({ role: "user", text: t });
        setBusy(true);
        try {
            const res = await coachTurn(state, plan, today, t);
            const acts = runCoachActions(res.actions, { state, actions, plan, today });
            actions.pushChat({ role: "assistant", text: res.reply || (acts.length ? "Done." : "Tell me more."), acts });
        }
        catch (e) {
            actions.pushChat({ role: "assistant", text: "Couldn't reach the coach service just now — nothing was logged. Try again in a moment.", acts: [] });
        }
        setBusy(false);
    };
    const quick = ["I finished today's workout", "I only did 15 minutes", "That was too hard — adjust my week", "That was too easy", "Skip today — no time", "Log what I ate"];
    return (_jsxs("div", { className: "drawer", children: [_jsxs("div", { className: "drawer-head", children: [_jsx(MessageCircle, { size: 16, color: "var(--accent)" }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 750, fontSize: 14 }, children: "Coach" }), _jsx("div", { className: "small faint", children: state.settings.aiProvider === "openai" && state.settings.openaiKey ? "Your OpenAI key · falls back to built-in" : "Built-in Claude · no key needed" })] }), _jsx("button", { className: "btn subtle sm", style: { marginLeft: "auto" }, onClick: onClose, children: _jsx(X, { size: 14 }) })] }), _jsxs("div", { className: "drawer-msgs", ref: scrollRef, children: [state.chat.length === 0 && (_jsxs("div", { className: "bub coach", children: ["Talk to me like a training partner:", "\n", "\u00B7 \"only did bench + pull-ups \u2014 15 minutes\"", "\n", "\u00B7 \"that was brutal; hamstrings are cooked, adjust my week\"", "\n", "\u00B7 \"30 lb curls were way too easy\"", "\n", "\u00B7 \"RDL hurt, remove it from the rest of today\"", "\n", "\u00B7 \"ate chicken, rice + a shake\""] })), state.chat.map((m, i) => (_jsxs("div", { className: "bub " + (m.role === "user" ? "user" : "coach"), children: [m.text, m.acts && m.acts.length > 0 && (_jsx("div", { children: m.acts.map((a, j) => (_jsx("span", { className: "actchip", children: a }, j))) }))] }, i))), busy && _jsx("div", { className: "bub coach faint", children: "\u2026" })] }), _jsx("div", { className: "quickchips", children: quick.map((q) => (_jsx("button", { className: "chip", onClick: () => send(q), children: q }, q))) }), _jsxs("div", { className: "drawer-in", children: [_jsx("input", { className: "input", placeholder: "Message the coach\u2026", value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter")
                            send(); } }), _jsx("button", { className: "btn primary", onClick: () => send(), disabled: busy, children: _jsx(Send, { size: 15 }) })] })] }));
}
/* ------------------------------ Onboarding ------------------------------- */
function OnboardingWizard({ actions }) {
    const [step, setStep] = useState(0);
    const [bw, setBw] = useState("");
    const [bench, setBench] = useState("145");
    const [mins, setMins] = useState({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 75, 6: 60 });
    const [remOn, setRemOn] = useState(true);
    const [remTime, setRemTime] = useState("07:00");
    const [health, setHealth] = useState(false);
    const askNotif = () => { try {
        if (typeof Notification !== "undefined" && Notification.permission === "default")
            Notification.requestPermission();
    }
    catch (e) { } };
    const finish = () => actions.completeOnboarding({ date: ymd(new Date()), bw: bw.trim(), bench: bench.trim(), minutes: mins, reminderOn: remOn, reminderTime: remTime, health });
    const steps = [
        (_jsxs("div", { children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "Welcome to the block" }), _jsx("h1", { className: "big", children: "Cornerback Project" }), _jsx("p", { className: "small dim", style: { marginTop: 10 }, children: "Four months: sub-20 5K, 5:30 mile, a 225 bench attempt, 20+ pull-ups, a muscle-up \u2014 on a knee that gets respected. Three things make this app different:" }), _jsxs("p", { className: "small", style: { marginTop: 12 }, children: [_jsx("span", { className: "helpnum", children: "1" }), _jsx("b", { children: "Budget, not calendar." }), " Each week has targets (2 upper, 2 quality runs, 1 lower\u2026). Life moves a workout? The week reflows. No streaks, no guilt."] }), _jsxs("p", { className: "small", style: { marginTop: 8 }, children: [_jsx("span", { className: "helpnum", children: "2" }), _jsx("b", { children: "Buttons that think." }), " Skip \u00B7 Move \u00B7 I'm Exhausted \u00B7 Knee \u2014 one tap rebuilds the schedule around hard recovery rules."] }), _jsxs("p", { className: "small", style: { marginTop: 8 }, children: [_jsx("span", { className: "helpnum", children: "3" }), _jsx("b", { children: "A coach you can text." }), " \"Benched 175\", \"skip today, recalc\" \u2014 the chat bubble logs it all."] })] }, "s0")),
        (_jsxs("div", { children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "Step 2 \u00B7 Starting numbers" }), _jsx("h2", { className: "sec", style: { marginTop: 6, fontSize: 20 }, children: "Where are you today?" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "Rough is fine \u2014 the Aug 19\u201330 combine calibrates everything precisely before September starts." }), _jsxs("div", { style: { display: "grid", gap: 12, marginTop: 14 }, children: [_jsxs("div", { className: "field", children: [_jsx("label", { children: "Bodyweight (lb)" }), _jsx("input", { className: "input", placeholder: "158", value: bw, onChange: (e) => setBw(e.target.value) })] }), _jsxs("div", { className: "field", children: [_jsx("label", { children: "Bench working weight (lb) \u2014 145 is the program's conservative start" }), _jsx("input", { className: "input", value: bench, onChange: (e) => setBench(e.target.value) })] })] })] }, "s1")),
        (_jsxs("div", { children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "Step 3 \u00B7 Your real week" }), _jsx("h2", { className: "sec", style: { marginTop: 6, fontSize: 20 }, children: "Minutes you can usually train" }), _jsx("p", { className: "small dim", style: { marginTop: 6 }, children: "The schedule fits itself to this \u2014 and a 15-minute day still counts as a real session. Change it anytime in Settings." }), _jsx("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 14 }, children: DOW_SHORT.map((d, i) => (_jsxs("div", { className: "field", children: [_jsx("label", { children: d }), _jsx("input", { className: "input", value: mins[i], onChange: (e) => setMins({ ...mins, [i]: Math.max(0, parseInt(e.target.value, 10) || 0) }) })] }, d))) })] }, "s2")),
        (_jsxs("div", { children: [_jsx("div", { className: "eyebrow", style: { color: "var(--accent)" }, children: "Step 4 \u00B7 Connect" }), _jsx("h2", { className: "sec", style: { marginTop: 6, fontSize: 20 }, children: "Health data & reminders" }), _jsxs("div", { className: "card tight", style: { marginTop: 12 }, children: [_jsx("b", { style: { fontSize: 13.5 }, children: "Apple Watch / Apple Health" }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: "Browsers can't read HealthKit, so this connects a realistic demo feed now (resting HR, HRV, VO\u2082, sleep). The app is already built on the provider interface the future iOS companion will use \u2014 flip one switch later, zero redesign." }), _jsx("div", { className: "btnrow", children: _jsx("button", { className: "chip" + (health ? " active" : ""), onClick: () => setHealth(!health), children: health ? "✓ Connected (demo)" : "Connect health feed" }) })] }), _jsxs("div", { className: "card tight", style: { marginTop: 10 }, children: [_jsx("b", { style: { fontSize: 13.5 }, children: "Daily \"here's today's workout\"" }), _jsx("p", { className: "small dim", style: { marginTop: 4 }, children: "Fires while the app is open in a tab; real push notifications come with the companion app." }), _jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center", marginTop: 8 }, children: [_jsx("button", { className: "chip" + (remOn ? " active" : ""), onClick: () => { const n = !remOn; setRemOn(n); if (n)
                                        askNotif(); }, children: remOn ? "✓ On" : "Off" }), _jsx("input", { className: "input", style: { width: 100 }, value: remTime, onChange: (e) => setRemTime(e.target.value) })] })] }), _jsx("p", { className: "small faint", style: { marginTop: 12 }, children: "The AI Coach is already live \u2014 no key, no setup. Bottom-right bubble." })] }, "s3")),
    ];
    return (_jsx("div", { className: "ob-scrim", children: _jsxs("div", { className: "ob", children: [steps[step], _jsxs("div", { style: { display: "flex", alignItems: "center", marginTop: 22, gap: 10 }, children: [step > 0 && _jsx("button", { className: "btn subtle", onClick: () => setStep(step - 1), children: "Back" }), _jsx("div", { className: "ob-dots", style: { marginTop: 0, marginRight: "auto" }, children: steps.map((_, i) => (_jsx("span", { className: i === step ? "on" : "" }, i))) }), step < steps.length - 1 && _jsx("button", { className: "btn primary", onClick: () => setStep(step + 1), children: "Next" }), step === steps.length - 1 && _jsxs("button", { className: "btn good", onClick: finish, children: [_jsx(Check, { size: 15 }), " Start the block"] })] }), step === 0 && _jsx("p", { className: "small faint", style: { marginTop: 14, textAlign: "right" }, children: _jsx("button", { className: "btn subtle sm", onClick: finish, children: "Skip setup" }) })] }) }));
}
const TABS = ["TODAY", "ROADMAP", "PROGRAM", "PERFORMANCE", "CALIBRATION", "SETTINGS"];
export default function CornerbackApp() {
    const [state, setState] = useAppState();
    const [tab, setTab] = useState("TODAY");
    const [toast, setToast] = useState("");
    const [coachOpen, setCoachOpen] = useState(false);
    const toastTimer = useRef(null);
    const notify = useCallback((msg) => {
        setToast(msg);
        if (toastTimer.current)
            clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 3600);
    }, []);
    const actions = useMemo(() => makeActions(setState, notify), [setState, notify]);
    const realToday = ymd(new Date());
    const sim = state && state.settings.simDate;
    const today = sim && /^\d{4}-\d{2}-\d{2}$/.test(sim) ? sim : realToday;
    const plan = useMemo(() => {
        if (!state)
            return null;
        return planWeek({
            today,
            log: state.log,
            pins: state.pins,
            dayFlags: state.dayFlags,
            settings: state.settings,
            knee: state.settings.knee,
            fatigue: state.fatigue,
        });
    }, [state, today]);
    // Daily reminder (in-app toast always; browser notification when permitted)
    useEffect(() => {
        if (!state || !plan || !state.settings.reminderOn)
            return;
        const tick = () => {
            const now = new Date();
            const hm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
            const ds = ymd(now);
            if (hm === state.settings.reminderTime && state.ui.lastReminder !== ds) {
                actions.markReminded(ds);
                const dp = plan.days.find((d) => d.date === today);
                const s = dp && dp.id ? SESSIONS[dp.id] : null;
                const title = s ? "Today: " + s.name : "Today: rest — it's programmed";
                try {
                    if (typeof Notification !== "undefined" && Notification.permission === "granted")
                        new Notification(title, { body: s ? s.desc : "" });
                }
                catch (e) { }
                notify(title);
            }
        };
        tick();
        const t = setInterval(tick, 20000);
        return () => clearInterval(t);
    }, [state, plan, today, actions, notify]);
    if (!state || !plan) {
        return (_jsxs("div", { className: "cb", style: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }, children: [_jsx("style", { children: CSS }), _jsx("div", { className: "eyebrow", children: "Loading the block\u2026" })] }));
    }
    if (!state.ui.onboarded) {
        return (_jsxs("div", { className: "cb", children: [_jsx("style", { children: CSS }), _jsx(OnboardingWizard, { actions: actions }), _jsx(Toast, { msg: toast })] }));
    }
    const phase = phaseOf(today);
    return (_jsxs("div", { className: "cb", children: [_jsx("style", { children: CSS }), _jsx("div", { className: "topbar", children: _jsxs("div", { className: "topin", children: [_jsxs("div", { className: "brand", children: [_jsx("span", { className: "cbmark", children: "CB" }), _jsx("span", { className: "cbname", children: "Cornerback Project" })] }), _jsx("span", { className: "phasechip", children: PHASES[phase].chip }), _jsx("nav", { className: "tabs", children: TABS.map((t) => (_jsx("button", { className: "tab" + (tab === t ? " active" : ""), onClick: () => setTab(t), children: t }, t))) })] }) }), _jsxs("div", { className: "wrap", children: [sim && today !== realToday && (_jsx("div", { className: "card tight", style: { borderColor: "var(--warn)", marginTop: 14 }, children: _jsxs("span", { className: "small", style: { color: "var(--warn)" }, children: ["Previewing ", fmtLong(today), " \u2014 the engine plans as if it were that day. Clear it in Settings."] }) })), tab === "TODAY" && _jsx(TodayView, { state: state, actions: actions, plan: plan, today: today, setTab: setTab }), tab === "PROGRAM" && _jsx(ProgramView, { state: state, actions: actions, setTab: setTab }), tab === "ROADMAP" && _jsx(RoadmapView, { state: state, actions: actions, plan: plan, today: today, setTab: setTab }), tab === "PERFORMANCE" && _jsx(PerformanceView, { state: state, actions: actions, plan: plan, today: today }), tab === "CALIBRATION" && _jsx(CalibrationView, { state: state, actions: actions }), tab === "SETTINGS" && _jsx(SettingsView, { state: state, actions: actions }), _jsx("p", { className: "faint small", style: { marginTop: 28, textAlign: "center", letterSpacing: ".14em", fontFamily: "var(--mono)" }, children: "WIN THE BLOCK, NOT THE DAY." })] }), !coachOpen && (_jsx("button", { className: "fab", onClick: () => setCoachOpen(true), title: "Coach", children: _jsx(MessageCircle, { size: 22 }) })), _jsx(CoachDrawer, { open: coachOpen, onClose: () => setCoachOpen(false), state: state, actions: actions, plan: plan, today: today }), _jsx(Toast, { msg: toast })] }));
}

import ReactDOM from "react-dom/client";
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(CornerbackApp, {}));

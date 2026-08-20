from pathlib import Path

p = Path('CornerbackProject.jsx')
s = p.read_text()

repls = []

# 1) Give every Combine session an explicit exercise prescription.
repls += [
('''    minMinutes: 25,\n    calKeys: ["bodyweight", "waist", "benchBaseline", "pullupMax", "pushupMax", "exPullHeight"],''', '''    minMinutes: 25,\n    variants: { 60: [\n      ["benchA", "Build to 1 crisp × 5", "Ramp gradually · stop with ~2–3 reps in reserve · NOT a max"],\n      ["pullup", "1 max clean set", "Strict dead hang → chin over bar · stop when form breaks"],\n      ["pushup", "1 max clean set", "Standardize technique · stop at technical failure"],\n      ["exPull", "3 × 2 explosive reps", "Full rest · record best height / landmark"],\n    ] },\n    calKeys: ["bodyweight", "waist", "benchBaseline", "pullupMax", "pushupMax", "exPullHeight"],'''),
('''    minMinutes: 25,\n    calKeys: ["rdl", "hipThrust", "hamCurl", "calfRaise", "tibRaise", "stepUp", "broadJump"],''', '''    minMinutes: 25,\n    variants: { 60: [\n      ["rdl", "2–3 calibration sets", "Find a clean working load with ~2–3 reps in reserve"],\n      ["hipThrust", "2–3 calibration sets", "Find a clean working load with ~2–3 reps in reserve"],\n      ["hamCurl", "2 × 10–12", "Stop with ~2–3 reps in reserve"],\n      ["calfRaise", "2 × 12–15", "Controlled reps · 2–3 reps in reserve"],\n      ["tibRaise", "2 × 15–20", "Controlled reps"],\n      ["stepUp", "2 easy test sets", "Pain-free tolerance check only · do not force it"],\n    ] },\n    calKeys: ["rdl", "hipThrust", "hamCurl", "calfRaise", "tibRaise", "stepUp", "broadJump"],'''),
('''    minMinutes: 30,\n    calKeys: ["trackLaps", "trackStraight"],''', '''    minMinutes: 30,\n    variants: { 60: [\n      ["easyAerobic20", "30–40 min easy", "First measure laps per mile + usable straight · finish with 2–3 relaxed strides"],\n    ] },\n    calKeys: ["trackLaps", "trackStraight"],'''),
('''    minMinutes: 25,\n    calKeys: ["csRow", "inclineDb", "latRaise", "hammer", "pressdown"],''', '''    minMinutes: 25,\n    variants: { 60: [\n      ["csRow", "2 × 8–10", "Conservative load · 2–3 reps in reserve"],\n      ["inclineDb", "2 × 8–10", "Conservative load · 2–3 reps in reserve"],\n      ["latRaise", "2 × 12–15", "Smooth reps · no grinding"],\n      ["hammer", "2 × 10–12", "2–3 reps in reserve"],\n      ["pressdown", "2 × 10–12", "2–3 reps in reserve"],\n    ] },\n    calKeys: ["csRow", "inclineDb", "latRaise", "hammer", "pressdown"],'''),
('''    minMinutes: 25,\n    calKeys: ["pulldown", "cableRow1", "ohp", "incCurl", "ohTri", "facePull"],''', '''    minMinutes: 25,\n    variants: { 60: [\n      ["pulldown", "2 × 8–10", "Conservative load · 2–3 reps in reserve"],\n      ["cableRow1", "2 × 10/side", "Controlled · 2–3 reps in reserve"],\n      ["ohp", "2 × 8–10", "2–3 reps in reserve"],\n      ["incCurl", "2 × 10–12", "2–3 reps in reserve"],\n      ["ohTri", "2 × 10–12", "2–3 reps in reserve"],\n      ["facePull", "2 × 12–15", "Controlled"],\n      ["muTrans", "2–3 × 3", "Band-assisted transition trials · skill, not failure"],\n    ] },\n    calKeys: ["pulldown", "cableRow1", "ohp", "incCurl", "ohTri", "facePull"],'''),
]

for old, new in repls:
    if old in s:
        s = s.replace(old, new, 1)

# 2) Add a dedicated Combine capture UI. It records the exact baseline that matters.
marker = 'function WorkoutPanel({ session, tier, state, actions, today, onDone, autoOverride }) {'
if 'function CombineCapturePanel(' not in s and marker in s:
    component = r'''function CombineCapturePanel({ session, state, actions, today }) {
  const cal = (state.calibration && state.calibration.values) || {};
  const exW = (id) => state.exercises[id] && state.exercises[id].weight != null ? String(state.exercises[id].weight) : "";
  const [f, setF] = useState(() => ({
    bodyweight: cal.bodyweight || "", waist: cal.waist || "",
    benchWeight: exW("benchA"), benchReps: "5", benchRir: "2",
    pullupMax: cal.pullupMax || "", pushupMax: cal.pushupMax || "", exPullHeight: cal.exPullHeight || "",
    rdlWeight: exW("rdl"), rdlReps: "", rdlRir: "2",
    hipThrustWeight: exW("hipThrust"), hipThrustReps: "", hipThrustRir: "2",
    hamCurlWeight: exW("hamCurl"), hamCurlReps: "", hamCurlRir: "2",
    calfRaiseWeight: exW("calfRaise"), calfRaiseReps: "", calfRaiseRir: "2",
    tibRaiseWeight: exW("tibRaise"), tibRaiseReps: "", tibRaiseRir: "2",
    stepUpWeight: exW("stepUp"), stepUpReps: "", stepUpRir: "",
    broadJump: cal.broadJump || "",
    trackLaps: cal.trackLaps || "", trackStraight: cal.trackStraight || "", easyMinutes: "35",
    csRowWeight: exW("csRow"), csRowReps: "", csRowRir: "2",
    inclineDbWeight: exW("inclineDb"), inclineDbReps: "", inclineDbRir: "2",
    latRaiseWeight: exW("latRaise"), latRaiseReps: "", latRaiseRir: "2",
    hammerWeight: exW("hammer"), hammerReps: "", hammerRir: "2",
    pressdownWeight: exW("pressdown"), pressdownReps: "", pressdownRir: "2",
    pulldownWeight: exW("pulldown"), pulldownReps: "", pulldownRir: "2",
    cableRow1Weight: exW("cableRow1"), cableRow1Reps: "", cableRow1Rir: "2",
    ohpWeight: exW("ohp"), ohpReps: "", ohpRir: "2",
    incCurlWeight: exW("incCurl"), incCurlReps: "", incCurlRir: "2",
    ohTriWeight: exW("ohTri"), ohTriReps: "", ohTriRir: "2",
    facePullWeight: exW("facePull"), facePullReps: "", facePullRir: "2",
    muBand: "", note: "",
  }));
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const num = (k) => { const raw = String(f[k] == null ? "" : f[k]).trim(); if (!raw) return null; const n = Number(raw); return Number.isFinite(n) ? n : null; };
  const input = (key, label, unit, placeholder) => (
    <div className="field" style={{ minWidth: 105, flex: "1 1 105px" }}>
      <label>{label}</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input className="input" value={f[key]} placeholder={placeholder || ""} onChange={(e) => set(key, e.target.value)} />
        {unit && <span className="small faint" style={{ whiteSpace: "nowrap" }}>{unit}</span>}
      </div>
    </div>
  );
  const step = (n, title, rx, why, fields) => (
    <div key={n} style={{ border: "1px solid var(--line2)", borderRadius: 12, padding: 14, background: "var(--panel2)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div className="num" style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#08101d", fontWeight: 800, flex: "0 0 auto" }}>{n}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
          <div className="num" style={{ color: "var(--ice)", marginTop: 3, fontSize: 14 }}>{rx}</div>
          <p className="small dim" style={{ marginTop: 5 }}>{why}</p>
          {fields && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 11 }}>{fields}</div>}
        </div>
      </div>
    </div>
  );
  const weighted = (n, id, rx, why, prefix) => step(n, state.exercises[id].name, rx, why, [
    input(prefix + "Weight", "Record weight", "lb"), input(prefix + "Reps", "Record reps", "reps"), input(prefix + "Rir", "Reps left", "RIR")
  ]);
  const saveWeighted = (id, prefix) => {
    const w = num(prefix + "Weight"), reps = num(prefix + "Reps"), rir = num(prefix + "Rir");
    if (w != null) { actions.setExerciseWeight(id, w); actions.saveCalValue(id, String(w)); }
    if (w != null || reps != null || rir != null) actions.logExerciseSet(id, today, { weight: w, reps, rir, note: "Combine calibration" });
  };
  let rows = [];
  if (session.id === "CAL_UP") rows = [
    step(1, "Morning measurements", "Bodyweight + waist", "Capture the starting point before training. Same conditions make future comparisons useful.", [input("bodyweight", "Bodyweight", "lb"), input("waist", "Waist at navel", "in")]),
    step(2, "Barbell bench press", "Build to 1 crisp × 5", "Ramp up gradually. Stop with about 2–3 clean reps still available. This is a baseline, not a max.", [input("benchWeight", "Record weight", "lb"), input("benchReps", "Record reps", "reps"), input("benchRir", "Reps left", "RIR")]),
    step(3, "Strict pull-ups", "1 max clean set", "Dead hang to chin over bar. Stop when the next rep would lose the standard.", [input("pullupMax", "Record max", "reps")]),
    step(4, "Push-ups", "1 max clean set", "Use one consistent technique and stop at technical failure.", [input("pushupMax", "Record max", "reps")]),
    step(5, "Explosive pull-ups", "3 × 2 · full rest", "Pull as high as possible while fresh. We care about your best repeatable landmark, not fatigue reps.", [input("exPullHeight", "Best height / landmark", "", "e.g. lower chest to bar")]),
  ];
  if (session.id === "CAL_LOW") rows = [
    weighted(1, "rdl", "2–3 calibration sets", "Find the load that leaves about 2–3 clean reps in reserve.", "rdl"),
    weighted(2, "hipThrust", "2–3 calibration sets", "Find a clean repeatable working weight, not a grinder.", "hipThrust"),
    weighted(3, "hamCurl", "2 × 10–12", "Stop with 2–3 reps available.", "hamCurl"),
    weighted(4, "calfRaise", "2 × 12–15", "Controlled full-range reps.", "calfRaise"),
    weighted(5, "tibRaise", "2 × 15–20", "Controlled reps; establish a repeatable setup.", "tibRaise"),
    weighted(6, "stepUp", "2 easy test sets", "Tolerance check only. If the knee objects, stop and record it rather than forcing the test.", "stepUp"),
    step(7, "Broad jump · optional", "Only if fully pain-free", "One or two quality measurements are enough. Skip it if the knee is uncertain.", [input("broadJump", "Best distance", "in")]),
  ];
  if (session.id === "CAL_TRACK") rows = [
    step(1, "Measure the track", "Laps per mile + usable straight", "This lets later speed work use the space accurately instead of guessing.", [input("trackLaps", "Laps per mile", "laps"), input("trackStraight", "Straight length", "yd")]),
    step(2, "Easy aerobic run", "30–40 min conversational", "Keep it truly easy. Finish with 2–3 relaxed strides on the straight if everything feels normal.", [input("easyMinutes", "Actual minutes", "min")]),
  ];
  if (session.id === "CAL_ACCA") rows = [
    weighted(1, "csRow", "2 × 8–10", "Find a conservative working load with 2–3 reps in reserve.", "csRow"),
    weighted(2, "inclineDb", "2 × 8–10", "Clean reps; leave 2–3 in reserve.", "inclineDb"),
    weighted(3, "latRaise", "2 × 12–15", "Smooth reps with no swinging or grinding.", "latRaise"),
    weighted(4, "hammer", "2 × 10–12", "Find a repeatable starting load.", "hammer"),
    weighted(5, "pressdown", "2 × 10–12", "Find a repeatable starting load.", "pressdown"),
  ];
  if (session.id === "CAL_ACCC") rows = [
    weighted(1, "pulldown", "2 × 8–10", "Conservative load with 2–3 reps in reserve.", "pulldown"),
    weighted(2, "cableRow1", "2 × 10 / side", "Controlled and symmetrical.", "cableRow1"),
    weighted(3, "ohp", "2 × 8–10", "Find a clean starting load without grinding.", "ohp"),
    weighted(4, "incCurl", "2 × 10–12", "Repeatable starting load.", "incCurl"),
    weighted(5, "ohTri", "2 × 10–12", "Repeatable starting load.", "ohTri"),
    weighted(6, "facePull", "2 × 12–15", "Controlled shoulder-friendly reps.", "facePull"),
    step(7, "Muscle-up transition trial", "2–3 × 3 band-assisted", "Skill test only. Record which band/setup lets you move cleanly; do not turn this into failure work.", [input("muBand", "Band / setup", "", "e.g. medium band")]),
  ];

  const save = () => {
    if (session.id === "CAL_UP") {
      if (num("bodyweight") != null) { actions.saveCalValue("bodyweight", f.bodyweight); actions.logMetric("bodyweight", num("bodyweight"), today); }
      if (num("waist") != null) { actions.saveCalValue("waist", f.waist); actions.logMetric("waist", num("waist"), today); }
      const bw = num("benchWeight"), br = num("benchReps"), rir = num("benchRir");
      if (bw != null) { actions.setExerciseWeight("benchA", bw); actions.saveCalValue("benchBaseline", bw + " × " + (br == null ? 5 : br)); }
      if (bw != null || br != null || rir != null) actions.logExerciseSet("benchA", today, { weight: bw, reps: br, rir, note: "Combine upper baseline" });
      if (num("pullupMax") != null) { actions.saveCalValue("pullupMax", f.pullupMax); actions.logMetric("pullup", num("pullupMax"), today); }
      if (num("pushupMax") != null) actions.saveCalValue("pushupMax", f.pushupMax);
      if (String(f.exPullHeight).trim()) actions.saveCalValue("exPullHeight", f.exPullHeight);
    }
    if (session.id === "CAL_LOW") {
      [["rdl","rdl"],["hipThrust","hipThrust"],["hamCurl","hamCurl"],["calfRaise","calfRaise"],["tibRaise","tibRaise"],["stepUp","stepUp"]].forEach(([id,prefix]) => saveWeighted(id,prefix));
      if (num("broadJump") != null) actions.saveCalValue("broadJump", f.broadJump);
    }
    if (session.id === "CAL_TRACK") {
      if (num("trackLaps") != null) actions.saveCalValue("trackLaps", f.trackLaps);
      if (num("trackStraight") != null) actions.saveCalValue("trackStraight", f.trackStraight);
    }
    if (session.id === "CAL_ACCA") [["csRow","csRow"],["inclineDb","inclineDb"],["latRaise","latRaise"],["hammer","hammer"],["pressdown","pressdown"]].forEach(([id,prefix]) => saveWeighted(id,prefix));
    if (session.id === "CAL_ACCC") [["pulldown","pulldown"],["cableRow1","cableRow1"],["ohp","ohp"],["incCurl","incCurl"],["ohTri","ohTri"],["facePull","facePull"]].forEach(([id,prefix]) => saveWeighted(id,prefix));
    const exerciseIds = (session.variants && session.variants[60] ? session.variants[60].map((r) => r[0]) : []);
    actions.completeSession(today, session.id, { status: "completed", feel: "Appropriate", note: f.note || "Combine baseline captured", duration: session.id === "CAL_TRACK" ? (num("easyMinutes") || 35) : 45, exercisesCompleted: exerciseIds, exercisesSkipped: [], data: { combine: { ...f } } });
  };
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--accent)", fontSize: 12 }}>TODAY'S WORKOUT · STARTING POINT</div>
          <h2 className="sec" style={{ marginTop: 4 }}>Do the steps. Record the result.</h2>
        </div>
        <span className="badge">COMBINE {session.id === "CAL_UP" ? "1" : session.id === "CAL_LOW" ? "2" : session.id === "CAL_TRACK" ? "3" : session.id === "CAL_ACCA" ? "4" : "5"}</span>
      </div>
      <p className="small dim" style={{ marginTop: 7 }}>This is calibration, not a competition. We are establishing the numbers the trainer will use to prescribe September.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>{rows}</div>
      <div style={{ marginTop: 14 }}>
        <input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="Anything worth remembering? pain, setup, technique, equipment, etc." />
      </div>
      <div className="btnrow" style={{ marginTop: 12 }}>
        <button className="btn good" onClick={save}><Check size={15} /> Save Combine Results</button>
      </div>
    </div>
  );
}

'''
    s = s.replace(marker, component + marker, 1)

# 3) Reorder Today around the workout, not secondary status cards.
old = '''    <div>\n      <HelpCard state={state} actions={actions} />\n      {state.activeWorkout && state.activeWorkout.date === today && (\n        <ActiveWorkoutCard active={state.activeWorkout} session={SESSIONS[state.activeWorkout.sessionId]} actions={actions} />\n      )}\n      <WeeklyCheckinCard state={state} actions={actions} today={today} />\n      <div className="card">'''
new = '''    <div>\n      {state.activeWorkout && state.activeWorkout.date === today && (\n        <ActiveWorkoutCard active={state.activeWorkout} session={SESSIONS[state.activeWorkout.sessionId]} actions={actions} />\n      )}\n      <div className="card" style={{ borderColor: "var(--accent2)" }}>'''
if old in s: s = s.replace(old, new, 1)

old = '''            <div className="eyebrow">{fmtLong(today)} · {PHASES[phase].chip}</div>'''
new = '''            <div className="eyebrow" style={{ color: "var(--accent)" }}>TODAY'S WORKOUT · {fmtLong(today)} · {PHASES[phase].chip}</div>'''
if old in s: s = s.replace(old, new, 1)

# Collapse the why section so the prescription is visually dominant.
old = '''            <div style={{ marginTop: 10 }}>\n              <div className="eyebrow">Why this, today</div>\n              {dayPlan.reasons.map((r, i) => (<div className="reason" key={i}>{r}</div>))}\n              {dayPlan.pinned && <div className="reason">Pinned here by you.</div>}\n            </div>'''
new = '''            <Collapse title="Why the trainer chose this today">\n              {dayPlan.reasons.length ? dayPlan.reasons.map((r, i) => (<p key={i} style={{ marginTop: i ? 5 : 0 }}>{r}</p>)) : <p>This is the highest-priority safe session for the current block.</p>}\n              {dayPlan.pinned && <p style={{ marginTop: 5 }}>Pinned here by you.</p>}\n            </Collapse>'''
if old in s: s = s.replace(old, new, 1)

# Normal sessions keep the standard list. Combine uses the dedicated capture panel instead.
s = s.replace('{(session.variants || (mergedOverride.add && mergedOverride.add.length)) && (', '{!isCal && (session.variants || (mergedOverride.add && mergedOverride.add.length)) && (', 1)

old = '''            {isCal && (\n              <div style={{ marginTop: 14 }}>\n                <div className="eyebrow">Calibration rule</div>\n                <p className="small dim" style={{ marginTop: 6 }}>{CAL_RULE}</p>\n                <div className="btnrow">\n                  <button className="btn sm" onClick={() => setTab("SETTINGS")}><Target size={14} /> Open Calibration & Baselines</button>\n                </div>\n              </div>\n            )}'''
new = '''            {isCal && !completed && (\n              <CombineCapturePanel key={session.id} session={session} state={state} actions={actions} today={today} />\n            )}'''
if old in s: s = s.replace(old, new, 1)

# Hide generic start/complete controls for Combine; the Combine panel itself is the workflow.
s = s.replace('{!panelOpen && (\n              <div className="btnrow">', '{!isCal && !panelOpen && (\n              <div className="btnrow">', 1)
s = s.replace('{!panelOpen && (\n              <div className="btnrow" style={{ marginTop: 8 }}>', '{!isCal && !panelOpen && (\n              <div className="btnrow" style={{ marginTop: 8 }}>', 1)
s = s.replace('{panelOpen && session && (\n        <WorkoutPanel', '{panelOpen && session && !isCal && (\n        <WorkoutPanel', 1)

# Put check-ins/help below the actual workout card and logger.
old = '''      {panelOpen && session && !isCal && (\n        <WorkoutPanel session={session} tier={tier} state={state} actions={actions} today={today} autoOverride={dayPlan.autoOverride} onDone={() => setPanelOpen(false)} />\n      )}\n\n      <div className="grid2">'''
new = '''      {panelOpen && session && !isCal && (\n        <WorkoutPanel session={session} tier={tier} state={state} actions={actions} today={today} autoOverride={dayPlan.autoOverride} onDone={() => setPanelOpen(false)} />\n      )}\n\n      <WeeklyCheckinCard state={state} actions={actions} today={today} />\n      <HelpCard state={state} actions={actions} />\n\n      <div className="grid2">'''
if old in s: s = s.replace(old, new, 1)

# Remove the lingering fake starting bench assumption in the generic logger.
s = s.replace('const [benchW, setBenchW] = useState(state.exercises.benchA.weight || 145);', 'const [benchW, setBenchW] = useState(state.exercises.benchA.weight == null ? "" : state.exercises.benchA.weight);')

p.write_text(s)
print('PR3 current-main Combine UX patch applied')

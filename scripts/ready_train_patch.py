from pathlib import Path

p = Path("CornerbackProject.jsx")
s = p.read_text()

# Versioned state additions: live workout, hydration, recovery, weekly check-ins.
s = s.replace("    version: 2,", "    version: 3,")
s = s.replace(
    "    nutrition: [],\n    notesLog: [],",
    "    nutrition: [],\n    hydration: [],\n    weeklyCheckins: [],\n    recoveryLog: [],\n    activeWorkout: null,\n    notesLog: [],",
)
s = s.replace(
    "  out.nutrition = Array.isArray(saved.nutrition) ? saved.nutrition : [];\n  out.notesLog = Array.isArray(saved.notesLog) ? saved.notesLog : [];",
    "  out.nutrition = Array.isArray(saved.nutrition) ? saved.nutrition : [];\n  out.hydration = Array.isArray(saved.hydration) ? saved.hydration : [];\n  out.weeklyCheckins = Array.isArray(saved.weeklyCheckins) ? saved.weeklyCheckins : [];\n  out.recoveryLog = Array.isArray(saved.recoveryLog) ? saved.recoveryLog : [];\n  out.activeWorkout = saved.activeWorkout || null;\n  out.notesLog = Array.isArray(saved.notesLog) ? saved.notesLog : [];",
)

# Completing the current workout ends live mode.
s = s.replace(
    "return { ...s, exercises, pins, dayFlags, dayWorkoutOverrides, fatigue, coachMemory: { observations: obs.slice(-80) }, log: [...s.log, entry] };",
    "return { ...s, exercises, pins, dayFlags, dayWorkoutOverrides, fatigue, coachMemory: { observations: obs.slice(-80) }, activeWorkout: (s.activeWorkout && s.activeWorkout.date === date) ? null : s.activeWorkout, log: [...s.log, entry] };",
)

# Trainer actions.
anchor = '    recalc() { up((s) => ({ ...s })); notify("Week rebuilt around what you\\'ve completed."); },'
if anchor not in s:
    raise SystemExit("Could not find recalc action anchor")
trainer_actions = '''    startWorkout(date, sessionId, tier) {\n      up((s) => ({ ...s, activeWorkout: { date, sessionId, tier: Number(tier) || 60, startedAt: Date.now(), source: "web", watchStatus: "waiting_for_native_bridge" } }));\n      notify("Workout started. Text Coach during the session — changes can update the remainder live.");\n    },\n    stopActiveWorkout() { up((s) => ({ ...s, activeWorkout: null })); },\n    logWater(date, ounces, source) {\n      const oz = Number(ounces);\n      if (!Number.isFinite(oz) || oz <= 0) return;\n      up((s) => ({ ...s, hydration: [...(s.hydration || []), { date, ounces: oz, source: source || "manual", ts: Date.now() }].slice(-240) }));\n      notify("Hydration logged.");\n    },\n    logRecovery(date, payload) {\n      up((s) => ({ ...s, recoveryLog: [...(s.recoveryLog || []), { date, ...(payload || {}), ts: Date.now() }].slice(-120) }));\n    },\n    logWeeklyCheckin(date, payload) {\n      up((s) => {\n        const bodyweight = payload && payload.bodyweight != null && String(payload.bodyweight).trim() !== "" ? Number(payload.bodyweight) : null;\n        const waist = payload && payload.waist != null && String(payload.waist).trim() !== "" ? Number(payload.waist) : null;\n        const metrics = { ...s.metrics };\n        if (Number.isFinite(bodyweight)) metrics.bodyweight = [...metrics.bodyweight, { date, v: bodyweight }];\n        if (Number.isFinite(waist)) metrics.waist = [...metrics.waist, { date, v: waist }];\n        const check = { date, bodyweight: Number.isFinite(bodyweight) ? bodyweight : null, waist: Number.isFinite(waist) ? waist : null, knee: payload.knee || s.settings.knee, feel: payload.feel || "", note: payload.note || "", ts: Date.now() };\n        return { ...s, metrics, weeklyCheckins: [...(s.weeklyCheckins || []), check].slice(-60) };\n      });\n      notify("Weekly check-in saved. The trainer can use the trend when it plans the next week.");\n    },\n'''
s = s.replace(anchor, trainer_actions + anchor)

# Feed live/context data into the coach brain.
s = s.replace(
    '  var recentFood = (state.nutrition || []).slice(-4).map(function (n) { return n.date + ": " + n.text; }).join(" | ") || "none";',
    '  var recentFood = (state.nutrition || []).slice(-4).map(function (n) { return n.date + ": " + n.text; }).join(" | ") || "none";\n  var recentWater = (state.hydration || []).slice(-6).map(function (n) { return n.date + ": " + n.ounces + " oz"; }).join(" | ") || "none";\n  var lastCheck = (state.weeklyCheckins || []).slice(-1)[0];\n  var checkText = lastCheck ? (lastCheck.date + " weight=" + (lastCheck.bodyweight == null ? "?" : lastCheck.bodyweight) + " waist=" + (lastCheck.waist == null ? "?" : lastCheck.waist) + " feel=" + (lastCheck.feel || "") + " knee=" + (lastCheck.knee || "")) : "none yet";\n  var activeText = state.activeWorkout ? ("ACTIVE " + state.activeWorkout.date + " " + (SESSIONS[state.activeWorkout.sessionId] ? SESSIONS[state.activeWorkout.sessionId].short : state.activeWorkout.sessionId) + " tier=" + state.activeWorkout.tier + " started=" + new Date(state.activeWorkout.startedAt).toISOString()) : "none";',
)
s = s.replace(
    '    "Recent coaching observations: " + memory + ".\\nRecent food/context: " + recentFood + ".\\n" +',
    '    "Recent coaching observations: " + memory + ".\\nRecent food/context: " + recentFood + ". Recent water: " + recentWater + ". Last weekly check-in: " + checkText + ". Active workout: " + activeText + ".\\n" +',
)
s = s.replace(
    '    "log_bench {weight,reps?}; set_bench_weight {weight}; log_metric {kind,value}; log_food {text}; log_note {text}; set_goal {key,target}; set_knee {status}; set_availability {dow,minutes}; flag_exhausted {}; add_exercise {session,name,sets_reps?,weight?}; remove_exercise {name,session?}; set_exercise_weight {name,weight}; set_skill_stage {stage}.\\n" +',
    '    "log_bench {weight,reps?}; set_bench_weight {weight}; log_metric {kind,value}; log_food {text}; log_water {ounces}; log_recovery {sleep_hours?,sleep_score?,feel?,note?}; weekly_checkin {bodyweight?,waist?,knee?,feel?,note?}; log_note {text}; set_goal {key,target}; set_knee {status}; set_availability {dow,minutes}; flag_exhausted {}; add_exercise {session,name,sets_reps?,weight?}; remove_exercise {name,session?}; set_exercise_weight {name,weight}; set_skill_stage {stage}.\\n" +',
)

# New coach actions.
old = '''      } else if (a.type === "log_food") {\n        if (a.text) { actions.logFood(date, String(a.text).slice(0, 200)); out.push("✓ fuel note saved"); }\n      } else if (a.type === "set_goal") {'''
new = '''      } else if (a.type === "log_food") {\n        if (a.text) { actions.logFood(date, String(a.text).slice(0, 200)); out.push("✓ fuel note saved"); }\n      } else if (a.type === "log_water") {\n        const oz = Number(a.ounces); if (Number.isFinite(oz) && oz > 0) { actions.logWater(date, oz, "coach"); out.push("✓ water " + oz + " oz saved"); }\n      } else if (a.type === "log_recovery") {\n        actions.logRecovery(date, { sleepHours: a.sleep_hours == null ? null : Number(a.sleep_hours), sleepScore: a.sleep_score == null ? null : Number(a.sleep_score), feel: a.feel || "", note: a.note || "" }); out.push("✓ recovery note saved");\n      } else if (a.type === "weekly_checkin") {\n        actions.logWeeklyCheckin(date, { bodyweight: a.bodyweight, waist: a.waist, knee: a.knee, feel: a.feel, note: a.note }); out.push("✓ weekly check-in saved");\n      } else if (a.type === "set_goal") {'''
if old not in s:
    raise SystemExit("Could not find coach action insertion point")
s = s.replace(old, new)

# Start Workout creates a real live session.
s = s.replace(
    '<button className="btn primary" onClick={() => setPanelOpen(true)}><Zap size={15} /> Start Workout</button>',
    '<button className="btn primary" onClick={() => { actions.startWorkout(today, session.id, tier); setPanelOpen(true); }}><Zap size={15} /> Start Workout</button>',
)

# Calibration becomes a Settings section rather than a separate workflow.
s = s.replace('goCalibrate={() => setTab("CALIBRATION")}', 'goCalibrate={() => setTab("SETTINGS")}')
s = s.replace('onClick={() => setTab("CALIBRATION")}', 'onClick={() => setTab("SETTINGS")}')
s = s.replace('Enter results in Calibration', 'Open Calibration & Baselines')
s = s.replace('entered in Calibration.', 'entered in Settings → Calibration & Baselines.')
s = s.replace('const TABS = ["TODAY", "ROADMAP", "PROGRAM", "PERFORMANCE", "CALIBRATION", "SETTINGS"];', 'const TABS = ["TODAY", "ROADMAP", "PROGRAM", "PERFORMANCE", "SETTINGS"];')

# Today: live workout + scheduled check-in cards.
today_anchor = '''      <HelpCard state={state} actions={actions} />\n      <div className="card">'''
if today_anchor not in s:
    raise SystemExit("Could not find TodayView anchor")
s = s.replace(
    today_anchor,
    '''      <HelpCard state={state} actions={actions} />\n      {state.activeWorkout && state.activeWorkout.date === today && (\n        <ActiveWorkoutCard active={state.activeWorkout} session={SESSIONS[state.activeWorkout.sessionId]} actions={actions} />\n      )}\n      <WeeklyCheckinCard state={state} actions={actions} today={today} />\n      <div className="card">''',
    1,
)

# Coach UI examples.
s = s.replace(
    'const quick = ["I finished today\\'s workout", "I only did 15 minutes", "That was too hard — adjust my week", "That was too easy", "Skip today — no time", "Log what I ate"];',
    'const quick = ["I finished today\\'s workout", "I only did 15 minutes", "That was too hard — adjust my week", "That was too easy", "I drank 24 oz", "Weekly check-in"];',
)
s = s.replace(
    '· "ate chicken, rice + a shake"',
    '· "ate chicken, rice + a shake"{"\\n"}· "drank 24 oz"{"\\n"}· "159.2 this morning; waist 31.5; felt strong this week"',
)
s = s.replace(
    '{state.settings.aiProvider === "openai" && state.settings.openaiKey ? "Your OpenAI key · falls back to built-in" : "Built-in Claude · no key needed"}',
    '{state.settings.coachEndpoint ? "Trainer endpoint connected" : "Local demo coach until server endpoint is connected"}',
)
s = s.replace(
    'The chat button (bottom-right) logs sessions, weights, food, goal changes and recalculations from plain English. Inside Claude it runs on a built-in Claude model — zero setup, no key. Self-hosting later? Switch to your own OpenAI key below and it just works.',
    'The chat button is the trainer input: workouts, food, water, recovery, goals, pain, time changes and weekly check-ins can all arrive as normal text. For the deployed app, use one server-side trainer endpoint so no model API key ever lives in the browser.',
)

# Components used by Today + Settings.
marker = '/* ----------------------------- SETTINGS VIEW ----------------------------- */'
if marker not in s:
    raise SystemExit("Could not find Settings marker")
components = r'''
function ActiveWorkoutCard({ active, session, actions }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const mins = Math.max(0, Math.floor((now - active.startedAt) / 60000));
  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div className="eyebrow" style={{ color: "var(--accent)" }}>LIVE WORKOUT · {mins} min</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <b>{session ? session.name : active.sessionId}</b>
        <span className="chip active">{active.tier} min plan</span>
      </div>
      <p className="small dim" style={{ marginTop: 8 }}>Text Coach while you train: “165×5, 2 left”, “machine is taken”, “only 12 minutes left”, “that hurt”, or “this is way too easy”. The trainer can change the remainder without pretending the original plan happened.</p>
      <div className="btnrow"><button className="btn subtle sm" onClick={actions.stopActiveWorkout}>End live mode without logging</button></div>
    </div>
  );
}

function WeeklyCheckinCard({ state, actions, today }) {
  const dow = dowMon0(today);
  const isWed = dow === 2, isSun = dow === 6;
  const last = (state.weeklyCheckins || []).slice(-1)[0];
  const due = isSun && (!last || daysBetween(last.date, today) >= 5);
  const weighDue = isWed || isSun;
  const [open, setOpen] = useState(due);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [feel, setFeel] = useState("");
  const [note, setNote] = useState("");
  if (!weighDue && !due) return null;
  return (
    <div className="card">
      <div className="eyebrow">{isSun ? "SUNDAY · WEEKLY CHECK-IN" : "MIDWEEK · QUICK WEIGH-IN"}</div>
      <p className="small dim" style={{ marginTop: 6 }}>{isSun ? "One minute: weight, waist if available, knee/recovery, and how the week felt. The trainer uses the trend — not one noisy number — to decide whether anything should change." : "Same morning conditions if practical. This is a trend point, not a judgment."}</p>
      {!open && <div className="btnrow"><button className="btn sm" onClick={() => setOpen(true)}>Check in</button></div>}
      {open && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
            <div className="field"><label>Weight (lb)</label><input className="input" value={weight} onChange={(e)=>setWeight(e.target.value)} placeholder="159.2" /></div>
            {isSun && <div className="field"><label>Waist (in)</label><input className="input" value={waist} onChange={(e)=>setWaist(e.target.value)} placeholder="31.5" /></div>}
            {isSun && <div className="field"><label>Week felt</label><input className="input" value={feel} onChange={(e)=>setFeel(e.target.value)} placeholder="strong / flat / beat up" /></div>}
          </div>
          {isSun && <div className="field"><label>Anything the trainer should know?</label><input className="input" value={note} onChange={(e)=>setNote(e.target.value)} placeholder="knee good; hungry all week; intervals felt easier..." /></div>}
          <div className="btnrow">
            <button className="btn primary sm" onClick={() => { if (isSun) actions.logWeeklyCheckin(today, { bodyweight: weight, waist, knee: state.settings.knee, feel, note }); else if (weight.trim()) actions.logMetric("bodyweight", Number(weight), today); setOpen(false); setWeight(""); setWaist(""); setFeel(""); setNote(""); }}>Save</button>
            <button className="btn subtle sm" onClick={() => setOpen(false)}>Later</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalibrationSettingsSection({ state, actions }) {
  const calibratedWeights = Object.values(state.exercises).filter((ex) => ex.cal && ex.weight != null).length;
  const totalWeights = Object.values(state.exercises).filter((ex) => ex.cal).length;
  const baselineDone = CAL_BASELINES.filter((b) => String(state.calibration.values[b.key] || "").trim()).length;
  const pct = Math.round(100 * (calibratedWeights + baselineDone) / Math.max(1, totalWeights + CAL_BASELINES.length));
  const groups = [["A","Upper anchor"],["B","Lower anchor"],["C","Pull / power anchor"],["D","Athletic microdose"]];
  return (
    <div className="card">
      <div className="eyebrow">Calibration & Baselines · {pct}% learned</div>
      <p className="small dim" style={{ marginTop: 6 }}>This is not a separate combine you have to finish. Your first real workouts teach the trainer your working loads and tolerances. Use this section only to review or correct what it has learned.</p>
      <Collapse title="Baseline measurements">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
          {CAL_BASELINES.map((b) => <div className="field" key={b.key}><label>{b.label}{b.unit ? " · " + b.unit : ""}</label><input className="input" value={state.calibration.values[b.key] || ""} placeholder={b.seed || ""} onChange={(e)=>actions.saveCalValue(b.key,e.target.value)} /></div>)}
        </div>
      </Collapse>
      <Collapse title="Working weights learned so far">
        {groups.map(([g,label]) => {
          const list = Object.entries(state.exercises).filter(([,ex]) => ex.group===g && ex.cal && !ex.bw);
          if (!list.length) return null;
          return <div key={g} style={{ marginTop: 10 }}><div className="small" style={{ color:"var(--ice)", fontWeight:700 }}>{label}</div>{list.map(([id,ex]) => <div className="exrow" key={id}><div><div className="exname">{ex.name}</div><div className="exmeta">{ex.weight==null ? "learning" : "current working load"}</div></div><div style={{display:"flex",gap:6,alignItems:"center"}}><input className="input" style={{width:84}} value={ex.weight==null?"":ex.weight} placeholder="—" onChange={(e)=>{const v=e.target.value.trim(); actions.setExerciseWeight(id,v===""?null:Number(v));}} /><span className="small faint">{ex.unit}</span></div></div>)}</div>;
        })}
      </Collapse>
    </div>
  );
}

'''
s = s.replace(marker, components + marker)

# Settings begins with Calibration & Baselines.
settings_anchor = '''    <div>\n      <div className="card">\n        <div className="eyebrow">Default availability · minutes per weekday</div>'''
if settings_anchor not in s:
    raise SystemExit("Could not find SettingsView first card")
s = s.replace(
    settings_anchor,
    '''    <div>\n      <CalibrationSettingsSection state={state} actions={actions} />\n      <div className="card">\n        <div className="eyebrow">Default availability · minutes per weekday</div>''',
    1,
)

p.write_text(s)
print("Ready-to-Train patch applied")

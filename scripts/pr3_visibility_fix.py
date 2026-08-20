from pathlib import Path

p = Path("CornerbackProject.jsx")
s = p.read_text()

# This second pass is intentionally narrow and robust: it only rewrites TodayView.
# The first PR3 patch inserts CombineCapturePanel. This pass guarantees Today actually
# renders that panel and does not fall back to the generic workout logger.
if "function CombineCapturePanel(" not in s:
    raise SystemExit("CombineCapturePanel missing after primary PR3 patch")

start = s.index("function TodayView(")
end_marker = "/* ------------------------------- WEEK VIEW"
end = s.index(end_marker, start)
t = s[start:end]

# Workout first: move helper/check-in cards below the actual prescription.
t = t.replace('      <HelpCard state={state} actions={actions} />\n', '', 1)
t = t.replace('      <WeeklyCheckinCard state={state} actions={actions} today={today} />\n', '', 1)

# Make the hierarchy explicit.
t = t.replace(
    '<div className="eyebrow">{fmtLong(today)} · {PHASES[phase].chip}</div>',
    '<div className="eyebrow" style={{ color: "var(--accent)" }}>TODAY\'S WORKOUT · {fmtLong(today)} · {PHASES[phase].chip}</div>',
    1,
)
t = t.replace('<div className="card">', '<div className="card" style={{ borderColor: "var(--accent2)" }}>', 1)

# Supporting rationale should never outrank the workout.
old_why = '''            <div style={{ marginTop: 10 }}>
              <div className="eyebrow">Why this, today</div>
              {dayPlan.reasons.map((r, i) => (<div className="reason" key={i}>{r}</div>))}
              {dayPlan.pinned && <div className="reason">Pinned here by you.</div>}
            </div>'''
new_why = '''            <Collapse title="Why the trainer chose this today">
              {dayPlan.reasons.length ? dayPlan.reasons.map((r, i) => (<p key={i} style={{ marginTop: i ? 5 : 0 }}>{r}</p>)) : <p>This is the highest-priority safe session for the current block.</p>}
              {dayPlan.pinned && <p style={{ marginTop: 5 }}>Pinned here by you.</p>}
            </Collapse>'''
if old_why in t:
    t = t.replace(old_why, new_why, 1)

# Never show the generic time-tier exercise list for Combine days.
old_variants = '{(session.variants || (mergedOverride.add && mergedOverride.add.length)) && ('
new_variants = '{!isCal && (session.variants || (mergedOverride.add && mergedOverride.add.length)) && ('
if old_variants in t:
    t = t.replace(old_variants, new_variants, 1)

# Replace the old "open calibration" block with the actual recordable workout.
old_cal = '''            {isCal && (
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow">Calibration rule</div>
                <p className="small dim" style={{ marginTop: 6 }}>{CAL_RULE}</p>
                <div className="btnrow">
                  <button className="btn sm" onClick={() => setTab("SETTINGS")}><Target size={14} /> Open Calibration & Baselines</button>
                </div>
              </div>
            )}'''
new_cal = '''            {isCal && !completed && (
              <CombineCapturePanel key={session.id} session={session} state={state} actions={actions} today={today} />
            )}'''
if old_cal in t:
    t = t.replace(old_cal, new_cal, 1)

# CombineCapturePanel owns start/log/save. Hide generic workout controls and logger.
t = t.replace('{!panelOpen && (\n              <div className="btnrow">', '{!isCal && !panelOpen && (\n              <div className="btnrow">', 1)
t = t.replace('{!panelOpen && (\n              <div className="btnrow" style={{ marginTop: 8 }}>', '{!isCal && !panelOpen && (\n              <div className="btnrow" style={{ marginTop: 8 }}>', 1)
t = t.replace('{panelOpen && session && (\n        <WorkoutPanel', '{panelOpen && session && !isCal && (\n        <WorkoutPanel', 1)

# Put supporting cards after the workout/logger, before the weekly status grid.
anchor = '''      {panelOpen && session && !isCal && (
        <WorkoutPanel session={session} tier={tier} state={state} actions={actions} today={today} autoOverride={dayPlan.autoOverride} onDone={() => setPanelOpen(false)} />
      )}

      <div className="grid2">'''
inserted = '''      {panelOpen && session && !isCal && (
        <WorkoutPanel session={session} tier={tier} state={state} actions={actions} today={today} autoOverride={dayPlan.autoOverride} onDone={() => setPanelOpen(false)} />
      )}

      <WeeklyCheckinCard state={state} actions={actions} today={today} />
      <HelpCard state={state} actions={actions} />

      <div className="grid2">'''
if anchor in t:
    t = t.replace(anchor, inserted, 1)
elif '<WeeklyCheckinCard state={state} actions={actions} today={today} />' not in t:
    raise SystemExit("Could not place supporting cards below workout")

# Fail loudly rather than silently shipping the old screen again.
required = [
    'TODAY\'S WORKOUT · {fmtLong(today)}',
    '<CombineCapturePanel key={session.id}',
    '{!isCal && (session.variants ||',
    '{panelOpen && session && !isCal &&',
]
missing = [x for x in required if x not in t]
if missing:
    raise SystemExit("PR3 visibility fix incomplete: " + repr(missing))

s = s[:start] + t + s[end:]
p.write_text(s)
print("PR3 Combine workout is now the primary Today UI")

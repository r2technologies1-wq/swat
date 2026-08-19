from pathlib import Path
import re

p = Path("CornerbackProject.jsx")
s = p.read_text()


def replace_once(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {n}")
    s = s.replace(old, new, 1)


def regex_once(pattern, repl, label, flags=0):
    global s
    s2, n = re.subn(pattern, lambda m: repl, s, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {n}")
    s = s2


# 1) Stop pretending we already know the bench starting load.
replace_once(
    'benchA:    { name: "Barbell bench press",            weight: 145,  inc: 5,  unit: "lb", cal: true,  group: "A" },',
    'benchA:    { name: "Barbell bench press",            weight: null, inc: 5,  unit: "lb", cal: true,  group: "A" },',
    "bench default",
)
replace_once(
    '/* Seeded from Cornerback Project V3. Weights are calibrated by the user —\n   only bench A carries a suggested start (~145) per the program.            */',
    '/* Seeded from Cornerback Project V3. Exercise loads stay unknown until\n   observed in training or explicitly entered by the athlete.                */',
    "exercise default comment",
)

# 2) Default to the same-origin secure trainer endpoint and expand persisted memory.
replace_once(
    '      aiProvider: "claude",\n      openaiKey: "",\n      coachEndpoint: "",',
    '      aiProvider: "server",\n      openaiKey: "",\n      coachEndpoint: "/api/trainer",',
    "trainer settings defaults",
)
replace_once('    version: 3,', '    version: 4,', "state version")
replace_once(
    '    coachMemory: { observations: [] },\n    log: [],',
    '    coachMemory: { observations: [] },\n    trainerMemory: { facts: [] },\n    athleteEvents: [],\n    log: [],',
    "new memory state",
)
replace_once(
    '  out.coachMemory = { observations: Array.isArray((saved.coachMemory || {}).observations) ? saved.coachMemory.observations : [] };\n  out.log = Array.isArray(saved.log) ? saved.log : [];',
    '  out.coachMemory = { observations: Array.isArray((saved.coachMemory || {}).observations) ? saved.coachMemory.observations : [] };\n  out.trainerMemory = { facts: Array.isArray((saved.trainerMemory || {}).facts) ? saved.trainerMemory.facts : [] };\n  out.athleteEvents = Array.isArray(saved.athleteEvents) ? saved.athleteEvents : [];\n  out.log = Array.isArray(saved.log) ? saved.log : [];',
    "merge new memory state",
)

# 3) Give the Coach recent structured timeline + durable learned facts.
replace_once(
    '  var benchW = state.exercises.benchA.weight;',
    '  var benchW = state.exercises.benchA.weight;\n  var benchTxt = benchW == null ? "unknown / learning" : benchW + " lb";',
    "bench context",
)
replace_once(
    '  var memory = ((state.coachMemory || {}).observations || []).slice(-8).map(function (o) { return o.date + ": " + o.text; }).join(" | ") || "none yet";\n  var recentFood = (state.nutrition || []).slice(-4).map(function (n) { return n.date + ": " + n.text; }).join(" | ") || "none";',
    '  var memory = ((state.coachMemory || {}).observations || []).slice(-8).map(function (o) { return o.date + ": " + o.text; }).join(" | ") || "none yet";\n  var trainerFacts = (((state.trainerMemory || {}).facts) || []).slice(-12).map(function (f) { return (f.date || "") + ": " + f.text; }).join(" | ") || "none yet";\n  var recentEvents = (state.athleteEvents || []).slice(-12).map(function (e) { return (e.occurredAt || e.date || "") + " " + (e.eventType || "event") + (e.bodyArea ? " [" + e.bodyArea + "]" : "") + ": " + (e.text || e.context || ""); }).join(" | ") || "none yet";\n  var recentFood = (state.nutrition || []).slice(-4).map(function (n) { return n.date + ": " + n.text; }).join(" | ") || "none";',
    "coach memory context",
)
replace_once(
    '    "You are the personalized trainer/coach brain inside the Cornerback Project. The app is the body/database; you are the adaptive reasoning layer. Motto: win the block, not the day. Never use shame or streak language. Be concise, specific, and action-oriented.\\n" +',
    '    "You are the always-available personalized trainer/coach brain inside the Cornerback Project. The athlete can talk to you whenever they want — before, during, or after training, on rest days, or days later about something that happened earlier. The app is the body/database; you are the adaptive reasoning layer. Motto: win the block, not the day. Never use shame or streak language. Be concise, specific, and action-oriented.\\n" +',
    "always-on coach intro",
)
replace_once(
    '    "Today: " + today + " (phase " + plan.effPhase + "). Knee: " + kneeTxt + ". Coverage Skills stage: " + skillTxt + "/4. Bench working weight: " + benchW + " lb.\\n" +',
    '    "Today: " + today + " (phase " + plan.effPhase + "). Knee: " + kneeTxt + ". Coverage Skills stage: " + skillTxt + "/4. Bench working weight: " + benchTxt + ".\\n" +',
    "unknown bench wording",
)
replace_once(
    '    "Recent coaching observations: " + memory + ".\\nRecent food/context: " + recentFood + ". Recent water: " + recentWater + ". Last weekly check-in: " + checkText + ". Active workout: " + activeText + ".\\n" +',
    '    "Recent coaching observations: " + memory + ".\\nLong-term trainer facts: " + trainerFacts + ".\\nRecent athlete timeline: " + recentEvents + ".\\nRecent food/context: " + recentFood + ". Recent water: " + recentWater + ". Last weekly check-in: " + checkText + ". Active workout: " + activeText + ".\\n" +',
    "coach context output",
)
replace_once(
    '    "Food/lifestyle notes are low-friction context. Log them when the user volunteers them; do not demand calories/macros.\\n" +',
    '    "Food/lifestyle notes are low-friction context. Log them when the user volunteers them; do not demand calories/macros.\\n" +\n    "TIMING: A report can describe now, earlier today, yesterday, after a prior workout, or the future. Preserve that distinction. Historical pain that has resolved is not current pain. Future availability is not a recurring weekday rule unless the athlete says it is.\\n" +\n    "MEMORY: Conversation is not the database. Use a specific logging action when available; otherwise use log_event for a useful timeline fact. Use remember_fact only for stable preferences, established tolerances, repeated patterns, or durable athlete facts — never make one noisy session a permanent rule.\\n" +\n    "REPLAN THRESHOLD: Most messages are log-only. Re-plan only when pain, meaningful fatigue/recovery, actual performance, missed/partial work, or availability materially changes the next training decision.\\n" +',
    "coach memory rules",
)
replace_once(
    '    "log_bench {weight,reps?}; set_bench_weight {weight}; log_metric {kind,value}; log_food {text}; log_water {ounces}; log_recovery {sleep_hours?,sleep_score?,feel?,note?}; weekly_checkin {bodyweight?,waist?,knee?,feel?,note?}; log_note {text}; set_goal {key,target}; set_knee {status}; set_availability {dow,minutes}; flag_exhausted {}; add_exercise {session,name,sets_reps?,weight?}; remove_exercise {name,session?}; set_exercise_weight {name,weight}; set_skill_stage {stage}.\\n" +',
    '    "log_event {event_type,occurred_at?,body_area?,severity?,active?,context?,text?,data?}; remember_fact {key?,text,confidence?}; log_set {name,weight?,reps?,rir?,note?};\\n" +\n    "log_bench {weight,reps?}; set_bench_weight {weight}; log_metric {kind,value}; log_food {text}; log_water {ounces}; log_recovery {sleep_hours?,sleep_score?,feel?,note?}; weekly_checkin {bodyweight?,waist?,knee?,feel?,note?}; log_note {text}; set_goal {key,target}; set_knee {status}; set_availability {dow,minutes}; flag_exhausted {}; add_exercise {session,name,sets_reps?,weight?}; remove_exercise {name,session?}; set_exercise_weight {name,weight}; set_skill_stage {stage}.\\n" +',
    "new coach actions contract",
)

# 4) Add structured athlete timeline, generic set logging, and durable facts.
insert_actions = '''    logAthleteEvent(date, payload) {
      up((s) => {
        const p = payload || {};
        const event = {
          id: "ev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          date,
          occurredAt: p.occurredAt || p.occurred_at || date,
          reportedAt: Date.now(),
          source: p.source || "coach",
          eventType: p.eventType || p.event_type || "note",
          bodyArea: p.bodyArea || p.body_area || "",
          severity: p.severity == null ? null : p.severity,
          active: p.active == null ? null : !!p.active,
          context: p.context || "",
          text: p.text || "",
          data: p.data && typeof p.data === "object" ? p.data : {},
        };
        return { ...s, athleteEvents: [ ...(s.athleteEvents || []), event ].slice(-500) };
      });
    },
    rememberFact(date, payload) {
      up((s) => {
        const p = payload || {};
        const text = String(p.text || "").trim();
        if (!text) return s;
        const key = String(p.key || text.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80));
        const facts = [ ...((((s.trainerMemory || {}).facts) || [])) ];
        const fact = { key, text, date, confidence: p.confidence == null ? null : Number(p.confidence), ts: Date.now() };
        const idx = facts.findIndex((f) => f.key === key);
        if (idx >= 0) facts[idx] = { ...facts[idx], ...fact };
        else facts.push(fact);
        return { ...s, trainerMemory: { facts: facts.slice(-120) } };
      });
    },
    logExerciseSet(exId, date, payload) {
      up((s) => {
        const ex = s.exercises[exId];
        if (!ex) return s;
        const p = payload || {};
        const w = p.weight == null || p.weight === "" ? null : Number(p.weight);
        const reps = p.reps == null || p.reps === "" ? null : Number(p.reps);
        const rir = p.rir == null || p.rir === "" ? null : Number(p.rir);
        const history = [ ...(ex.history || []), {
          date,
          w: Number.isFinite(w) ? w : ex.weight,
          reps: Number.isFinite(reps) ? reps : null,
          rir: Number.isFinite(rir) ? rir : null,
          note: p.note || "",
          source: "coach_set",
        } ];
        const learnedWeight = ex.weight == null && Number.isFinite(w) && w > 0 ? w : ex.weight;
        const updated = { ...ex, weight: learnedWeight, history };
        const obs = [ ...((s.coachMemory || {}).observations || []) ];
        if (Number.isFinite(w) || Number.isFinite(reps)) obs.push({ date, text: ex.name + " set: " + (Number.isFinite(w) ? w + " " + ex.unit : "load not stated") + (Number.isFinite(reps) ? " × " + reps : "") + (Number.isFinite(rir) ? " @ RIR ~" + rir : "") });
        return { ...s, exercises: { ...s.exercises, [exId]: updated }, coachMemory: { observations: obs.slice(-80) } };
      });
    },
'''
replace_once(
    '    setCoachEndpoint(v) { up((s) => ({ ...s, settings: { ...s.settings, coachEndpoint: v } })); },',
    insert_actions + '    setCoachEndpoint(v) { up((s) => ({ ...s, settings: { ...s.settings, coachEndpoint: v } })); },',
    "new state actions",
)

# 5) Make the client server-only: no API key/provider calls from the browser.
coach_turn = '''async function coachTurn(state, plan, today, userText) {
  const sys = buildCoachSystem(state, plan, today);
  const history = state.chat.slice(-12).map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  const msgs = [...history, { role: "user", content: userText }];
  const endpoint = state.settings.coachEndpoint || "/api/trainer";
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system: sys, messages: msgs }),
  });
  if (!r.ok) {
    let detail = "trainer " + r.status;
    try { const d = await r.json(); if (d && d.error) detail = d.error; } catch (e) {}
    throw new Error(detail);
  }
  const d = await r.json();
  const text = Array.isArray(d.content)
    ? d.content.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\\n")
    : (typeof d.text === "string" ? d.text : "");
  if (!text) throw new Error("trainer returned no text");
  return parseCoachReply(text);
}'''
regex_once(
    r'async function coachTurn\(state, plan, today, userText\) \{.*?\n\}\n\nfunction findExerciseByName',
    coach_turn + '\n\nfunction findExerciseByName',
    "server-only coachTurn",
    flags=re.S,
)

# 6) Execute the new structured actions.
new_cases = '''      } else if (a.type === "log_event") {
        actions.logAthleteEvent(date, {
          event_type: a.event_type || "note",
          occurred_at: a.occurred_at || a.date || date,
          body_area: a.body_area || "",
          severity: a.severity,
          active: a.active,
          context: a.context || "",
          text: a.text || "",
          data: a.data,
        });
        out.push("✓ " + (a.event_type || "event") + " saved to athlete timeline");
      } else if (a.type === "remember_fact") {
        if (a.text) { actions.rememberFact(date, a); out.push("✓ trainer memory updated"); }
      } else if (a.type === "log_set") {
        const hit = findExerciseByName(state.exercises, a.name);
        if (hit) {
          actions.logExerciseSet(hit[0], date, { weight: a.weight, reps: a.reps, rir: a.rir, note: a.note || "" });
          out.push("✓ " + hit[1].name + " set saved");
        } else out.push("• couldn't find an exercise named " + a.name);
'''
replace_once(
    '      } else if (a.type === "log_bench") {',
    new_cases + '      } else if (a.type === "log_bench") {',
    "new action executor cases",
)
replace_once('(list || []).slice(0, 6).forEach((a) => {', '(list || []).slice(0, 8).forEach((a) => {', "action cap")

# 7) Make the Coach UI explicitly anytime, not workout-dependent.
replace_once(
    '  const quick = ["I finished today\'s workout", "I only did 15 minutes", "That was too hard — adjust my week", "That was too easy", "I drank 24 oz", "Weekly check-in"];',
    '  const quick = ["How am I doing?", "159.2 this morning", "Slept badly last night", "My knee started hurting later", "I can\'t train tomorrow", "Had chicken, rice + a shake"];',
    "coach quick prompts",
)
replace_once(
    '            Talk to me like a training partner:',
    '            Message me whenever you want — morning, afternoon, before or after training, on a rest day, or days later:',
    "coach welcome",
)
replace_once(
    '      <p className="small dim" style={{ marginTop: 8 }}>Text Coach while you train: “165×5, 2 left”, “machine is taken”, “only 12 minutes left”, “that hurt”, or “this is way too easy”. The trainer can change the remainder without pretending the original plan happened.</p>',
    '      <p className="small dim" style={{ marginTop: 8 }}>You do not need to text during the workout. Coach is available anytime — before, during, or afterward. If something matters later (pain, soreness, a great set, time pressure), tell it when convenient and it will place the information on the athlete timeline and adapt only when needed.</p>',
    "active workout coach wording",
)
replace_once('  const [bench, setBench] = useState("145");', '  const [bench, setBench] = useState("");', "onboarding bench guess")

# 8) Replace key/provider settings with the server-backed trainer status.
trainer_settings_card = '''      <div className="card">
        <div className="eyebrow"><MessageCircle size={11} style={{ verticalAlign: "-1px" }} /> Trainer Brain</div>
        <p className="small dim" style={{ marginTop: 6 }}>
          Coach is always available. Message it before, during, or after training — or days later — and useful information is converted into structured athlete events, current state, and durable trainer memory. The model key lives only on the server; never paste an API key into this browser.
        </p>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Trainer endpoint</label>
          <input className="input" placeholder="/api/trainer" value={state.settings.coachEndpoint || "/api/trainer"} onChange={(e) => actions.setCoachEndpoint(e.target.value)} />
        </div>
        <p className="small faint" style={{ marginTop: 6 }}>Default: /api/trainer. On deployment, set OPENAI_API_KEY as a server environment variable. Conversation history remains part of app state; PR3 will move athlete memory to a cloud database for cross-device sync.</p>
        <div className="btnrow">
          <button className="btn subtle sm" onClick={actions.clearChat}>Clear chat history</button>
        </div>
      </div>

'''
regex_once(
    r'      <div className="card">\n        <div className="eyebrow"><MessageCircle size=\{11\}.*?      </div>\n\n(?=      <div className="card">\n        <div className="eyebrow"><Activity)',
    trainer_settings_card,
    "trainer settings card",
    flags=re.S,
)

p.write_text(s)
print("PR2 trainer brain patch applied successfully")

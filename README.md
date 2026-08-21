# Cornerback Project — Personal Trainer

A local-first adaptive hybrid-athlete training dashboard. The named workouts are **anchor templates, not a push/pull/legs split**. The scheduling engine can recombine compatible training modules when life changes the week.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints in the terminal.

`npm run dev` starts the Node/Vite server so `/api/trainer` works locally. Plain `npm run dev:vite` is still available for UI-only work.

## Build

```bash
npm run build
npm run preview
```

## Trainer behavior

The Coach is expected to understand natural feedback such as:

- “I only did bench and pull-ups for 15 minutes.”
- “That was too hard — rebuild the rest of my week.”
- “Curls were way too easy.”
- “My triceps are sore, don’t make me press tomorrow.”
- “I have 30 minutes. Can I do a light run plus pull-ups?”
- “I skipped the last three exercises.”
- “I don’t care about dunking anymore.”
- “Make the 5K the main goal.”

The app stores actual completed exercises, fatigue, food/lifestyle notes, goal changes, check-ins, and partial sessions. The planner uses those facts to recalculate the remaining week.

Goal changes are first-class trainer memory. If you pause a goal, it stops driving future workout selection; if you make a goal the main focus, its weekly stimuli get more priority. The Roadmap and Performance pages show a goal audit so you can see whether the forecast is actually covering the work needed for the Dec 31 targets.

## Flexible mixed days

The planner can deliberately combine compatible modules, for example:

- easy aerobic + pull-up/muscle-up microdose;
- easy aerobic + short arms block;
- condensed Upper C + 15–20 minutes easy aerobic;
- athletic microdose + a small missing upper-body stimulus.

It does **not** combine hard run + hard lower work or ignore recent muscle fatigue just to fill boxes.

## Data

The browser keeps UI state cached so the app can render, but trainer chat is backend-required. When `OPENAI_API_KEY` and `NEON_DATABASE_URL` are set, `/api/trainer` saves structured trainer turns to Postgres: chat actions, durable facts, body metrics, recovery, food/water, workout sessions, exercise feedback, and day-level planner overrides. If the backend, AI key, or database is missing, trainer chat refuses the message instead of pretending it learned.

The backend also maintains a compact trainer profile summary in Postgres. `/api/trainer/profile` reports the latest profile and signal counts, `/api/trainer/profile/refresh` rebuilds it, and saved trainer turns can refresh it automatically when enough new feedback exists. That summary is injected into future `/api/trainer` prompts through the durable database context. Goal override actions are hydrated back into the browser state, so active/paused targets survive reloads and other devices when Postgres is connected.

Server setup:

```bash
cp .env.example .env
npm run migrate
npm run dev
```

Local setup:

1. Paste your OpenAI key after `OPENAI_API_KEY=` in `.env`.
2. Paste your Neon connection string after `NEON_DATABASE_URL=` in `.env`.
3. Restart the server with `npm run dev`.
4. Open the URL printed by the server, usually `http://localhost:5174/` on this Mac.

Replit setup:

Add the same names in Replit Secrets: `OPENAI_API_KEY` and `NEON_DATABASE_URL`. Replit secrets do not get pushed to Git and do not create a local `.env` on this Mac. `DATABASE_URL` is still accepted as a fallback if a host only supports that name. Optional: set `OPENAI_MODEL` and `OPENAI_SUMMARY_MODEL`; both default to `gpt-5-mini`.

## Apple Health

The browser app does not directly read Apple Health. The code retains a `HealthDataProvider` abstraction so an iPhone HealthKit companion/sync layer can be added later.

# Replit setup

## Run

The project uses Vite and runs with:

```bash
npm install
npm run dev
```

The Replit workflow runs Vite on `0.0.0.0:5000`, which makes the app available in the Replit preview.

## Notes

- Training data is stored locally in the browser. Use the in-app JSON export before clearing browser storage or changing machines.
- The optional AI Coach points at `/api/trainer` by default. `api/trainer.js` is a serverless-style handler and is not served by Vite alone, so the dashboard runs without the AI route and reports when the trainer backend is not configured.
- When adding a compatible server deployment for the trainer route, provide `OPENAI_API_KEY` through Replit Secrets rather than putting it in browser code.
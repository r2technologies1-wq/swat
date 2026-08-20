# Replit setup

## Run

The project runs a small Node server that serves Vite and `/api/trainer` on the same port:

```bash
npm install
npm run dev
```

The Replit workflow runs Vite on `0.0.0.0:5000`, which makes the app available in the Replit preview.

## Notes

- Browser storage is still the offline fallback.
- Durable trainer memory uses Neon Postgres when `NEON_DATABASE_URL` is set.
- The AI Coach points at `/api/trainer` by default. Provide `OPENAI_API_KEY` and `NEON_DATABASE_URL` through Replit Secrets rather than putting secrets in browser code.
- Run `npm run migrate` once after setting `NEON_DATABASE_URL` to install the trainer schema.

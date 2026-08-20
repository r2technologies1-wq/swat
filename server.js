import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { checkDatabaseConnection, loadTrainerSnapshot } from "./api/_db.js";
import trainerHandler from "./api/trainer.js";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5000);
const isProd = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  const db = await checkDatabaseConnection();
  res.json({
    ok: true,
    openai: Boolean(process.env.OPENAI_API_KEY),
    database: db.reachable,
    databaseConfigured: db.configured,
    databaseReachable: db.reachable,
    databaseError: db.error || null,
  });
});

app.post("/api/trainer", trainerHandler);

app.get("/api/trainer/state", async (req, res) => {
  const athleteKey = String(req.query.athleteKey || process.env.TRAINER_ATHLETE_KEY || "local-demo").slice(0, 120);
  const snapshot = await loadTrainerSnapshot({ athleteKey });
  if (!snapshot.configured) return res.status(200).json(snapshot);
  if (!snapshot.hydrated) return res.status(503).json(snapshot);
  return res.status(200).json(snapshot);
});

if (isProd) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    appType: "spa",
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`SWAT trainer running on http://0.0.0.0:${port}`);
});

import React from "react";
import ReactDOM from "react-dom/client";
import CornerbackApp from "./CornerbackProject.jsx";

// PR2: the Coach always talks to our same-origin server route.
// This migrates existing browser state without touching the athlete's history.
try {
  const key = "cornerback-v1";
  const raw = window.localStorage.getItem(key);
  const saved = raw ? JSON.parse(raw) : {};
  const currentSettings = saved && saved.settings && typeof saved.settings === "object" ? saved.settings : {};
  const nextSettings = {
    ...currentSettings,
    coachEndpoint: currentSettings.coachEndpoint || "/api/trainer",
    aiProvider: "server",
    openaiKey: "",
  };
  window.localStorage.setItem(key, JSON.stringify({ ...saved, settings: nextSettings }));
} catch (_) {
  // Storage may be blocked; the app has its own fallback chain.
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CornerbackApp />
  </React.StrictMode>
);

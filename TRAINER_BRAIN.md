# Trainer Brain — scheduling philosophy

The scheduler does **not** treat A/B/C as a push/pull/legs split. They are anchor templates that protect major adaptations (heavy bench, primary lower strength, pull/muscle-up work, quality running).

The actual day prescription is assembled from remaining stimuli, available time, recent exercise-level work, fatigue, knee status, and recovery conflicts.

Examples of intended mixed days:

- Easy aerobic + pull-up / muscle-up microdose.
- Easy aerobic + short biceps/triceps block when direct arms are still missing.
- Condensed Upper C + 15–20 minutes easy aerobic when the easy-running stimulus would otherwise be lost.
- Athletic microdose + a small missing upper-body stimulus.

Important recovery rule examples:

- Direct triceps work the prior day blocks heavy bench the next day.
- Hard lower work should not sit immediately before a hard run.
- Hard runs are not stacked on consecutive days.
- High local fatigue causes content reduction or a different module combination rather than simply moving the same full workout.
- Partial sessions credit only exercises actually completed.

The Coach can modify today's remaining session and the rest of the week from natural-language feedback.

## Self-improving loop

The model does not learn by changing its weights. The app improves by running a capture -> store -> retrieve -> inject loop:

- `/api/trainer` turns natural text into validated actions, then stores the turn and structured signals in Neon.
- `/api/trainer/profile/refresh` distills recent raw logs into a compact profile summary.
- Future trainer calls load the compact profile plus recent raw history, so recommendations can reflect exercise feedback, load progression, missed work, travel, sleep, soreness, water, nutrition, and day constraints.
- The profile refresh can run automatically after saved trainer turns, or manually from Settings while developing.

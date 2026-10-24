# Release 3, the new look, and "Ask TenjiCheck"

## Inspection schedule (`/schedule`, staff)

- A schedule belongs to one site (inspection project). It has a cadence (monthly, quarterly, half-yearly, yearly
  or any 1–730 days), a first due date, a "remind" window and an optional contractor.
- State: **Overdue** (past due), **Due soon** (within the remind window), **Scheduled**, or **Paused**.
- **Start inspection** creates an ordinary inspection, the same as *New inspection*, titled `<schedule> · due <date>`.
  The schedule then moves forward on its original cadence to the first due date after today. Each run is recorded
  as on time or late.
- There are no e-mail or push reminders. The due state is shown on the schedule page and on the home page.

## Site history (`/history`, staff and assigned contractors)

- Every inspection of a site in date order, with open and resolved findings (chart or table), photos, rejected
  findings, and how many findings recurred from the previous inspection.
- **Compare two inspections.** The result lists findings that are *recurring*, *new* and *not seen again*.
  - Matching uses the same defect class and the nearest pair within 15 m GPS. Findings without GPS are matched by
    class and context tag (a weaker match, labelled as such).
  - Findings a reviewer rejected are excluded.
  - *Not seen again* is **not** evidence of a repair unless the later inspection photographed that spot.
- Contractors see only inspections assigned to them; the existing access rules apply.

## "Ask TenjiCheck" (header button, staff and contractors)

This is built with the real CopilotKit packages, following the approach of CopilotKit/OpenIntelligentUI. The
assistant answers with text, native components (stat cards, bar chart, table, page links), or sandboxed generated
UI (`openGenerativeUI`).

- **Model:** GitHub Models, via `@ai-sdk/openai` against `https://models.github.ai/inference`.
  - Set `TC_GITHUB_MODELS_TOKEN` (and optionally `TC_GITHUB_MODELS_MODEL`) in `backend/.env`; the Next.js server
    reads it from there or from its own environment.
  - The token never reaches the browser.
  - Without a token the button explains that the assistant is off, and the runtime returns 503.
- **Runtime:** `frontend/src/app/api/copilotkit/route.ts`. It rejects callers without a valid staff or contractor
  session (401). CopilotKit telemetry is disabled.
- **Data access:** the agent has none on the server. Its tools run in the browser and call the existing API with the
  user's own token, so it sees exactly what the user can.
- **Loading:** the chat code is loaded only when the button is first pressed. Its stylesheet (Tailwind v4 output) is
  served unchanged from `/vendor/copilotkit.css`, because the app's Tailwind v3 PostCSS step cannot parse it.
- **Limits:** answers can be wrong. The assistant cannot change data. It is instructed never to claim compliance.
  The live model path is untested here because no token was configured; the not-configured path is tested.

## New look

The shell (sidebar and header), the home page, and the new pages (schedule, history, assistant) use the
mockup's style:
- soft grey surfaces and large rounded cards
- pill buttons and round icon buttons
- a volt-yellow accent and charcoal panels
- the Outfit typeface

Other pages keep their layout and components. They sit on the new grey background inside the new shell.

## Tests

| Suite | Command |
|---|---|
| Backend (7 tests in `tests/test_recurring.py`) | `cd backend && .venv\Scripts\python -m pytest tests/test_recurring.py -q` |
| Browser (8 steps) | servers running, then `cd frontend && npm run e2e:release3` |

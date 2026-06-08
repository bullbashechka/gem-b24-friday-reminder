# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stateless Node.js cron job for Bitrix24. On each run it finds employees with at least one task whose deadline is **today** and whose status is open, then sends each of them a Friday checklist via a chat bot. There is no persistent state and no incoming server — the script runs once per invocation and exits. Repetition (hourly on Fridays) is the job of the system cron on the VPS, not the code (`0 9-18 * * 5 ...`).

## Commands

```bash
npm install                    # deps: axios, dotenv, pino
node src/bitrix.js             # smoke-test the webhook (calls `profile`)
node src/tasks.js              # print uid → open-task counts for today (no sending)
node src/index.js              # full run: collect users → send messages
DRY_RUN=1 node src/index.js    # full run but log recipients, send nothing
```

There is no test suite, build step, or linter. "Testing" = running the scripts above against a real portal. On Windows use Git Bash / the Bash tool for `VAR=1 node ...` env syntax — `set VAR=1 && node` (cmd syntax) silently does NOT set the env var for node.

## Architecture

Single dependency direction: `index.js` → `tasks.js` + `messages.js` → `bitrix.js` → `logger.js`. Each module under `src/` also has a `require.main === module` self-test block so it can be run standalone for debugging.

- **bitrix.js** — the only HTTP layer. `call(method, params)` POSTs to `${WEBHOOK_URL}${method}.json`; it throws on a Bitrix `error` field, so callers never inspect raw responses. `callList(method, params, resultKey)` handles pagination by looping on the `next` offset (pass `resultKey:'tasks'` because `tasks.task.list` returns `{ result: { tasks: [...] } }`, not a bare array).
- **tasks.js** — `getTodayDeadlineUsers()` returns a `Map<uid, openTaskCount>`. Computes today's `00:00`/`23:59` bounds in `TIMEZONE` using only built-in `Intl` (no date library) — see `getOffsetMinutes`/`getTodayBounds`.
- **messages.js** — `CHECKLIST` constant + `sendReminder(uid)`. Honors `DRY_RUN` (log, don't send) and `TEST_USER_ID` (redirect every message to one id). Returns `{ sent, dialogId }`.
- **index.js** — orchestration: fatal-exit(1) on missing `WEBHOOK_URL` or a failed task fetch; a single send failure is logged and the loop continues. `await sleep(500)` between sends to stay under Bitrix's ~2 req/sec limit.

## Bitrix24 API gotchas (hard-won, not discoverable from code)

- **`tasks.task.list` does not return `REAL_STATUS`** even when selected. The real status comes back as `status`, and only if you explicitly put `STATUS` in `select`. Open statuses are `2,3,4`; `5,6,7` are closed and excluded. Response keys are camelCase (`responsibleId`, `status`), not the uppercase select names — `pick()` in tasks.js tolerates both.
- **Messaging is `im.message.add` from the webhook's user, not a chat bot.** A real chat bot was attempted and abandoned: `imbot.register` fails over an incoming webhook with `403 "Client ID not specified"` — bots require an OAuth *local application* context, which webhooks lack. To make messages come from a non-personal sender, create the webhook under a dedicated technical user ("Контроль пятницы") instead. Required scopes: `task` + `im`.
- **Sending to your own user id does not produce a visible notification** — Bitrix hides self-messages. To verify delivery as a recipient would see it, set `TEST_USER_ID` to a *different* user.
- The Bitrix cloud server returns `time.date_start` in **Moscow time (+03:00)** regardless of the user's timezone; do not infer the portal/user offset from it. `Asia/Yekaterinburg` is UTC+5.

## Config & safety

`.env` (gitignored, see `.env.example`): `WEBHOOK_URL` (secret), `TIMEZONE`, `BOT_ID`, and the test switches `DRY_RUN` / `TEST_USER_ID`. The single most dangerous edit: clearing `DRY_RUN` while `TEST_USER_ID` is unset → a real run messages the **entire** matched department. Before any live run, confirm which of those two switches is active.

`logs/` must exist for the cron redirection to work — it is kept in git via `logs/.gitkeep` (note `.gitignore` uses `logs/*` + `!logs/.gitkeep`, not `logs/`, otherwise the keep file would itself be ignored).

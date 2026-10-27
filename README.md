# Agency OS

**A sales operating system for a marketing agency:** prospecting, CRM, proposals, contracts with e-signature, subscriptions, multi-currency invoicing, content production and finance — in a single web app that runs locally and stores its data in an Obsidian vault.

![Node.js](https://img.shields.io/badge/Node.js-Express_4-339933?logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla_ES2022-F7DF1E?logo=javascript&logoColor=black)
![Tests](https://img.shields.io/badge/tests-10_suites_·_~425_assertions-2ea44f)

![Tour of Agency OS with sample data](docs/demo.gif)

*Tour with fictional data: Today, CRM, Dashboard, a printable proposal, Invoices and Progress.*

> **Language note:** the product was built for a Spanish-speaking market (Colombia, Mexico, Hispanic US), so the UI and code comments are in Spanish. This README and the code identifiers are the entry point for English readers.

---

## The problem

A small agency runs on five tools that don't talk to each other: a prospect spreadsheet, a CRM, a document editor for proposals, another for contracts, and an invoicing app. Every hand-off between them is a chance to drop a follow-up or invoice the wrong amount.

Agency OS turns the whole cycle into a single flow, where each step generates the next one with the data already filled in:

```
Prospecting → CRM → Discovery call → Proposal ─(client accepts)→ Contract ─(signs)→ Subscription → Monthly invoice
                                                                                          ↓
                                                                          Onboarding · Production · Reports
```

## Features

- **"Today" screen**: booked calls, audits to record, messages due today and the outbox. When all four lists are empty, the day is done.
- **Batch prospecting**: paste tabular text and it becomes clients, opportunities and scheduled 5-touch follow-up sequences.
- **Public document links**: the client opens a proposal, contract or invoice on their phone and accepts, signs or pays right there. Every open is tracked.
- **Multi-currency invoicing** (COP, USD, MXN) with per-series numbering, VAT, withholding and overdue tracking.
- **Production pipeline**: each month's commitments are derived from the deliverables in the service catalog, and every piece moves through its own workflow (draft → review → approved → published).
- **Daily automations** that run on their own while the server is up, and catch up on missed days if the machine was off.
- **AI agent integration** (Claude Code): a markdown job queue that agents process and whose output the app imports.
- **Progress layer**: XP, streaks and levels derived from real CRM activity.

## Tech stack

| Layer | Technology |
|---|---|
| Server | Node.js, Express 4 |
| Email | Nodemailer (SMTP app password read from an environment variable) |
| Frontend | Vanilla JavaScript, no framework or build step; ~20-view SPA; Web Animations API |
| Persistence | JSON file with atomic writes and rotating backups, plus `.md` mirrors for Obsidian |
| Public exposure | Cloudflare Tunnel (`cloudflared`) for client-facing links |
| Testing | Custom Node test runner: 10 unit, API and UI suites |

## Technical highlights

### 1. Access control that holds up behind tunnels and proxies
The server listens on every network interface, so deciding who is "local" can't rely on `req.ip` (with `trust proxy` it comes from a spoofable header). The rule requires two conditions at once: the **socket is truly loopback** *and* the request carries **no proxy headers**. An attacker on the same Wi-Fi fails the first check; a visitor coming through the Cloudflare tunnel — which connects from `127.0.0.1` — fails the second. Everyone else needs a key compared with `crypto.timingSafeEqual`, and public routes are rate-limited. → [`lib/auth.js`](lib/auth.js)

### 2. E-signature with an evidence package
When a contract is signed from its link, the app stores name, email, IP, timestamp and the **SHA-256 hash of the exact text that was accepted** — the evidence set ESIGN/UETA expects for a simple electronic signature. Share tokens are only created when a document is actually shared (a token that doesn't exist can't leak) and can be revoked. → [`lib/publicdocs.js`](lib/publicdocs.js)

### 3. Daily scheduler with catch-up
A "clock" runs maintenance every morning: closes exhausted sequences, flags overdue invoices, expires proposals, chases calls with no recorded outcome. If the machine was off, it detects the pending day and runs it on startup. The automation boundary is written into the code: **nothing that reaches a client runs on its own**, and invoicing (assigning an accounting sequence number) is off by default. → [`lib/reloj.js`](lib/reloj.js)

### 4. Prospect ingestion and sequencing
The importer recognizes columns even when they're out of order, **de-duplicates by name, domain, phone and email** against existing records, and spreads enrollment across days according to the daily goal so 200 touches don't come due on the same day. The validator normalizes amounts like `3.500.000` or `1,800.50` and rejects anything that isn't a number, instead of letting a `NaN` propagate silently into an invoice total. → [`lib/prospecting.js`](lib/prospecting.js), [`lib/sequences.js`](lib/sequences.js), [`lib/validate.js`](lib/validate.js)

**Also:** progress XP is **derived, not stored** — every point is recomputed from timestamps that already exist in the CRM, so there's no counter to inflate ([`lib/juego.js`](lib/juego.js)). The UI uses critically damped spring curves and interruptible WAAPI animations, and honors `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.

## Project structure

```
server.js            REST API, public routes and static server
lib/
  auth.js            access key, loopback rule and rate limiting
  publicdocs.js      public links, acceptance and signature evidence
  reloj.js           daily automations with missed-day catch-up
  sequences.js       5-touch follow-up sequences
  prospecting.js     batch import and de-duplication
  outbox.js          outbox and SMTP delivery
  marketing.js       content ledger, evidence and verdicts
  money.js · dates.js · validate.js
  juego.js           XP, daily goals and streaks derived from the CRM
public/              vanilla JS SPA (one view per file)
test/                10 test suites and their runner
docs/MANUAL.md       full user manual (in Spanish)
```

## Getting started

Requires Node.js 18 or later.

```bash
npm install
npm start            # http://localhost:4180
```

Data is stored in `~/Documents/Obsidian Vault/Agency/`. To use another folder:

```bash
OBSIDIAN_VAULT=/path/to/vault npm start
```

Optional environment variables:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 4180) |
| `OBSIDIAN_VAULT` | Root folder for the data |
| `AGENCY_SMTP_PASS` | SMTP app password so emails go out automatically. Never written to disk |

## Tests

```bash
npm test
```

Starts the server on port 4199 and runs 10 suites: access, money, scheduler, units, marketing, progress, calculator, API, dispatch and UI. Records created by the tests are tagged `ZZTEST` and deleted at the end, and every write leaves a backup.

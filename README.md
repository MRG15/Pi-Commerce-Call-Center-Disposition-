# Pi Commerce Disposition Platform

A database-backed replacement for the current Google Sheet workflow.

## What this system does

- Agent logs in.
- Agent enters a **Cust ID**.
- The app loads the customer's complete historical timeline.
- Historical records are shown **exactly in the old structure**: date, old status (when available), what-happened text, and remark.
- Sheena's legacy Callback 1-3 Date + Remark records are also shown in the timeline as **Legacy follow-up** interactions. No status is invented for them.
- When agents start using the new system, each new call uses the configurable **L0 → L1 → L2** taxonomy.
- A new submission always creates a **new immutable call record**. It never edits an old call.
- Multiple calls on the same day remain separate attempts.
- Daily analytics can separate fresh vs repeat customers and total attempts vs unique customers.

## Historical vs new calls (important)

Historical data is **not forced into the new taxonomy**.

Example historical customer:

- Call 1 — 2 Aug — old `status_raw`, old remark
- Call 2 — 2 Aug — old `status_raw`, old remark
- Call 3 — 3 Aug — old `status_raw`, old remark

Those stay historical forever.

A call logged after launch stores L0/L1/L2 and shows those values in the same timeline.

## Source classification

Conversion-authoritative:

- `Highly interested cx (Umesh)`
- `Highly interested cx (Sheena)`
- `Highly Interested CX (Ashish)`

Excluded from core migration:

- `New Remarks (Umesh)` — already absorbed into the Highly Interested data
- `Deep Calling` — ad-hoc calling, not the conversion initiative
- `Sheet5` — empty

Tracking/reference:

- `High Intent Lead`
- `Ashish Calling (Link FB Page)`
- `Technical Issue`

The v1 core migration focuses on the three authoritative conversion sheets. Tracking tables exist in the schema for later extension, but the migration script does not let them contaminate call analytics.

## Setup — plain English

### 1. Install Node.js

Install Node.js 20+ if it is not already installed.

### 2. Install project packages

```bash
npm install
```

### 3. Create `.env.local`

Copy `.env.example` to `.env.local`.

Put your **rotated/private Neon connection string** in `DATABASE_URL`.

Generate a session secret with:

```bash
openssl rand -base64 32
```

Paste that value into `SESSION_SECRET`.

### 4. Put the source workbook in the project root

The migration scripts expect:

`Disposition Sheet - Sellers.xlsx`

For convenience, the uploaded source is also included under `/source`. Copy it to the project root before running migration:

```bash
cp "source/Disposition Sheet - Sellers.xlsx" .
```

### 5. Inspect counts BEFORE touching Neon

```bash
npm run source:report
```

This creates `migration-report.json` and prints the calculated customer/call counts.

**Do not proceed if the report looks wrong.**

### 6. Create Neon tables

```bash
npm run db:setup
```

### 7. Create the new L0/L1/L2 configuration

```bash
npm run db:seed
```

### 8. Migrate historical data

```bash
npm run migrate:data
```

The migration is idempotent: running it again will not duplicate the same source events.

### 9. PROVE the migration reconciles

```bash
npm run migrate:validate
```

This compares the workbook counts with what actually landed in Neon. It exits with an error if they do not match.

### 10. Create your first admin login

```bash
npm run agent:create -- --username madhav --name "Madhav" --password "choose-a-password" --role admin
```

Create agents the same way with `--role agent`.

### 11. Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

After local migration/validation passes:

1. Push this project to GitHub or import the folder into Vercel.
2. Add `DATABASE_URL` and `SESSION_SECRET` in Vercel Environment Variables.
3. Deploy.

Do **not** upload `.env.local` or paste the Neon password into source code.

## Data-safety rules implemented

- One interaction = one `calls` row.
- Multiple same-day calls are never merged.
- Original source sheet, row, call slot, status, remark and what-happened fields are retained.
- Historical L0/L1/L2 remain NULL.
- New calls use L0/L1/L2.
- Disposition labels are snapshotted on new calls, so changing the taxonomy later does not rewrite old history.
- Legacy customer-level issue flags are stored separately because the workbook did not reliably attribute them to one particular call.
- `standard_call`, `legacy_followup`, and `new_call` are distinct source types. `legacy_followup` is deliberately not called `callback`, because Callback is also a business disposition.

## Current L0 additions

The new-call taxonomy includes the supplied prototype plus:

- Historical `CX on Process` and `Call Not Picked` values are preserved exactly as legacy status values.
- For new calls, `CX on Process` is available under `Interested` (L1), while a not-picked call should use the appropriate callback outcome plus remark.

## Analytics behavior

The first analytics page provides:

- Total attempts
- Unique customers attempted
- Fresh customers
- Repeat customers
- Conservative connect rate
- Fresh-customer latest-outcome split
- Repeat-customer latest-outcome split

For unique-customer disposition splits, the latest interaction on the selected date is used so one customer is not counted multiple times in the same customer-level split.

The analytics definitions are centralized so they can be changed later without rewriting historical records.

## A count discrepancy intentionally caught during review

The earlier Claude artifact stated **1,030** unique conversion customers. Direct inspection of the uploaded workbook in this build found **1,039** unique customer IDs across the three authoritative sheets after cross-sheet overlap is accounted for.

For that reason, this project does **not** hard-code the earlier count. `npm run source:report` recalculates the baseline from the workbook, and `npm run migrate:validate` compares Neon to that calculated baseline.

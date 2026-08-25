# Quick Start (non-technical)

You do **not** need Google Sheets or n8n for the core platform.

## Before you start

1. In Neon, rotate the database password if you have not already done so.
2. Never paste the new database URL into chat or commit it to GitHub.

## Step 1 — open this project in Claude Code / Codex / VS Code

Unzip the project folder.

## Step 2 — open Terminal in the project folder

Run:

```bash
npm install
```

## Step 3 — create your private settings file

Run:

```bash
cp .env.example .env.local
```

Open `.env.local`.

Paste your **new Neon connection string** after `DATABASE_URL=`.

Generate the app login secret:

```bash
openssl rand -base64 32
```

Copy the result after `SESSION_SECRET=`.

Save the file.

## Step 4 — put the Excel file in the project root

Run:

```bash
cp "source/Disposition Sheet - Sellers.xlsx" .
```

## Step 5 — let the system inspect the Excel BEFORE migrating

Run:

```bash
npm run source:report
```

Read the numbers it prints.

The build I prepared directly from your uploaded workbook currently sees:

- 1,039 unique customers across the 3 authoritative sheets
- 1,651 historical Call 1–7 events
- 233 Sheena legacy follow-up records
- 1,884 total historical interactions
- 21 customers overlapping across authoritative sheets

Important: Claude's earlier artifact showed 1,030 unique customers. The migration does **not** trust that number; it recalculates directly from Excel.

## Step 6 — create database tables

```bash
npm run db:setup
```

## Step 7 — load the NEW disposition structure

```bash
npm run db:seed
```

This affects **new calls only**. Old calls keep their old status/remark structure.

## Step 8 — migrate the old history

```bash
npm run migrate:data
```

## Step 9 — verify nothing was lost

```bash
npm run migrate:validate
```

Only move ahead if it says `"ok": true`.

## Step 10 — create your login

```bash
npm run agent:create -- --username madhav --name "Madhav" --password "YOUR_PASSWORD" --role admin
```

Then create agent logins the same way with `--role agent`.

## Step 11 — start the platform

```bash
npm run dev
```

Open:

`http://localhost:3000`

## What you should test first

Search 5–10 Cust IDs that you know well.

For each one, compare the app with the old Excel:

- Call 1 date
- Call 1 status
- Call 1 remark
- Call 2 date/status/remark
- same-day calls
- later calls
- Sheena follow-up records

Then log one test new call and confirm the new L0/L1/L2 record appears at the bottom without changing the old history.

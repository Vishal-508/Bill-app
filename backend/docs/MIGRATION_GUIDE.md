# MDF Billing — Excel Data Migration Guide

A practical guide for importing legacy customer + bill data from your
`.xlsm` files into MongoDB. Written for the actual person running the
migration, not a developer reviewing the code.

---

## Overview

This tool reads your existing Excel billing data and copies it into the
new MongoDB-backed application. It works in **two steps**: inspect, then
migrate. It's **idempotent** — re-running on the same file produces zero
duplicates. It's **mock-mode aware** — no third-party API calls happen
during migration, so it works fully offline.

You'll typically do this once when going live. The whole flow takes
~5 minutes for a few thousand bills.

---

## Prerequisites

Before you start:

- Backend repo cloned at `E:\bill app\backend`
- Node 20+ installed (`node --version` should report v20.x or newer)
- MongoDB Atlas connection working (the rest of the app is already
  running successfully against it)
- A **backup copy** of your original `.xlsm` files, kept somewhere
  safe. The migration is non-destructive, but backups are cheap.

---

## Step 1: Place Files

Copy your `.xlsm` files into `backend/data/`:

```
backend/
├── data/
│   ├── August_25.xlsm
│   ├── Billing_gst.xlsm
│   └── sample-customers.xlsx   (← reference template)
```

The `data/` directory already exists. If your files are large, that's
fine — the inspection tool streams headers without loading every row at
once.

---

## Step 2: Inspect Structure

Run the inspection tool to see exactly what's in your files:

```bash
cd backend
node scripts/inspectExcel.js data/August_25.xlsm
```

To inspect **multiple files** at once, list them all:

```bash
node scripts/inspectExcel.js data/August_25.xlsm data/Billing_gst.xlsm
```

To **save output** for review:

```bash
node scripts/inspectExcel.js data/*.xlsm > inspection.txt
```

You'll see output like this:

```
============================================================
FILE: data/August_25.xlsm
Size: 2.3 MB
Modified: 2024-08-31T18:42:11Z
============================================================

--- Sheet: "Data base" ---
Total rows: 5187 (including header row)
Total data rows: 5186
Columns (15): ["Invoice No", "Date", "Party", "Phone", ...]

Detected column types (sampled from first 100 rows):
  Invoice No: string
  Date: date
  Party: string
  Phone: string
  GSTIN: string
  ...

Empty values per column (in sample):
  GSTIN: 23/100 (23% empty)
  Email: 78/100 (78% empty)

Unique values per column (cardinality < 20, in sample):
  Bill Type: ["GST", "NON_GST"]
  State: ["MP", "RJ", "UP"]

Sample rows (first 3 data rows):
Row 2:
  Invoice No: "INV-001"
  Date: 2024-04-10T00:00:00.000Z
  Party: "Kumar Wood Works"
  ...
```

**What to look for:**
- Exact column header names (case-sensitive, including spaces)
- Date format (the tool auto-detects most common ones)
- Empty-value rates (high empties might mean column is mis-mapped)
- Unique values for enum-like columns (Bill Type, State, etc.)

---

## Step 3: Update MAPPING in migrateExcel.js

Open `backend/scripts/migrateExcel.js`. Near the top, you'll see a
`DEFAULT_MAPPING` object. Replace every `_REPLACE_WITH_*` placeholder
with the actual column header from your file.

**Example** — if your inspection showed the customer sheet is named
`"Party"` and the columns are `"Party Name"`, `"Phone"`, etc.:

```js
exports.DEFAULT_MAPPING = {
  customers: {
    sheetName: 'Party',
    columns: {
      customerName: 'Party Name',
      phone: 'Phone',
      email: 'Email',
      gstin: 'GSTIN',
      addressLine1: 'Address',
      city: 'City',
      state: 'State',
      pincode: 'Pincode',
    },
  },
  // ...same shape for `bills`
};
```

If a column **doesn't exist** in your file, leave the placeholder OR
set the column to `null`. The migrator will skip optional fields
gracefully.

If a **whole phase** isn't relevant (e.g., no product master sheet),
set `sheetName: null` for that phase.

---

## Step 4: Dry-Run First (CRITICAL)

Never run a real migration without a dry-run first. The dry-run parses
your file, validates rows, and reports what **would** happen — without
touching the database.

```bash
node scripts/migrateExcel.js --file data/August_25.xlsm --dry-run
```

Sample output:

```
✅ Migration DRY-RUN complete.
   customers: 142 created, 0 updated, 5 skipped, 0 errors
   bills: 4823 created, 0 updated, 12 skipped, 3 errors
```

**Common dry-run findings:**

| Skipped reason | What it means | Fix |
|---|---|---|
| `invalid_phone` | Phone column has data that doesn't look like a 10-digit Indian mobile | Check the phone column in inspection output |
| `customer_not_found` | Bill row's phone doesn't match any customer | Run the customers phase first, or fix the phone in Excel |
| `no_invoice_no` | Bill row has empty invoice number | Skip these rows in Excel, or accept the loss |
| `placeholders_unresolved` | MAPPING still has `_REPLACE_WITH_*` values | Go back to Step 3 |

---

## Step 5: Limited Test Run

Run a real migration on just the first 10 rows of each phase:

```bash
node scripts/migrateExcel.js --file data/August_25.xlsm --limit 10
```

You'll be asked to confirm (`y/N`) since this writes to the database.

Verify the result before doing the full run. Check via the admin
dashboard (once Prompts 10+ are built) or directly with `mongosh`:

```javascript
use shree_gopal_mdf
db.customers.find({"migrationMeta.source": {$exists: true}}).limit(5)
```

If the data looks correct, proceed.

---

## Step 6: Full Migration

```bash
node scripts/migrateExcel.js --file data/August_25.xlsm
```

You'll be prompted to confirm. Type `y` and press Enter.

To skip the prompt (e.g., in a script):

```bash
node scripts/migrateExcel.js --file data/August_25.xlsm --force
```

Progress prints to the console. Final summary looks like:

```
✅ Migration complete.
   Log: backend/data/migration-log-20240901-143217.json
   customers: 142 created, 28 updated, 5 skipped, 0 errors
   bills: 4823 created, 0 updated, 12 skipped, 3 errors
```

---

## Step 7: Verify

Every migration writes a detailed log to `backend/data/`:

```
data/migration-log-20240901-143217.json
```

Open it in any text editor. It contains:

- `startedAt`, `completedAt` timestamps
- Per-phase results with full lists of skipped rows + errors
- Aggregate summary

To cross-check counts directly in Mongo:

```javascript
use shree_gopal_mdf
db.customers.countDocuments({"migrationMeta.source": "August_25.xlsm"})
// should match the "customers.created" count from the log
```

---

## Phase Filtering

Run only specific phases instead of `all`:

```bash
# Customers only
node scripts/migrateExcel.js --file data/August_25.xlsm --phase customers

# Bills only (customers must already exist for phone-based linkage)
node scripts/migrateExcel.js --file data/August_25.xlsm --phase bills

# Products only (if you've mapped them)
node scripts/migrateExcel.js --file data/August_25.xlsm --phase products
```

Default is `--phase all`.

---

## Idempotency Guarantees

| Phase | Match key | Re-run behavior |
|---|---|---|
| Customers | `phone` | Found → fills empty fields only (non-destructive). Missing → created. |
| Bills | `MIG-<invoiceNo>` billNumber | Found → skipped. Missing → created. |
| Products | `sku` | Found → fills empty fields. Missing → created. |

**Re-running the same file produces zero new entities.** Safe to run
the same command 100 times.

**Manual edits are preserved.** If you migrated a customer, then
edited their notes via the admin UI, then re-ran migration — your
notes stay untouched. The migrator only fills empty fields.

---

## Common Issues

**Q: "MAPPING not configured" error on real run**
A: You still have `_REPLACE_WITH_*` placeholders in `migrateExcel.js`.
Either complete Step 3, or use `--dry-run` to test.

**Q: "customer_not_found for phone 9876543210"**
A: Two possibilities. (a) Customers phase didn't run yet — run that
first. (b) The phone column in the bill sheet has different formatting
than the customer sheet (extra spaces, country code, dashes). The
normalizer handles common cases but check both columns in inspection.

**Q: "duplicate key error: gstin_1 dup key"**
A: A customer with that GSTIN already exists. Most often because
someone manually entered them earlier. Check the log file for the
exact row + GSTIN, then either delete the duplicate manually or skip
that row in Excel.

**Q: Migration feels slow**
A: Expected. ~1,000 rows per minute is typical (each row is a DB
round-trip). 5,000 bills → 5 minutes. Not slow enough to optimize.

**Q: How do I undo a migration?**
A: Use the `migrationMeta.source` field to identify migrated records:

```javascript
const source = "August_25.xlsm"; // or whatever you named it
db.bills.deleteMany({"migrationMeta.source": source})
db.orders.deleteMany({"migrationMeta.source": source})
db.customers.deleteMany({"migrationMeta.source": source})
```

Run bills first (they reference customers + orders).

**Q: Can I import a CSV instead?**
A: Convert it to `.xlsx` first (Excel: File → Save As → .xlsx, or use
LibreOffice). The migrator is xlsx-only.

---

## Limitations

Things this migrator deliberately **does NOT** do:

- **Bills are imported as `FINALIZED` + `PAID`.** Historical data
  assumption. If your Excel has unpaid invoices and you want them
  marked correctly, the migrator can't help — set them up manually
  after migration.
- **No PDF regeneration.** Bills imported via migration have no PDF
  attached. If you need PDFs of historical bills, you'll have to
  generate them later via the admin UI.
- **Customer portal passwords are NOT set.** Migrated customers can't
  log in to the customer-facing app until passwords are set
  (admin UI, future feature).
- **Stock movements are NOT migrated.** Importing historical sale
  movements would skew the current `Product.currentStock` values.
  Manual stock adjustments are the right approach.
- **Order line items derived from bill totals.** If your Excel has
  one row per invoice (typical), each Order gets a single
  "Migrated item" line. Per-item breakdown isn't reconstructable
  from the bill total alone.

---

## Reference: CLI Options

```
Usage: node scripts/migrateExcel.js --file <path> [options]

Options:
  --file <path>            Required. Path to .xlsx/.xlsm file.
  --phase <p>              customers | products | bills | all (default: all)
  --dry-run                Parse + validate without DB writes
  --limit <n>              Process only first N rows per phase (0 = all)
  --force                  Skip the confirmation prompt
  --help, -h               Print this help
```

---

## Sample Templates

Two reference Excel files live in `backend/data/`:

- `sample-customers.xlsx` — 5 example customer rows showing expected
  column layout
- `sample-bills.xlsx` — 5 example bill rows with phones that match the
  customer sample

Open them to see what the migrator expects. To regenerate them:

```bash
npm run generate:samples
```

You can run a dry-run migration against these samples to test the tool
end-to-end before pointing it at your real data:

```bash
node scripts/migrateExcel.js --file data/sample-customers.xlsx --dry-run
```

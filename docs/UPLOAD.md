# Upload Data — Storage, CSV Columns & Replace Behaviour

This document describes how the **Upload** section stores data, which columns are required for each file type, and what happens when a valid new file replaces an older one.

Related overview: [DATA.md](./DATA.md).

---

## Where data is stored

Uploads are **not** kept as raw files on disk for runtime. After validation succeeds, rows are written to **MongoDB**:

| Upload type | Mongo collection | Scope of replace |
|-------------|------------------|------------------|
| Nifty 50 constituents | `index_constituents` | All docs with `index: "NIFTY"` |
| Bank Nifty constituents | `index_constituents` | All docs with `index: "BANKNIFTY"` |
| Sensex constituents | `index_constituents` | All docs with `index: "SENSEX"` |
| NSE event calendar | `nse_events` | **Entire** collection |
| NSE holiday circular | `nse_holidays` | **Entire** collection (runtime **merges by calendar year** over the built-in 2025–2026 list) |
| Event upload meta | `settings` (`_id: "nse_events_meta"`) | Upserts `uploaded_at`, `source_filename`, `row_count` |
| Holiday upload meta | `settings` (`_id: "nse_holidays_meta"`) | Same stamp fields |

APIs:

- `POST /api/admin/upload/constituents` — form fields: `upload_type` ∈ `nifty50` \| `banknifty` \| `sensex`, plus `file`
- `POST /api/admin/upload/events` — form field: `file`
- `POST /api/admin/upload/events/refresh` — Admin-only immediate NSE CSV refresh; no file required
- `POST /api/admin/upload/holidays` — form field: `file` (NSE trading-holiday circular)
- `GET /api/holidays` — `{ source: "upload"|"builtin", holidays: [...] }`
- `GET /api/constituents/{index}` — read back
- `GET /api/events/{index}` — joined events for constituents of that index

Accepted file types: **`.csv`**, **`.xlsx`**, **`.xls`**.

---

## Replace behaviour (important)

On a **successful** upload (file readable **and** row validation passes with **zero** errors):

1. Old rows for that category are **deleted**.
2. New rows are **inserted**.
3. The UI toast confirms how many rows were saved.

If validation fails (`ok: false` + `errors: [...]`):

- **Nothing is deleted.**
- Previous constituents / events remain unchanged.

Implementation: `event_risk_service.save_constituents` / `save_events` only run after `parse_*` returns an empty error list.

---

## Nifty 50 / Bank Nifty constituents

`upload_type`: `nifty50` → index `NIFTY` · `banknifty` → `BANKNIFTY`

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| Company Name / Company | Yes | Display + join key |
| Symbol | Yes | NSE symbol; duplicates rejected |
| Industry / Sector | Yes | Stored as industry |
| ISIN Code / ISIN | Yes | Required for Nifty & Bank Nifty |
| Weightage / Weight / Weight (%) | Yes (column) | Cell may be blank → stored as “not available”; invalid numbers error |

### Example header

```text
Company Name,Symbol,Industry,ISIN Code,Weightage
```

Typical source: NSE / Nifty Indices constituent downloads.

---

## Sensex constituents

`upload_type`: `sensex` → index `SENSEX`

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| Constituents / Company Name / Company | Yes | BSE files often use **Constituents** |
| Symbol | Yes | |
| Macro-Economic Sector / Industry / Sector | Yes | |
| Weightage / Weight / Weight (%) | Yes (column) | Same rules as Nifty |
| ISIN | No | Sensex files often omit ISIN |

### Example header

```text
Constituents,Symbol,Macro-Economic Sector,Weightage
```

Typical source: BSE Indices constituents page.

---

## NSE event calendar (automatic three-month refresh + manual upload)

The backend checks daily and, when the calendar is missing or at least 30 days
since its last actual manual upload or successful NSE fetch, downloads the same
Equity **Next 3 Months** CSV as the NSE page's
**Download (.csv)** button. It warms a session on the event-calendar page, then
requests `/api/event-calendar?index=equities&from_date=...&to_date=...&csv=true`.
This upstream route is undocumented and may change or become unavailable.
Every response is parsed and validated before the existing calendar is
replaced. A fetch or validation failure is logged, leaves the last saved rows
intact, and is retried at the next daily check.

Admins can also select the event calendar in Upload Data and click **Fetch
latest events from NSE** to run the same fetch, validation, and safe replacement
immediately. The dialog shows the last successful update time, saved row count,
and source. Success shows the newly saved count and updates the status. A fetch
or validation failure leaves the current calendar unchanged and gives an
on-screen error; downloading and uploading the CSV manually remains available
in the same dialog. To test the fetch, open Admin → Upload Data → **3 Month NSE
Event Calendar**, click the button, and confirm the success message and last
successful update status change.
Confirming or reusing existing rows does not reset the automatic refresh
interval; it is anchored to the last actual upload or successful fetch.

`POST /api/admin/upload/events` remains available as a manual fallback and
replaces **all** prior calendar rows after the uploaded file validates.

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| SYMBOL / Symbol | Yes* | *At least one of SYMBOL or COMPANY per row |
| COMPANY / Company Name / Company | Yes* | *At least one of SYMBOL or COMPANY per row |
| PURPOSE / Purpose / Event / Event Type | Yes | Classified into Quarterly Results, Board Meeting, Dividend, AGM, etc. |
| DATE / Date / Event Date / BM Date | Yes | Many formats accepted (`20-Jul-2026`, `YYYY-MM-DD`, …) |
| DETAILS / Details / Description | No | Helps classification |

### Example header

```text
SYMBOL,COMPANY,PURPOSE,DETAILS,DATE
```

Typical source: NSE Corporate Filings → Event Calendar. Choose **Equity** and
**Next 3 Months**, then use **Download (.csv)**. The automatic refresh consumes
that same export format; manual CSV upload remains available.

### How events appear in the app

`GET /api/events/{NIFTY|SENSEX|BANKNIFTY}` joins calendar rows to that index’s **current** constituents (by symbol, then normalized company name). Companies not in the uploaded constituent list for that index are skipped.

`days_remaining` is calendar days from **IST today** (not the server TZ). The Index Impact tile and Index Risk board only **show** rows with `days_remaining >= 0`; past dates stay in the API payload. The tile lists every upcoming type (results, board meetings, dividends, AGMs, …), not only results/board meetings. An empty list usually means the uploaded NSE calendar is already in the past — upload a current NSE export or wait for the
next automatic refresh.

The Index Impact tile fetches this endpoint immediately when the selected index changes; it does not wait for a deferred background delay. While waiting it shows a loading state, and on request failure it reports that events are unavailable instead of implying the calendar is empty.

Index Risk separates event timing from the constituent's index share (for
example, “Today · Index weight >5%”). Weight is the company's share of the
index; it does not predict the event's effect on the stock or index. Users can
filter the upcoming list by a 7-day, 30-day, or all-upcoming window and by event
type. The summary metrics and 7-day strip remain unfiltered context.
The strongest rose accent is reserved for events within the next seven days
whose constituent weight exceeds 5%; other event tiles stay neutral.

---

## NSE holiday circular (Next Holiday tile)

`POST /api/admin/upload/holidays` stores the file in Mongo `nse_holidays`. **Years present in the file replace that year’s built-in dates**; other years keep the shipped 2025–2026 circular. Polling hours (`market_hours`) and the Next Holiday tile both use the merged list.

Until a file is uploaded, Next Holiday / market-closed days still come from the built-in list in `frontend/src/lib/holidays.js` and `backend/market_hours.py`.

This is **not** the same as:

- **Next Event** (RBI / FOMC / CPI / Budget) — curated in `frontend/src/lib/econCalendar.js`
- **Index Impact / Index Risk** — NSE corporate event calendar joined to constituents (`nse_events`)

### Required columns

| Column (aliases accepted) | Required | Notes |
|---------------------------|----------|-------|
| DATE / Date / Holiday Date | Yes | `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, Excel dates |
| NAME / Name / Holiday / Holiday Name | Yes | Shown on the Next Holiday tile |
| SESSION / Session / Type | No | Blank = full holiday. `muhurat` = special live session |
| OPEN / Open / Open IST | No | `HH:MM` IST. Default `13:30` when SESSION is muhurat |
| CLOSE / Close / Close IST | No | `HH:MM` IST. Default `14:45` when SESSION is muhurat |

### Example header

```text
DATE,NAME,SESSION,OPEN,CLOSE
2027-01-26,Republic Day,,,
2027-11-08,Diwali Laxmi Pujan,muhurat,13:30,19:15
```

Sample file in-repo: `backend/seed_data/nse_holidays.csv` (2026 circular). Copy that shape for 2027 when NSE publishes the next list.

Typical source: NSE → Resources → Exchange communication → Holidays.

---

### Freshness advisories (admin only)

| Category | Stale after | Why |
|----------|-------------|-----|
| NSE events | **15 days** | 1-month calendar drifts; refresh mid-cycle so Index Risk does not miss results |
| NSE holidays | **365 days** | Annual circular; upload when NSE publishes the next year |
| Nifty 50 / Bank Nifty / Sensex constituents | **30 days** | Reconstitution / weightage drift |

`GET /api/upload/meta` is admin-only and returns `age_days`, `stale_after_days`, and `stale` per key. These reminders and the Index Risk join-coverage diagnostics are Admin-only; subscribers do not see unmatched-row names or stale-data warnings.

When a category is stale, Admin can select it in **Admin → Upload** and choose **Reuse current data** if the already-stored data is still valid. This records an Admin confirmation time for that category only; it does not change or re-upload any rows. Each category can be confirmed independently. Confirming an old event calendar does not change its event dates, so upload a current calendar when its dates need updating. Upload timestamps remain the original upload time; freshness age is measured from the later confirmation.

## Admin UI tips

1. Use **Admin → Upload** in the desktop header (or Tools on tablet/phone).
2. Pick the upload type, open the source link if needed, choose the CSV/XLSX, then Save.
3. If the modal lists row errors, fix the file and re-upload — old data stays until a clean file succeeds.
4. If the current data is still valid when it becomes stale, select that category and click **Reuse current data**; otherwise upload a fresh file. This choice is independent for Nifty 50, Bank Nifty, Sensex, NSE events, and NSE holidays.
5. After upload or confirmation, Index Risk shows **separate admin-only freshness stamps** for each category. The source upload timestamp remains unchanged when data is confirmed for reuse.

### Per-category upload meta (Mongo `settings`)

| Category | Settings `_id` |
|----------|----------------|
| Nifty 50 | `constituents_meta_NIFTY` |
| Bank Nifty | `constituents_meta_BANKNIFTY` |
| Sensex | `constituents_meta_SENSEX` |
| NSE events | `nse_events_meta` |
| NSE holidays | `nse_holidays_meta` |

Each doc stores `uploaded_at`, `source_filename`, and `row_count`; `confirmed_at` records the most recent Admin confirmation (set on successful upload as well). The raw file is not retained; reuse keeps the validated rows already stored in MongoDB.

---

## Seed data (local / bootstrap)

Optional samples under `backend/seed_data/` (`nifty50.xlsx`, `events.csv`, …) can be loaded via `seed_index_data.py` for development. Production should rely on admin uploads of the latest official files.

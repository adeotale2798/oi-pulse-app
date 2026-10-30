# StrikLenz — About the Project
StrikLenz is a live NSE Open Interest dashboard for **NIFTY**, **SENSEX**, and **BANKNIFTY**. It polls Zerodha Kite Connect, stores strike-level OI snapshots in MongoDB, and surfaces change charts, alerts, straddles, and session replay. It does not provide ranked sell candidates or sell recommendations to any account type.

Product story (what / why / edge / config): **[README.md](../README.md)**. Versioning: **[VERSIONING.md](./VERSIONING.md)**. Optional desk LLM: **[AI.md](./AI.md)**. Click the logo or version label in the app for the same About panel.

Stack: **React (CRA/craco) + FastAPI + Motor/MongoDB + Kite Connect**.

---

## Login & access

| Role | How | Token |
|------|-----|-------|
| **Admin** | `POST /api/auth/login` with username/password (`ADMIN_USERNAME` / `ADMIN_PASSWORD` in `backend/.env`) | `X-Admin-Token` (session TTL; optionally expires at market close) |
| **Remember me** | `POST /api/auth/remember-login` with 24h IP-bound device token | Issues a fresh admin session |
| **Guest** | Guest sign-in must be enabled in Admin Settings and Public access must be ON; full name required. If **Require approval** is ON (default), Access Control must approve every new access request. A lost/expired token requires a fresh request; an IP address or display name never restores access. If approval is OFF, a guest session is minted immediately | `X-Guest-Token` |
| **Member** | Google OAuth; Basic, Premium, or Pro entitlement. Basic keeps the internal plan ID `normal` for compatibility. Member sessions are durable and do not depend on the guest Public switch | `X-Member-Token` (legacy browser clients send the same token as `X-Guest-Token`) |
| **Blocked IP** | Admin can block/unblock IPs; blocked clients cannot enter as guest | — |

Auth state: `GET /api/auth/state` (public flag, guest sign-in and Google availability, admin/guest/member flags, member plan/features and plan availability, signup/provider availability, pending request count, and public walkthrough availability).

Admin Settings → Public entry connection sets the main site's wait before its
auth-service retry screen appears (5–60 seconds; default 10). The public
`GET /api/public/boot-config` endpoint returns only that duration and no
credentials or other platform settings.

Admin Settings → Google Sign-In independently controls Google login and whether new guest sign-ins are allowed. Guest sign-in defaults off; turning it off blocks new guest entries and approval-token polling but does not revoke existing sessions. The Public toggle remains a separate access-window control: `POST /api/auth/public-access` `{ open: true|false, require_approval?: bool }` (admin). `require_approval` defaults **true** when unset. Guests are kicked when Public turns off. Access requests: list / approve / reject under `/api/auth/access-requests*`.

### Membership and billing

Admin Settings configures the three plan entitlements, signup/paid rollout,
Razorpay plan IDs, regular cadence prices, optional first-period offer prices
and matching offer IDs, and the defaults copied to new members. A first-period
offer must be a single-use flat Razorpay discount for the exact price
difference, verified in the Razorpay Dashboard by Admin; configure payment
failure to block checkout when that offer cannot be applied. StrikLenz checks
that the offer ID is present but cannot inspect the provider-side discount.
The separate `/admin/subscriptions` screen lists members and supports
admin plan overrides, suspension, linked broker account status, Pro trade-cycle
storage opt-in, and a redacted audit history of plan, payment, suspension, and
broker-credential changes. The separate Admin-only
`/admin/membership-analytics` dashboard shows recent joiners, signup-to-paid
conversion, current plan mix, paid-cohort retention, optional signup
attribution, estimated MRR, and verified actual collections/refunds. The
dashboard defaults to the last seven India-market calendar days and supports
7/30/90-day or custom ranges. Historical amounts and attribution are
incomplete; they are not inferred from browser or checkout data.
Google members manage their own alert/display preferences at
`/account`; Pro members also have a private journal at `/account/journal`.
Alert sound controls are hidden for members unless their plan entitlement is
enabled in Admin Settings. The private journal calendar is scoped to the
current member and stores personal notes, not daily profit/P&L, admin daily P&L,
or broker cycles.
The Basic plan is stored under the legacy `normal` plan ID. When a member's
assigned plan is disabled, their member session remains valid but dashboard
routes show a subscription notice; `/account` remains available to manage the
account or purchase an enabled paid plan. Re-enabling the assigned plan
restores its access. Cancelling a paid subscription, a failed payment, or
another provider status that ends paid entitlement immediately moves the member
to Basic; no paid-through cancellation grace period is applied.
The public landing page is controlled from Admin Settings or the dashboard
header. When enabled, the main-site `/` route shows the plan comparison and its
plan buttons lead to `/login`; member login success then opens the entitled
dashboard. Plan feature/pricing configuration is at `/admin/settings`, while
`/admin/subscriptions` is for per-member administration.
Landing-page section/card visibility is managed separately at
`/admin/settings/landingpage`. The public broker directory is hidden by
default; those display controls do not enable or disable broker integrations.
The public Site Walkthrough availability toggle in Admin Settings and the
dashboard Admin controls both update the same saved setting. When disabled,
public landing-page links to the walkthrough and interactive demo are hidden.
The Admin landing-page editor also manages copy for navigation, the hero,
feature cards, demos, Pro showcase, plan comparison, FAQs, calls to action, and
footer, alongside each feature's plan-detail description and user edge. Copy
uses a server-side allowlist and bounded text length; plan prices and feature
entitlements remain in Admin Settings. Admins can globally show or hide the
plan **More info** buttons; disabled details and screenshots are also
unavailable from their public endpoints.
That same admin page manages up to three compressed screenshots per plan,
including editable titles, an in-place preview and removal control; public
image payloads are not included in the general site-config response. Admins
also choose and order walkthrough features, edit their explanatory copy, explicitly capture/refresh
a sanitized shared-data snapshot, and preview the current selections in place.
The in-place walkthrough preview includes its own capture/refresh action, so
Admins can refresh the shared feeds and immediately verify the new snapshot
across the feature tabs without closing the preview.
The capture includes publisher OI, straddle, index events, exchange holidays,
Market Intel, Global Markets, the publisher's shared alert tape, and a
sanitized heavyweight cash tape (constituent, index, weight, move, breadth,
source, and timestamp only) for the Desk AI briefing. It never
copies member-filtered alert history, member preferences, broker credentials,
positions, journals, or trade cycles. Position and journal previews remain
fictional local examples. Public snapshot data is loaded only when a plan's
**More info** view opens and remains unchanged until Admin refreshes it.
Optional administrator-uploaded screenshots supplement the data-backed
walkthrough. When a shared feed is unavailable or empty, that feature's
walkthrough uses a visibly labeled fictional sample so every tab remains
illustrative without presenting sample values as live. Desk AI is a
market-session briefing—not an interactive chat—and uses shared sources only;
it never accesses, analyzes, or comments on a member's positions.
The public OI sample uses paired call/put bars, and Build-up shows neutral
measured changes rather than directional labels. Index Risk previews scheduled
event context without producing a risk score. Premium inbox rows for OI,
Market Intel, Global Markets, major moves, and events are fictional local
examples, never a member's private alert history.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/public/boot-config` | Public, minimal startup configuration; only the Admin-set auth wait duration |
| GET | `/public/site-config` | Public landing-page visibility, plans/pricing, broker directory, and sign-in readiness |
| GET | `/public/landing-plan-screenshots/{plan}` | Image payloads for one plan, fetched only when its landing-page details are opened |
| GET | `/public/landing-plan-preview/{plan}` | Selected entitled features, copy, and sanitized saved data snapshot for one plan; fetched only when its details open |
| POST | `/admin/platform/landing-plan-preview` | Admin-only explicit capture write; rejects private member data and snapshots larger than 3 MB |
| POST | `/admin/upload/events/refresh` | Admin-only: fetch, validate, and replace the NSE event calendar from its three-month CSV export |
| GET | `/auth/google/login-url` | Google OAuth URL; browser validates one-time state before exchange |
| POST | `/auth/google/exchange` | Verified Google identity → durable member session |
| POST | `/auth/local-test-login` | Local development only; configured test members, loopback requests only |
| GET | `/kite/user/status` | Caller-owned broker status; Pro status includes a masked API-key hint, credential-save time, and the member's locked Zerodha identity |
| PUT | `/kite/user/credentials` | Pro-only encrypted per-member broker app API key/secret; changing them invalidates the daily session but does not change the first-linked Kite user ID |
| GET/DELETE | `/membership/broker-credentials` | Signed-in member checks or permanently removes their saved app credentials, including after paid access lapses |
| GET | `/kite/user/login-url` | Authenticated broker login URL and exact registered redirect URI for today's request token |
| GET | `/kite/user/callback` | Broker app callback bridge to the SPA token exchange |
| POST | `/kite/user/session` | Exchanges the one-time daily request token using the member's own app credentials (guest flow retains publisher app); the first successful Pro connection binds the Google account to that Kite user ID and later mismatches are rejected |
| POST | `/kite/user/disconnect` | Clears only the caller's daily session token; Pro app credentials remain encrypted and saved |
| GET | `/membership/me` | Caller’s own profile, effective plan, payment status, billing cadence/end date, preferences, pending checkout link, and up to 25 redacted subscription-history events scoped to that member |
| GET/PUT | `/membership/preferences` | Caller-owned alert, Pro display, and hidden-dashboard-page preferences |
| GET | `/membership/journal?year=YYYY&month=MM` (`view=year` for year recap) | Caller-owned Pro journal calendar and P&L summary; identity is taken from the authenticated member session |
| GET/PUT | `/membership/journal/{day}` | Pro-only private day P&L summary, reflection, tags, rating, and notes; never reads the admin journal |
| GET | `/membership/journal-period?from=YYYY-MM-DD&to=YYYY-MM-DD` | Caller-owned aggregate period totals for the same Pro journal |
| POST/DELETE | `/membership/journal/{day}/screenshot` | Add/remove a screenshot from the authenticated member's private journal day |
| POST | `/journal/sync` | Admin-only forced refresh of current Kite positions and charges into the Admin journal; reports when EOD rules keep P&L frozen |
| GET | `/membership/alerts` | Authenticated Premium/Pro alerts filtered by that member's indices/types/threshold |
| POST | `/membership/alerts/oi-shift` | Persist an entitled member's detected OI-shift alert to that member's expiring inbox |
| POST | `/membership/alerts/{id}/ack` | Acknowledge one caller-owned alert |
| POST | `/billing/checkout` | Creates a Razorpay subscription; entitlement is not granted by the browser |
| POST | `/billing/cancel` | Immediately cancel through Razorpay and return the member to Basic; accepts an optional allowlisted cancellation reason |
| POST | `/billing/razorpay/webhook` | Signature-verified subscription lifecycle updates; provider events, not checkout return pages, grant access |
| GET | `/admin/subscription-health` | Admin-only current accessible members by plan, all-time billing totals, and up to 50 actionable member rows per disabled-Basic/payment-attention list, with total/truncation counts |
| GET | `/admin/membership-analytics?days=7` or `?from=YYYY-MM-DD&to=YYYY-MM-DD` | Admin-only membership growth, signup funnel, active plan mix, observed paid-cohort retention/attrition, acquisition labels, estimated MRR, and signed-provider revenue data with monthly reconciliation totals; period billing/checkout reads are date-bounded in India Standard Time, cohort conversion is scoped to the selected signup cohort, and processing time/record counts are returned for capacity monitoring |
| GET | `/admin/members/{id}/audit` | Admin-only redacted audit history for a member |
| GET/PATCH | `/admin/members*` | Admin-only subscriber management; `GET /admin/members?member_id=...` loads one targeted member; overrides/suspensions do not delete member-owned data |

The account page displays a redacted, caller-only subscription history, pending checkout, immediate cancellation, payment
failure, refund, and access-end states and lets members begin a replacement
checkout once overlapping paid access has ended. Renewal and payment-failure
reminders are currently in-account only; no outbound email provider is
configured. Cancellation optionally records one fixed category in the Admin
audit without free-text notes. Members can resume a still-pending hosted
checkout when Razorpay returns its checkout URL.

Publisher credentials remain the source for shared OI and market pages. A Pro
member's encrypted app key, secret, and daily access token are stored against
the stable Google member identity and used only for that member's Positions
book. The app key and secret remain saved when a daily session expires, is
disconnected, or a plan lapses; a new request token is required for each trading
day. Public guest access and membership rollout are independent controls. Subscriber MCX,
polling, publisher credential controls, and CAS desk/status/backtest access are
never exposed to member accounts. CAS remains available to admins and to guests
when its Public dashboard page is enabled.

The Indicative Price display is available to Basic, Premium, and Pro dashboard
users in the sidebar, between expiry selection and strike controls. It appears
during the admin-configured display window; the dashboard’s existing
Indicative Price timing and quote behavior are unchanged.

### Public product walkthrough

The frontend route **`/sitewalkthrough`** (including case variants) is an anonymous, public preview of the
real Dashboard UI. A route-scoped Axios adapter supplies fictional sample data
and contains all dashboard writes in memory; only the public `/auth/state`
availability check reaches the backend. It never connects to Kite or reads
real account/database data. CAS and every admin-only surface, including the
trade journal, remain unavailable. The route can be enabled or disabled in
the header **Admin Settings → Site walkthrough** toggle. Demo changes reset on
refresh and are never broker orders, guest data, or saved records. Index quotes,
OI, options, and straddles evolve together from a deterministic fictional clock
during regular NSE sessions (09:15–15:30 IST, weekdays excluding full
holidays); published special-session hours are followed when scheduled.
Fictional Desk AI cash/news/breadth data and stable-cadence strike alerts are
available in the preview and are explicitly labelled as samples. Outside
trading hours market values remain at the prior session close. When the toggle
is off, `/sitewalkthrough` displays the branded maintenance screen without
requesting market data. The availability toggle is persisted with dashboard
settings and is returned by the public auth-state endpoint used by the route.
Enabling site-wide maintenance also turns the walkthrough off; returning the
main site to live leaves the walkthrough disabled until an admin explicitly
turns it back on.

---

## Internal API (FastAPI, prefix `/api`)

### Core OI & market
| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | API hello + **product version** |
| GET | `/health` `/ready` `/api/health` | K8s readiness — 200 without Kite/Yahoo |
| GET | `/version` | Public `{ name, version, version_label }` for the current product release |
| GET | `/status` | Provider-neutral feed mode (`live`/`offline`) and health for desk users; Admin retains broker diagnostics, market hours, and `app_version` |
| GET | `/admin/indices` `/search` `/inspect` | Admin: registry + Kite discovery |
| POST | `/admin/indices/sync` `{name}/enable` `{name}/disable` | Admin: dump refresh + toggle (keeps history) |
| GET | `/settings` / POST `/settings` | Admin settings (enabled indices, alert windows, market close, trade-cycle persistence, etc.) |
| GET | `/public/login-preview/oi` | Public login preview: current NIFTY OI at a limited set of nearby strikes; no history |
| GET | `/oi/{index}` | Latest snapshot (desk user; page visibility and plan entitlement enforced) |
| GET | `/oi/{index}/change` | Current vs N-minutes-ago + multi-window deltas (desk user; page visibility and plan entitlement enforced) |
| GET | `/history/{index}` | Snapshot timeline for Replay (desk user; page visibility and plan entitlement enforced) |
| GET | `/expiries/{index}` / POST | Expiry list + selection (GET requires desk access; POST is Admin-only) |
| GET | `/alerts` | Authenticated admin or approved guest reversal alerts (session-scoped; prior days purged at new open) |
| DELETE | `/alerts` | Admin-only: clear shared reversal alerts |
| GET | `/tickers` | Index LTP / prev close cards with generic freshness indicators |
| GET | `/tickers/extras` | India VIX, GIFT NIFTY, and session windows without provider identifiers |
| GET | `/market/status` | Open/close helpers |
| GET | `/market/fii-dii` | Cached NSE FII/DII cash (after 19:31 IST warm) |
| GET | `/cas/status` | Classic CAS + Auto Trade snapshot (guests: reduced; Admin broker-readiness diagnostics are omitted) |
| POST | `/cas/settings` | Admin: classic CAS + Auto Trade times/thresholds/mode |
| POST | `/cas/auto-trade/inject` | Admin Paper: fake first indicative (rehearsal before 15:20). Runbook: [CAS_AUTO_TRADE_15_20.md](./CAS_AUTO_TRADE_15_20.md) |
| GET | `/vrp/{index}` | Volatility risk premium (EOD-ish; desk user with Open Interest access) |
| GET | `/straddle/{index}` (+ `/tick`, `/history`) | ATM straddle series (desk user; page visibility and plan entitlement enforced) |
| GET | `/positions` | Open F&O from Kite (admin publisher book / guest own book), with `pnl_today` broker totals. Anonymous 401. Header Today P&L is admin-only. Positions and PositionMeter share this response and poller; PositionMeter derives open-short premium capture, decay runway, and strike-level hedge quantity from enriched rows. The feed does not include per-option quote timestamps or strategy IDs. Risk scenarios are client-side estimates and add no broker request. |
| GET | `/trades/export` | Excel of stored cycles (`from`/`to` IST dates, optional `index`). Desk user. Entry + exit clocks; second sheet is fills/partials. |
| GET | `/trades/archive/range` `/trades/archive/export` | Admin: count or download owned closed cycles for exact inclusive `from`/`to` Exit Dates as gzip NDJSON. Future dates are rejected. |
| POST | `/trades/archive/compact` | Admin: after download, SHA-256 verified removal of only raw events/fills for detailed cycles in the same inclusive date range. |
| POST | `/trades/archive/delete` | Admin: after download, SHA-256 verified permanent deletion of owned closed cycles in the same inclusive date range. Open/partial and guest cycles are excluded. |
| GET | `/desk-outside` | Heavyweight cash movers + news without provider names or original article links. Pass `?index=` when the selected name is an enabled MCX contract |
| GET | `/global-markets/overview` `/global-markets/instruments` | Member-accessible market data without provider attribution or provider configuration |
| GET | `/adrs` `/adrs/history/{adr_id}` | Desk-user ADR snapshot/history without provider metadata; Admin configuration diagnostics remain under `/adrs/config` |
| POST | `/desk-guide` | Admin-only read-only market/book guide; explicit trade-action output is not available to members (see [AI.md](./AI.md)) |
| POST | `/desk-ai` | Desk user: one `desk_ai_show` flag for the whole desk |
| GET/POST/DELETE | `/desk-ai/providers` | Admin: vaulted OpenAI-compatible Desk AI keys |
| GET | `/market-intel` | Ranked clustered events (desk user). Query `filter=`. External members receive directional estimates, volatility context, India transmission, freshness, and index impacts without publisher names, source URLs, or source-agreement counts; Admin retains source attribution. |
| GET | `/market-intel/index-risk` | Market Intel entitled desk user: current or requested IST date (`date=YYYY-MM-DD`) summary for NIFTY, BANKNIFTY, and SENSEX, derived from retained stories, uploaded constituent weights, and the NSE event calendar. Members receive risk level/score, tentative direction, event evidence, and scheduled-result matches without publisher attribution or original article URLs; Admin retains those details. Scores are heuristic exposure rankings, not probabilities or trade signals. |
| GET | `/market-intel/performance` | Separate direction alignment and textual-volatility validation against existing OI snapshots. Direction hit rates include weak / moderate / strong heuristic-score bands and a strong-vs-weak comparison; volatility outcomes are also grouped by RBI, crude, global-rates, and earnings catalysts. Rates and catalyst breakdowns require at least 30 usable event-cluster outcomes in their group. |
| GET | `/market-memory/{index}` | Recent price-level interaction summary derived from stored OI snapshots (desk user) |
| GET/POST | `/market-intel/prefs` | Per-user page/popup prefs; public feeds and the page default to 60-second refresh, with default popup thresholds of 75 impact / 30 India relevance |
| GET | `/market-intel/popup` POST `/market-intel/popup/ack` | In-app high-impact popup (up to 12 unseen clusters), including direction, volatility, India-link, timing evidence, and computed index exposure. Members do not receive publisher names or source-agreement details. The default includes high-impact India-relevant events plus a critical global-event override. Desk-wide popup tick off → empty for everyone; ingest is independent. Admin always receives items when the desk tick is on. |
| GET/POST/DELETE | `/market-intel/sources` | Admin sources; `.../test` and `.../fetch`. The ingest worker seeds/maintains index-specific public Google News searches for the 12 highest-weight uploaded constituents of each core index; Admin can inspect, disable, or customize them here. |
| POST | `/market-intel/cleanup` | Admin retention cleanup now |
| GET | `/market-intel/templates` | Admin-only source/API catalog + RSS templates |
| POST | `/admin/refresh-day` | **Fresh Pull** — wipe snapshots, live-pull all **enabled** indices |
| POST | `/admin/upload/constituents` | CSV/XLSX constituents (replaces index bucket on success — see [UPLOAD.md](./UPLOAD.md)) |
| POST | `/admin/upload/events` | Event calendar upload (full replace on success) |
| POST | `/admin/upload/holidays` | NSE holiday circular (year overlay on success) |
| GET | `/holidays` | Holiday rows; upload-origin metadata is Admin-only |
| POST | `/admin/upload/reuse/{upload_type}` | Admin confirms that one existing data category remains current; stored rows are unchanged |
| GET | `/upload/meta` | Admin-only upload timestamps and freshness advisories (Nifty / Bank / Sensex / events / holidays) |
| GET | `/events/{index}` / `/constituents/{index}` | Stored event/constituent data (+ upload timestamps); source filenames and join-coverage diagnostics are Admin-only. Index Impact and Index Risk share brief role-separated frontend request caching. |

### Auth
`/auth/login`, `/auth/remember-login`, `/auth/logout`, `/auth/change-password`, `/auth/guest`, `/auth/state`, `/auth/public-access`, `/auth/guests*`, `/auth/access-requests*`, `/auth/blocked-ips*`, `/auth/access-request/{id}`.

### Kite credentials
`POST /credentials`, `GET /credentials/status`, `POST /kite/generate-session`, `GET /kite/vault`, `POST /kite/refresh`, `DELETE /kite/vault`, `POST /mode`, `POST /tracker/start|stop`.

### Telegram
`/telegram/status`, `/telegram/prefs`, `/telegram/test`, `/telegram/huge-shift`, digest preview/send.
`/telegram/huge-shift` is Admin-only; shift labels are validated and escaped before Telegram HTML rendering.

### WebSockets
Spot and straddle WS endpoints (see `frontend/src/lib/spotWs.js`, `straddleWs.js`) — default `ws://localhost:8000`.

---

## External services

| Service | Used for |
|---------|----------|
| **Zerodha Kite Connect** | Live option chain / OI, spot, GIFT NIFTY (`NSEIX:GIFT NIFTY`), India VIX, positions |
| **MongoDB** | Snapshots, alerts, sessions, credentials vault, settings |
| **Telegram Bot API** | Optional alert / huge-shift / digest delivery. Token/chat from Admin → Admin configuration (Fernet vault) or `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` env fallback. |
| **yfinance** (optional paths) | Auxiliary market data where configured |
| **Google Fonts** | Inter in `index.html` (only browser third-party on the desk) |

Admin → API Configuration's **Called today** metric counts integrations with telemetry-recorded requests since local midnight. Source-discovered providers remain listed even when not configured or used; the metric does not predict future calls.

The browser talks only to **this origin** (`/api`, `/ws`). Production is **https://striklenz.com**. Failed calls to `https://striklenz.com/api/...` **are this app** behind Cloudflare when origin is slow (520/524). `aaisnamkeen.com` is a retired host — Kite redirects must not land there. `sc.ecombullet.com` is **not** in this repo. In the broker app console, set its redirect URL to the exact value returned by `/api/kite/user/login-url` (production: `https://striklenz.com/api/kite/user/callback`). That backend callback redirects to `/kite-callback`, where the one-time token is exchanged and the account's encrypted session is stored.

No synthetic OI backfill in production Fresh Pull — only real Kite ticks (or empty DB offline).

---

## UI surfaces

- **Header** — LIVE/OFFLINE, tickers, Fresh Pull (admin), Kite API, Public toggle. Today P&L is **admin-only** (never on the public header).
- **Sidebar** — index chips with last-pull times (stale flash if inactive & >2 min behind), expiries, strike range
- **Main tabs** — OI Change chart, Strike Table, Build-up, Positions, Alerts, Holidays
- **Right panel** — Alerts / Suggestions / Activity (hidden on phones; use Alerts tab / FAB)
- **Replay** — scrub last ~3h; huge-shift modal can **Jump to HH:MM** bookmark

See also: [DATA.md](./DATA.md) · [LOCAL_SETUP.md](./LOCAL_SETUP.md)

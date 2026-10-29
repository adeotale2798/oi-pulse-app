# StrikLenz

**Version:** see [`VERSION`](VERSION) (display as `V` + that number). Product name: [`APP_NAME`](APP_NAME) — change that one file to rename the desk.

StrikLenz is a live **NSE open-interest desk** for **NIFTY**, **SENSEX**, and **BANKNIFTY**. It is built for option sellers and OI readers who need strike-level conviction during the cash session — not a generic charting terminal.

Stack: **React (CRA/craco) + FastAPI + MongoDB + broker API integration**.
See [`STACK.md`](STACK.md) for the full dependency, integration, and tooling inventory.

---

## What it does

The publisher's broker session polls the option chain on a cadence you set (15 / 30 / 60s). Every tick is stored in Mongo. The desk then shows:

| Surface | Why it is there |
|---------|-----------------|
| **OI Change** | Call vs Put OI delta vs a chosen lookback (1m … session), with a compact GEX guide, snapshot time, and estimated rupee hedging notional per 1% move in Indian units. GEX uses valid option legs within a fixed ±3% spot band and the configured contract lot size; it remains a noisy estimate (watch areas, not support/resistance; dealer sign is an assumption). After expiry, it can show the last valid same-session snapshot, clearly timestamped. On phones, GEX opens in a short bottom sheet with the current reading and direction check first; thresholds and strike areas expand on demand. The separate up/down lean requires price, OI-change and dashboard-bias agreement; otherwise it says there is no clear direction. |
| **Open Interest** | Strike bars, writer-defense map, last-pull truth |
| **Strike Table** | Compact CE/PE grid with optional gamma / institution chips |
| **Sell Candidates (Admin-only)** | Admin strike-ranking surface; not available to members or guests |
| **Build-up** | Fresh OI adding vs covering |
| **Market Intelligence** | News with a simple index risk, tentative direction, and main headline first; shows today's NSE-scheduled constituent results with a precise result-news found / not found match |
| **Positions** | Live F&O and MCX broker book (admin publisher session, or guest’s own broker); the P&L journal follows the MCX session even when MCX OI polling is disabled |
| **Alerts / Activity** | Server reversal alerts + session tape; newly arriving high-impact Market Intel stories also show an in-app alert and, when enabled, a browser notification while the desk is in the background |
| **Events / Index Risk** | Scheduled constituent calendar plus current Market Intel event exposure for the selected index (upload stamps stay admin-only) |
| **Straddle** | ATM straddle premium path |
| **Market Memory** | Recent, recency-weighted reactions around price levels, derived from existing OI snapshots |
| **CAS Expiry** | Classic 15:28 SELL-both, plus **15:20 Auto Trade** (one ATM BUY). Runbook: [docs/CAS_AUTO_TRADE_15_20.md](docs/CAS_AUTO_TRADE_15_20.md) |
| **Trade journal** | Admin daily P&L journal; Pro users get a separate private notes journal |

Guests never share the publisher positions token. If **Positions** is ticked Public, they connect their own broker for *their* book. Charts always stay on the publisher OI feed.

---

## How it works

```
Publisher broker session ──► OITracker poll ──► Mongo oi_snapshots
                                      │
                                      ├── alerts + optional Telegram
                                      ├── ATM straddle samples
                                      └── FastAPI /api/oi/{index}/change
                                               │
React desk  ◄── /api/config + /api/settings ──┘
   Admin: all ticked Admin pages + admin daily journal
   Guest: only ticked Public pages + own broker book
   Member: Google account + Basic / Premium / Pro plan entitlements
```

1. NSE pre-market starts at **09:00 IST**; OI polling starts at **09:15** and runs through the configured close (default 15:40). The desk labels the 09:00–09:15 period **Pre-market**, not stale. GIFT Nifty keeps its own sessions.
2. **Change windows** compare the latest snapshot to one ~N minutes earlier (never yesterday’s session).
3. **Fresh Pull** (admin) wipes today’s OI board and takes one live tick per enabled index.
4. **Auth**: admin password session (`X-Admin-Token`); Google sign-in creates a durable member session; guest sign-in (`X-Guest-Token`) is separately controlled by the Admin Settings → Google Sign-In guest switch and the Public access window. Guest sign-in defaults off; disabling it blocks new guest entry without revoking existing sessions. Member login remains independent of the guest-access switch.

## Membership

Basic, Premium, and Pro are configured separately in **Admin Settings** and
listed independently on the public landing page. Basic includes the core OI
dashboards; Premium adds personalized OI-change/OI-shift alerts, Market Intel,
and Global Markets. Pro includes Premium plus the member's own broker Positions,
a neutral overnight risk-factor summary, private journal, and market-context
Desk AI. Pro Desk AI is presented as a read-only session briefing for shared
market movement, index-weighted cash movers, breadth, global markets, news, and
events—not as a chat window or a source of trade suggestions. It never
accesses, analyzes, or comments on member positions; Admin-only book guidance
remains separate. Members can hide and restore
entitled dashboard pages; their choice is saved to their account. Hide a tab
from its right-click menu, by
long-pressing on touch, or with Shift+F10; use the existing **+** menu to
restore it. Non-member dashboard layouts are saved in the browser. Shared OI
remains publisher data; a Pro member's encrypted broker app
credentials are saved against their Google account. The first successful
broker login locks that Google account to its broker account ID; replacing app keys,
removing credentials, or entering a later token cannot switch it to another
broker identity. They enter a fresh request token each trading day; the saved
API key and secret remain encrypted and are used only for that member's
Positions book. The shared OI freshness indicator is separate from the member's
private broker-session status.
The Basic plan retains the internal plan ID `normal` for API and database
compatibility. Admin can disable a plan without deleting member accounts;
members on a disabled plan are shown a subscription prompt and can still open
their account settings. Enabling Basic restores its dashboard access.
Razorpay checkout is only enabled when provider credentials, webhook secret,
and the plan/cadence configuration are ready. Admin can optionally configure a
first-period price for a paid plan and cadence; its Razorpay offer must be a
single-use flat discount for exactly the difference from the regular price, and
must block payment if the offer cannot be applied. Admin must verify this in
the Razorpay Dashboard; StrikLenz can check the offer ID is present but cannot
inspect its provider-side discount. Later cycles use the regular plan price.
Members return to Basic immediately when they cancel, a payment fails, or the
provider ends the subscription. They may start another paid checkout once the
provider reports the previous subscription as ended. Admin → Subscriptions &
members includes current accessible member counts by plan and all-time
subscription charges, cancellations, failed payments, and Basic accounts
blocked because Basic is disabled.
Subscriber preferences are stored
per member; member OI-shift events are stored in a member-scoped, expiring
collection and daily alert history is cleared at 09:00 IST. Non-admin dashboard
views keep OI, PCR, and Max Pain as measurements but do not show directional
sentiment verdicts, support/resistance labels, build-up classifications, or
the GEX direction guide; those existing analytical surfaces remain Admin-only.
Each plan's **More info** view includes an interactive, feature-by-feature
product walkthrough
using a sanitized shared-data snapshot that an Admin captures and explicitly
refreshes from Admin Settings → Landing Page. The snapshot stays static in
public plan details until refreshed; it can include publisher OI, straddle,
events/holidays, Market Intel, Global Markets, the publisher desk alert tape,
and a sanitized heavyweight cash tape for the Desk AI market briefing. If a
feed is missing or empty, its walkthrough shows clearly labeled illustrative
sample content rather than an empty panel or data presented as live. Member
alert history, broker data, positions, and journals are never copied into the
public snapshot. Pro Desk AI uses shared market context only; it never accesses,
analyzes, or comments on a member's positions. Positions and journal
walkthroughs use local fictional examples. Admins can choose and order each
plan's walkthrough features and edit their explanatory copy. They can also
edit the landing-page navigation, section and feature-card copy, plan marketing
descriptions, FAQs, calls to action, and screenshot titles in the same
in-app editor. The Admin can also globally show or hide plan **More info**
walkthrough buttons; hidden plan details are not served by their public data
endpoints. Optional screenshots support, but do not replace, the functional
previews. Admin
Settings → Subscriptions manages plan overrides, suspension, linked broker
identity, and the opt-in to persist Pro trade cycles.

The walkthrough keeps OI Change separate from Open Interest, Strike Table,
Build-up, and Straddle. Its OI chart uses paired call/put bars; the public
Build-up preview shows neutral measured changes rather than directional labels.
Index Risk presents scheduled event context, while Premium's personal alert
inbox uses fictional OI, Market Intel, Global Markets, major-move, and calendar
rows. Those examples are always labeled and never read member alert history.

Details: [docs/DATA.md](docs/DATA.md) · APIs: [docs/ABOUT.md](docs/ABOUT.md).

---

## Edge for users

- **Own poll, own thresholds** — not a delayed vendor OI widget.
- **Huge-shift popup** on ATM ± 1 when institutions dump OI in a short window.
- **Writer defense / gamma wall / institutional detector** on the strikes that actually matter.
- **Two desks, one feed** — publisher OI for everyone; each user can still connect their own broker book.
- **Public / Admin page ticks** in Admin configuration so you hide noise from guests *or* from yourself.
- **Weekend / holiday carry brief** so Friday’s board is not thrown away.
- **Journal that stores booked P&L in Mongo**, not only in the browser.

---

## How it is configured

| Knob | Where |
|------|--------|
| Tracked indices, alert focus, poll seconds, market close | **Admin configuration** (gear) |
| Save your broker-book trade-cycle history | **Trade journal → Save my trade cycles** toggle (existing cycles and daily Journal P&L are retained; guest history is separate) |
| Market Memory visibility for all desk users | Admin configuration → **Data collection** |
| **Public vs Admin pages** (two ticks per tile) | Admin configuration → Public / Admin dashboard pages |
| Settings save status | Separate **Save desk settings** and **Save personal thresholds** actions show changed-setting counts; desk save status includes load/retry and last-save times |
| Public site walkthrough ON/OFF | **Admin Settings** → Site walkthrough or the dashboard Admin toggle (same saved setting) |
| Site-wide guest access ON/OFF | Header **Public** switch |
| Extra guest pages (Positions, Index Risk) | Public icon menu (same flags as settings) |
| Publisher broker key / daily token | **Broker API** |
| Guest broker | Positions → Connect broker |
| Sounds, local OI thresholds (huge shift, velocity, lots) | Settings (saved in the browser) |
| Constituents / event CSV | Admin upload — stamps stay admin-only |

---

## Quick start

```bash
# Backend
cd backend 
python -m venv .venv 
source .venv/Scripts/activate
pip install -r requirements.txt
# backend/.env → MONGO_URL, DB_NAME, ADMIN_USERNAME, ADMIN_PASSWORD
uvicorn server:app --reload --port 8000

# Frontend
cd frontend && yarn install
echo 'REACT_APP_BACKEND_URL=http://localhost:8000' > .env.local
yarn start
```

Full env: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md). CAS 15:20 Auto Trade (admin clocks, Live vs Paper, trade logic): [docs/CAS_AUTO_TRADE_15_20.md](docs/CAS_AUTO_TRADE_15_20.md). Leaving Emergent / Oracle Cloud / GoDaddy DNS: [docs/HOSTING.md](docs/HOSTING.md). Optional Admin LLM over market and position context: [docs/AI.md](docs/AI.md). Domain shortlist: [docs/DOMAINS.md](docs/DOMAINS.md).

## Public product walkthrough

Share **`/sitewalkthrough`** to let anyone explore the real StrikLenz dashboard
without signing in. It uses clearly labelled fictional sample data through a
route-scoped API adapter; dashboard reads never reach market, account, or
database endpoints, and writes stay in memory and disappear on refresh. The
sample indices, OI, options, and straddles move together during regular NSE
sessions (09:15–15:30 IST, weekdays excluding full holidays); published
special-session hours are followed when scheduled. Values freeze at the prior
session close when the market is closed. The walkthrough omits CAS and live account data. Its journal and settings are
fictional fixtures; the Admin trade-cycle persistence control is not shown, and
all demo writes stay in browser memory. The dashboard includes fictional,
market-context-only Desk AI data and sample strike-change alerts; alerts arrive
on a stable 90-second demo cadence during the session and are labelled as
samples. Administrators enable or disable the public route in the header's
**Admin Settings → Site walkthrough** toggle. When disabled, the route shows a
branded maintenance screen and requests no market data. Enabling site-wide
maintenance also disables this route; returning the main site to live does not
re-enable the walkthrough until an admin explicitly turns it on. This is not a
live market feed or an account preview.

The **Market Events Chrome extension** is **not** in this app. It lives in [adeotale27/Market_Events](https://github.com/adeotale27/Market_Events). A Pulse-only copy of that tree is on orphan branch `cursor/market-events-1bf9` (do not merge it into `main`).

In the app, click the **logo** or the current **version label** to open the same product story.

---

## Versioning (for every update and every new AI)

Start from **V5**. 

- Each shipped fix/polish: **V5.01, V5.02, …**
- A whole new feature area: **V6.00**

Update `VERSION`, `CHANGELOG.md`, `frontend/src/lib/appVersion.js`, and `backend/app_version.py` together. See [docs/VERSIONING.md](docs/VERSIONING.md) and [AGENTS.md](AGENTS.md).

# Local end-to-end audit — 2026-10-14

## Executive summary

- **Version:** V20.17
- **Scope:** Admin authentication and read-only Admin routes, plus the complete
  backend and frontend automated suites for the current worktree.
- **Environment:** The existing app API was left running and unchanged. Its
  configured Mongo host was non-loopback, so all authenticated tests ran
  against a separate loopback Mongo instance and newly named audit database.
- **Completion:** Automated and API checks completed; integrated browser
  interaction was partially blocked by the browser runner timing out on
  navigation to the isolated local test instance.
- **Confirmed product failures:** 0
- **Open product findings:** 0

Valid Admin credentials authenticated successfully against the isolated test
instance. Admin authorization and the tested configuration, subscriber-list,
settings, journal, and CAS status read routes responded as expected. The full
backend suite passed 500 tests and the full frontend suite passed 166 tests
across 39 suites. No application-code changes were made during this audit.

At audit start, Git reported 112 distinct changed paths across staged,
unstaged, and untracked work. That work was preserved; no commit, reset, or
revert was performed.

## What went well

- The isolated API returned HTTP 200 for `/ready`, `/api/version`,
  `/api/auth/state`, and `/api/config`; it reported V20.17.
- Admin login using the configured local credentials succeeded against the
  isolated database. The session token remained inside the local test proxy
  and was not written to the report.
- The unauthenticated auth state did not grant Admin access; the authenticated
  state did. A fabricated invalid login returned HTTP 401, and the protected
  Admin platform-config route returned HTTP 401 without a session.
- With the isolated Admin session, read-only GETs returned HTTP 200 for
  `/api/admin/platform/config`, `/api/admin/members`, `/api/settings`,
  `/api/config`, `/api/journal`, and `/api/cas/status`.
- Local frontend HTML and SPA deep links (`/admin`, `/admin/settings`, and
  `/admin/settings/landingpage`) returned HTTP 200 when requested as HTML.
- The existing focused tests for Admin Settings and the public-entry timeout
  passed as part of the full frontend suite.
- No settings were saved, no member or guest access was changed, no manual
  provider refresh was triggered, and no live broker or CAS action was taken.

## Findings

No functional defect was confirmed.

### Coverage limitation — integrated browser navigation

The shared browser runner timed out while navigating to the isolated Admin
test UI; the page snapshot remained unavailable. This prevented a reliable
visual/click-through check of Admin login, the dashboard, Landing Page settings,
and the Subscriptions screen in that browser session. Local HTTP checks showed
the frontend shell and deep links responding, and API/component tests passed,
so the timeout is recorded as a harness limitation rather than an application
failure. A browser-level authenticated Admin walkthrough remains unverified.

The Jest output included Recharts `ResponsiveContainer` negative-size warnings
from layout-less component tests, plus intentional debug stack traces from the
API adapter test. Tests passed; the browser timeout meant the chart warnings
could not be rechecked in a live rendered Admin walkthrough.

## Automated validation

| Check | Result |
|---|---|
| Backend: `python -m pytest tests -q -n 0 -p no:cacheprovider --basetemp <isolated path>` | **500 passed**, 5 deprecation warnings |
| Frontend: `npm run test:jest` | **39 suites passed; 166 tests passed** |
| Frontend: `npm run lint -- --no-cache` | **Passed** |
| Frontend: `npm run build` | **Passed**, optimized bundle compiled |
| Python syntax (changed backend server and platform-config test) | **No syntax errors** |
| `git diff --check HEAD` | **Passed** |

The first lint invocation was run from the repository root and returned npm
`ENOENT` because the package manifest is in `frontend/`. It was rerun from
`frontend/` and passed; this was a command working-directory issue, not a
product failure.

## Data and integration boundary

- The existing application configuration names database `oi_pulse`, but its
  Mongo host is non-loopback. After detecting that, no authenticated request or
  write was made against that service. Only read-only readiness, version,
  unauthenticated auth-state, and configuration status checks were used.
- Authenticated API checks and the Admin login session used a separate,
  loopback-only audit database. The audit API ran with an offline tracker and
  without its normal polling/background startup sequence.
- Live Kite, external paid providers, Google OAuth, Razorpay, and broker order
  paths were not exercised. No credentials, tokens, account values, or private
  records are included here.
- The isolated Admin test database was removed after validation; the isolated
  backend and token-hiding proxy were stopped, and the temporary proxy script
  was removed. The user's existing app processes and worktree were not reset
  or restarted.

## Coverage matrix

| Area | Coverage | Result |
|---|---|---|
| Admin login credential acceptance | Isolated backend login using configured local credentials | Passed |
| Invalid Admin credentials | Isolated backend POST with fabricated credentials | Rejected with HTTP 401 |
| Admin permission boundary | Unauthenticated vs authenticated auth state and protected config GET | Passed |
| Admin platform settings / subscription API | Read-only isolated GETs | Passed |
| Admin settings UI logic | Frontend component tests, including timeout load/save/validation behavior | Passed |
| Landing-page Admin UI logic | Frontend component tests | Passed |
| Member/guest/membership behavior | Full frontend/backend automated suites; no live OAuth/payment provider | Automated coverage passed; live provider flows untested |
| Dashboard and live market data | Offline API/config checks only; no live feed or poll | Partially tested |
| Admin browser visual/click-through | Shared browser runner timed out on isolated test page | Blocked |
| Live Kite, CAS execution, payments, external paid APIs | Not invoked | Not tested by design |

## Follow-up

For a complete visual Admin browser walkthrough, rerun with the integrated
browser able to reach the isolated local API port, or use an explicitly
designated isolated browser-test environment. Do not point that walkthrough at
the currently configured non-loopback database.

## Subscription-model audit addendum — 2026-10-14

### Scope and isolation

This follow-up exercised the Normal, Premium, and Pro member models and their
Admin controls using the three configured local development member identities
and the configured local Admin login. API requests ran in-process against a
fresh, uniquely named database on the loopback Mongo service. The existing
application's non-loopback database was not used. Each temporary database was
dropped after its run; test-account credentials and tokens were kept out of
the report.

No product code or persistent test files were changed by this follow-up.
Temporary UI harnesses were removed after their focused run.

### Subscription and Admin results

- Admin login succeeded; the authenticated `/api/admin/platform/config`
  read/save path worked against isolated state.
- The `membership/me` response matched the complete expected default feature
  set for each tier:
  - **Normal:** core OI dashboard pages only.
  - **Premium:** Normal plus Alerts, Market Intel, and Global Markets features.
  - **Pro:** Premium plus Positions, Trade Journal, overnight position risk,
    and Desk AI.
- Route checks matched those boundaries: Normal was denied Premium features;
  Normal and Premium were denied member Positions/Kite status and the private
  Pro journal; Premium and Pro could access Market Intel, Global Markets, and
  Alerts; Pro could access its journal and member Kite status.
- Admin disabling a Pro feature removed that entitlement immediately.
  Disabling the Pro plan removed all Pro features; re-enabling restored the
  configured set.
- Admin member controls successfully changed a local Normal account to an
  explicit Pro override, toggled Pro trade-cycle persistence on and off, and
  suspended/resumed an account. Suspension denied the existing member session;
  resumption restored access.
- Admin Settings and the subscriber screen's UI wiring were exercised in
  temporary focused component tests: plan-feature removal, plan disablement,
  member plan override, and the Pro-only trade-cycle opt-in all reached the
  intended API payloads. **2 focused UI tests passed**; the temporary test
  files were then removed.
- Admin's Landing Page **More info** switch hid all three public plan previews
  with HTTP 404 and restored them with HTTP 200 when re-enabled. Existing
  frontend tests also cover the Admin toggle and public pricing-card behavior.

### Google and Razorpay boundary

The local environment has no real Google OAuth or Razorpay credentials. The
public config correctly reported both integrations unavailable, Google login
URL generation stayed disabled without credentials, an unconfigured Google
exchange was rejected before network access, and Razorpay checkout returned
HTTP 503 before making a provider request. Against isolated settings only,
dummy integration values were accepted by the Admin config path, not returned
as plaintext in the Admin response, and the Google consent URL was constructed
without following it; disabling the integration hid the URL again.

The existing backend suite's mocked Razorpay webhook tests passed, covering
activation/cancellation and loss of access, partial/full refund behavior,
duplicate delivery, and stale event ordering. No real Google token exchange,
Razorpay API call, payment, webhook delivery, or broker action was made.
Consequently, provider credentials, redirect allowlists, live account
permissions, and end-to-end settlement remain **unverified**, not passed.

### Validation and remaining limitation

| Check | Result |
|---|---|
| Isolated local Admin/member API journeys | **Passed** for all three exact feature sets and the listed controls |
| Focused membership/billing/API tests | **60 passed** |
| Full backend suite | **500 passed**, 5 deprecation warnings |
| Full frontend Jest suite | **39 suites / 166 tests passed** |
| Temporary Admin settings/subscriber component harness | **2 passed**, then removed |
| Frontend lint | **Passed** |
| Production frontend build | **Passed** |
| `git diff --check HEAD` | **Passed** |

No browser click-through was attempted against the shared `localhost:3000`
page because its configured API targets the existing backend and its
non-loopback database. Submitting local test logins or Admin saves there would
not provide the required isolation. The isolated API journeys and automated
component tests passed, but an authenticated visual browser walkthrough
remains unverified.

## Repeat full-round check — 2026-10-14

The requested repeat was run against the current worktree:

- Backend suite: **500 passed**, 5 deprecation warnings.
- Frontend suite: **39 suites / 166 tests passed**.
- Frontend lint and production build: **passed**.
- `git diff --check HEAD`: **passed**.
- Local frontend, backend `/ready`, and backend `/api/status`: **HTTP 200**.
- A fresh isolated-Mongo API run repeated Admin login/config, all three exact
  member feature sets, Premium/Pro route restrictions, plan/feature
  disable-and-restore, per-member override and cycle-storage controls,
  suspension/resume, landing preview visibility, and no-credentials Google /
  Razorpay gates: **passed**. Its temporary database was dropped afterward.

The shared public landing page was reloaded read-only and rendered its public
sections. Before reload, its retained development-server console history
contained `ReferenceError: fmt is not defined` entries from an old
`hot-update.js` bundle. The current
[`ProductScreen.jsx`](../../frontend/src/components/landing/ProductScreen.jsx)
defines `fmt` before `IndexTiles` uses it; after reload there was no recurrence
of that error, and the current production build passed. The fresh page did
report Recharts container-size warnings in the layout-less browser viewport;
they are warnings, not a new confirmed functional failure. No login or
write-capable action was taken in the shared browser.

The real Google, Razorpay, and broker integrations remain unverified because
their local credentials are absent; no provider requests were made. The shared
browser check was public and read-only, so the authenticated browser-level
Admin walkthrough remains outstanding. No product-code changes were made.

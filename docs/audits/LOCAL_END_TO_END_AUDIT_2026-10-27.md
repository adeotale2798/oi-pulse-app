# Local Positions end-to-end audit — 2026-10-27

## Executive summary

- **Local version:** V20.66.
- **Scope:** Positions book normalization, booked/open P&L, charge calculation and display, admin journal snapshot path, and available automated coverage.
- **Audit time:** 2026-10-27, approximately 22:28 IST.
- **Completion:** **Local app smoke test completed; live Kite Positions untested.** The app was run against a fresh loopback-only audit database with no Kite credentials. UI/API integration and public-provider startup refresh checks completed; the configured non-loopback Mongo database was not contacted.
- **Findings:** 0 critical, 0 high, 1 medium open; the previously identified net/day realised-value defect is fixed in the local worktree, but not live-verified.

The previously approved merge correction is covered by passing regression tests: a reported `net.realised` value is retained, including zero, and `day.realised` is used only if the net row omits the field. A separate source-confirmed risk remains: Positions can temporarily display gross booked P&L under an “after charges” label if the journal has no usable saved charges yet. The local app loaded in admin development mode, the empty-book Positions state and journal opened, and desktop/mobile layouts had no document-level horizontal overflow. Live Kite position values remain untested because no broker credentials were provided to the isolated app.

## What went well

- The Positions calculation path was traced from Kite `positions().net` / `.day` through merge, booked-P&L normalization, quote marking, response totals, journal snapshot, and UI display.
- Backend and frontend ran on loopback with an isolated Mongo database; the configured non-loopback database was not used. Backend readiness, version, auth state, dashboard config, and read-only API requests responded.
- Desktop (1440px) and phone (390px) browser checks showed the Positions empty/disconnected state and no horizontal document overflow. The Journal button opened its dialog against the empty isolated audit database.
- The Positions API correctly returned an offline / broker-not-connected state with no positions because the app was intentionally started without Kite credentials. The journal and charge routes responded with empty/not-connected data rather than account data.
- Startup public-provider refresh loops ran only against the isolated database, as explicitly approved. No Kite request, broker order, payment, or paid provider request was made.
- Targeted backend tests for Kite position rows, journal snapshots, trade ledger, charges, and account equity passed **104 tests**.
- Ten standalone frontend Positions helper tests passed.
- The complete frontend Jest suite passed **47 suites / 204 tests**.
- The production frontend build completed successfully.
- `git diff --check` passed.
- No broker order, manual Kite refresh, journal write, settings/credential change, deployment, or request to the configured Mongo database was performed.

## Findings

### POS-01 — Net/day realised P&L precedence

- **Severity:** Medium
- **Status:** Fixed in the local worktree; deployment and live behavior not verified
- **Confidence:** 9/10
- **Impact:** The former magnitude-based merge could replace the net-row realised value with a larger day-row value, changing the booked value carried into Positions and the journal.
- **Evidence:** [`merge_kite_net_day`](../../backend/kite_positions.py#L17) now preserves the net row’s `realised` field whenever present, including zero, and falls back to day only when the net field is absent. The regression case and zero/missing-field assertions are in [`test_net_realised_wins_over_larger_day_realised_for_partial_position`](../../backend/tests/test_kite_positions.py#L77).
- **Validation:** Focused backend test run passed; full backend suite also ran, with one unrelated Global Markets test failure listed below. No live Kite payload was read, so this confirms the code path with fixtures, not the original account response.

### POS-02 — “After charges” tile can fall back to gross booked P&L

- **Severity:** Medium
- **Status:** Open; source-confirmed, not runtime-reproduced
- **Confidence:** 9/10
- **Impact:** When the current journal document has no saved charge total, the Positions response calls `pnl_after_charges` with the gross booked amount and an empty journal projection. The helper returns that gross amount if charges are absent. The Positions tile uses that response value and labels the result as after brokerage and taxes. The live `/positions/brokerage-day` fetch updates the separate charge breakdown state; the tile does not apply that response to its displayed value. This can temporarily overstate the after-charge figure or leave it gross when charges remain unavailable.
- **Evidence:** [`get_positions`](../../backend/server.py#L5831) reads saved journal charge fields and calculates the after-charge value; [`pnl_after_charges`](../../backend/account_equity.py#L182) falls back to booked P&L when no charge total exists. [`PositionsPanel`](../../frontend/src/components/PositionsPanel.jsx#L2100) displays `pnl_today.booked_after_charges` or falls back to `stats.bookedToday`; its independent live charge request is at [`loadBrokerage`](../../frontend/src/components/PositionsPanel.jsx#L733).
- **Validation:** Source trace only. Existing helper tests cover charge arithmetic, but no live route/UI test exercised a first-of-day or unavailable-charge response. No fix was made during this audit.
- **Follow-up:** In a separately approved change, make the tile distinguish “charges pending/unavailable” from a verified after-charge value, or ensure the live charge result is applied consistently before presenting that value as net.

## Automated validation

| Check | Result |
|---|---|
| Focused backend: `python -m pytest -q -n 0 -p no:cacheprovider tests\test_kite_positions.py tests\test_trade_journal.py tests\test_trade_ledger.py tests\test_kite_charges.py tests\test_account_equity.py` | **104 passed**, 4 deprecation warnings |
| Full backend: `python -m pytest tests -q -n 0 -p no:cacheprovider` | **540 passed, 1 failed**, 5 warnings |
| Full frontend Jest: `npm run test:jest -- --no-cache` | **47 suites passed; 204 tests passed** |
| Standalone frontend Positions helper tests | **10 passed; 0 failed** |
| Frontend lint: `npm run lint -- --no-cache` | **Failed:** `src/pages/Landing.jsx:481`, `brokerSafeText` is not defined. This is outside the Positions scope and that file was not changed during this audit. |
| Frontend production build: `npm run build` | **Passed** |
| `git diff --check` | **Passed** |

The single full-backend failure was `tests/test_global_markets.py::test_global_market_session_gates_closed_venues`: the test expected `CLOSED`, while `normalize(..., None)` returned `UNKNOWN`. This is outside the Positions path; it was not changed or fixed as part of this audit.

## Data and integration boundary

- The configured database (`oi_pulse`) uses a non-loopback Mongo host and was not contacted. The app used a separate uniquely named loopback audit database, which was dropped after the smoke test.
- Backend port 8000 was bound to `127.0.0.1`; frontend port 3000 was rebound to `localhost`/`::1` after an initial all-interface CRA bind. Both app processes were stopped after testing.
- The local-only admin bypass was enabled in the backend process environment with `APP_ENV=development`; no environment file was changed. The Kite API key/access-token environment variables were blanked for the backend process, and the isolated database had no broker credential record.
- Local `/ready`, `/api/version`, `/api/status`, `/api/auth/state`, `/api/config`, `/api/positions`, `/api/positions/brokerage-day`, `/api/journal`, and dashboard data routes were exercised. Health/auth/config and disconnected positions/charges/journal routes returned HTTP 200. OI snapshot/change routes returned HTTP 503 because the isolated database had no OI snapshots and no Kite feed; this is an expected no-data state, not a live-feed pass.
- The browser initially opened at `127.0.0.1:3000`, which did not match the configured `localhost:3000` CORS origin. Navigating to the configured localhost origin resolved the CORS errors. No persistent application issue was found from that harness mismatch.
- Kite connection/session state was not observed. Browser logs included expected OI-unavailable 503s and a spot-WebSocket close warning during page transitions; backend logs confirm that the endpoint accepted and opened repeated connections, so no persistent handshake failure was found. No live spot payload was available to validate. The initial `127.0.0.1` page also emitted a frontend dev-server `/ws` warning; the app UI and API worked at the configured `localhost` origin. A responsive-panel advisory warning was also present.
- No account, journal, position, or P&L records were read or included. No raw Kite response or private broker data was requested.
- Existing modified worktree files were preserved; this audit changed no product code and did not commit, deploy, reset, or revert anything.

## Coverage matrix

| Path | Coverage | Result |
|---|---|---|
| Kite `net` / `day` merge and net-zero precedence | Deterministic backend regression tests | Passed |
| Exits, partial closes, open MTM separation, expiry settlement | Backend unit tests | Passed |
| Journal snapshot, same-day reconciliation, and charge arithmetic | Backend unit tests | Passed |
| Positions helper logic (polling, layout, risk, payoff, heatmap, and related helpers) | Ten standalone frontend tests | Passed |
| Positions panel charge-display state and rendered tile | Source inspection and full Jest suite; no dedicated panel integration test found | Partially tested |
| Authenticated `/positions` disconnected response | Local API with loopback-only development admin bypass | Passed; live book unavailable by design |
| `/positions/brokerage-day` against Kite virtual contract note | Route disconnected state plus charge builder/aggregation unit tests | Not tested live |
| Journal Mongo route and UI | GET against fresh isolated audit DB; journal dialog opened | Passed for empty state; no P&L persisted |
| Dashboard read-only API routes | Local GET smoke checks | Passed except expected OI 503s without snapshots |
| Desktop Positions rendering | Browser at 1440px | Passed; no horizontal document overflow |
| Phone Positions rendering | Browser at 390px | Passed; no horizontal document overflow |
| Browser loading/error states | Offline feed state and missing OI snapshot | Expected disconnected/no-data state shown; websocket lifecycle warning classified from backend logs |

## Follow-up

1. Review and approve a focused fix for POS-02 before changing the Positions P&L display.
2. To validate actual account Positions, the owner can connect Kite in their own local app session; do not share API keys, access tokens, or account payloads with the audit.
3. Rerun the unrelated Global Markets test investigation and fix the unrelated Landing lint error separately.
4. After the approved P&L fix is deployed, validate it with sanitized Kite `net` / `day` rows and a same-session charges response; no live account data was available in this audit.

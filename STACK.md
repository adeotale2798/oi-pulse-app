# StrikLenz technology stack

This file records the stack present in this repository. Dependency versions
below are the versions declared in the manifests, not a claim that every
external service is available in every environment. The source of truth for
the dependency lists is the linked manifest or lockfile.

Admins can view a concise technology overview in **Admin → API Config & Stack
→ Tech Stack**. It explains the app layers and their roles in plain language.
The adjacent **API Configuration** tile opens the existing integration and
telemetry view.


UI / frontend: React 19, written in JavaScript and JSX. It uses Create React App, customized with CRACO, and Tailwind CSS for styling. UI components use Radix; charts use Recharts.
Backend / API: Python with FastAPI, served by Uvicorn.
Database: MongoDB, accessed asynchronously with Motor.


## At a glance

| Area | Stack |
| --- | --- |
| Product | StrikLenz, an Indian-market open-interest desk for NIFTY, SENSEX, and BANKNIFTY |
| Frontend | JavaScript and JSX, React 19, React Router 7, Create React App 5 customized with CRACO 7 |
| Backend | Python 3.11+, FastAPI, Pydantic 2, Starlette, Uvicorn (ASGI) |
| Database | MongoDB 6+; asynchronous access through Motor, with PyMongo driver utilities |
| Broker and live market data | Broker REST API and WebSocket integration |
| Frontend styling and UI | Tailwind CSS 3, PostCSS, Radix UI primitives, reusable local UI components |
| Charts | Recharts 3 |
| Frontend package manager | Yarn Classic 1.x; exact lockfile package-manager version is Yarn 1.22.22 |
| Backend dependency installation | pip from `backend/requirements.txt`; there is no Python lockfile |
| Tests and lint | pytest; CRA/Jest; ESLint |

## Runtime and version requirements

The local setup guide specifies Python 3.11 or newer, Node.js 18 or newer,
Yarn 1.x, and MongoDB 6 or newer (local MongoDB or a MongoDB Atlas URI).
Frontend package versions are pinned in `frontend/package.json` and resolved
by `frontend/yarn.lock`. Backend dependencies are declared in
`backend/requirements.txt` with exact pins or version ranges.

The repository does not declare a single exact Python or Node.js runtime
version. Select those using the minimums above and the target hosting
environment. MongoDB is an external service; its server version is not pinned
by an application dependency manifest.

## Application architecture

```text
Browser
  React single-page app (built with CRACO / CRA)
      └── HTTP JSON API requests (Axios) ──► FastAPI / Uvicorn
                                               ├── MongoDB (Motor / PyMongo)
                                               ├── Broker API
                                               └── configured external data,
                                                   AI, and notification APIs
```

- **Frontend:** `frontend/src` contains the React app, pages, components,
  hooks, API/client libraries, and browser-facing tests. The app is JavaScript
  and JSX; no TypeScript compiler or TypeScript source tree is declared.
- **Backend:** `backend/server.py` is the FastAPI application entry point.
  Backend modules provide API routes, market-data services, persistence,
  access control, journals, and trading-desk features.
- **Persistence:** MongoDB stores the app's market snapshots, settings,
  sessions, journals, and other application records. `MONGO_URL` configures
  the connection. Motor is used for asynchronous Mongo access; PyMongo is
  also declared and supplies driver utilities and error types.
- **Broker data:** the publisher's broker credentials power publisher-owned
  OI/charts; guest books use each guest's own broker login. A broker WebSocket
  stream is used by the CAS automation code.
- **API boundary:** the browser calls the backend over HTTP/JSON, usually at
  `/api` or the configured `REACT_APP_BACKEND_URL`. The backend also makes
  outbound HTTP requests to configured providers.

## Backend dependencies

Declared in [`backend/requirements.txt`](backend/requirements.txt):

| Purpose | Direct dependencies (declared versions) |
| --- | --- |
| API / ASGI | `fastapi==0.141.1`, `uvicorn==0.25.0`, `starlette==0.49.1`, `pydantic>=2.5.0,<3`, `python-multipart==0.0.32`, `python-dotenv==1.2.2` |
| MongoDB | `motor==3.7.1`, `pymongo==4.18.1` |
| HTTP clients | `httpx==0.28.1`, `requests==2.34.2` |
| Secrets / credentials | `cryptography>=42.0.0` (Fernet-based vault encryption) |
| Broker / streaming | Broker SDK (version 5.2.0; package name omitted), `twisted==26.4.0`, `autobahn[twisted]==19.11.2`, `pyOpenSSL==26.4.0`, `service_identity==26.1.0` |
| Market data / analysis | `yfinance>=0.2.40`, `pandas>=2.2.0,<3`, `numpy>=1.26.0` |
| Files, dates, and time zones | `openpyxl==3.1.5`, `python-dateutil>=2.9.0`, `pytz` (unversioned), `tzdata>=2024.1` |

The backend requirements file is intentionally runtime-only. Its comments
specify that pytest and other test tooling are installed separately rather
than included in the runtime image.

### CAS rule-expiry automation

`backend/cas_rule_expiry_automation/requirements.txt` describes the
automation's standalone environment: Flask (`>=3.0`), Waitress (`>=3.0`),
`six` (`>=1.11.0`), Requests (`>=2.18.4`), `python-dateutil` (`>=2.6.1`),
pyOpenSSL (`>=17.5.0`), service-identity (`>=18.1.0`), Autobahn with Twisted
(`==19.11.2`), Twisted (`>=22.0.0`), and conditional `pywin32` (`>=227`) on
Windows. When run as part of this repository, its README directs operators to
install the main backend requirements instead.

## Frontend dependencies

Declared in [`frontend/package.json`](frontend/package.json), with the full
resolved dependency graph in [`frontend/yarn.lock`](frontend/yarn.lock):

| Purpose | Direct dependencies |
| --- | --- |
| UI framework / routing | `react==19.0.0`, `react-dom==19.0.0`, `react-router-dom==7.18.2`, `react-scripts==5.0.1`, `cra-template==1.2.0` |
| API / server state | `axios==1.18.0`, `@tanstack/react-query==5.56.2`, `swr==2.3.8` |
| Forms / validation | `react-hook-form==7.56.2`, `@hookform/resolvers==5.0.1`, `zod==3.24.4`, `input-otp==1.4.2` |
| Components / interaction | Radix UI React primitives (`@radix-ui/react-*`), `cmdk==1.1.1`, `embla-carousel-react==8.6.0`, `react-day-picker==8.10.1`, `react-resizable-panels==3.0.1`, `vaul==1.1.2` |
| Styling helpers / themes | `tailwind-merge==3.2.0`, `tailwindcss-animate==1.0.7`, `next-themes==0.4.6`, `class-variance-authority==0.7.1`, `clsx==2.1.1` |
| Charts / visuals | `recharts==3.6.0`, `framer-motion==11.18.0`, `lucide-react==0.516.0` |
| Dates / utilities / feedback | `date-fns==4.1.0`, `dayjs==1.11.13`, `lodash==4.18.1`, `sonner==2.0.3` |

Radix UI primitives are direct dependencies at these declared versions:

| Package | Version | Package | Version |
| --- | --- | --- | --- |
| `@radix-ui/react-accordion` | 1.2.8 | `@radix-ui/react-alert-dialog` | 1.1.11 |
| `@radix-ui/react-aspect-ratio` | 1.1.4 | `@radix-ui/react-avatar` | 1.1.7 |
| `@radix-ui/react-checkbox` | 1.2.3 | `@radix-ui/react-collapsible` | 1.1.8 |
| `@radix-ui/react-context-menu` | 2.2.12 | `@radix-ui/react-dialog` | 1.1.11 |
| `@radix-ui/react-dropdown-menu` | 2.1.12 | `@radix-ui/react-hover-card` | 1.1.11 |
| `@radix-ui/react-label` | 2.1.4 | `@radix-ui/react-menubar` | 1.1.12 |
| `@radix-ui/react-navigation-menu` | 1.2.10 | `@radix-ui/react-popover` | 1.1.11 |
| `@radix-ui/react-progress` | 1.1.4 | `@radix-ui/react-radio-group` | 1.3.4 |
| `@radix-ui/react-scroll-area` | 1.2.6 | `@radix-ui/react-select` | 2.2.2 |
| `@radix-ui/react-separator` | 1.1.9 | `@radix-ui/react-slider` | 1.3.2 |
| `@radix-ui/react-slot` | 1.2.0 | `@radix-ui/react-switch` | 1.2.2 |
| `@radix-ui/react-tabs` | 1.1.9 | `@radix-ui/react-toast` | 1.2.11 |
| `@radix-ui/react-toggle` | 1.1.6 | `@radix-ui/react-toggle-group` | 1.1.7 |
| `@radix-ui/react-tooltip` | 1.2.4 | | |

### Frontend build and quality tooling

- **Build/dev server:** CRA through CRACO (`yarn start`, `yarn build`).
- **CSS:** `tailwindcss==3.4.17`, `postcss==8.5.23`, and
  `autoprefixer==10.4.20`.
- **Build/lint dev dependencies:** `@babel/plugin-proposal-private-property-in-object==7.21.11`,
  `@craco/craco==7.1.0`, `@eslint/js==9.23.0`, `@types/lodash==4.17.24`,
  `dotenv==16.4.5`, `eslint==9.23.0`, `eslint-plugin-import==2.31.0`,
  `eslint-plugin-jsx-a11y==6.10.2`, `eslint-plugin-react==7.37.4`,
  `eslint-plugin-react-hooks==5.2.0`, and `globals==15.15.0`. Tailwind,
  PostCSS, and Autoprefixer are also development dependencies.
- **Lint:** ESLint 9.23.0 with import, JSX accessibility, React, and React
  Hooks plugins (`yarn lint`).
- **Tests:** CRA/Jest (`yarn test` or
  `yarn test:jest --watchAll=false --runInBand`).
- **Package management:** Yarn Classic; `package.json` also defines Yarn
  resolutions for selected transitive dependencies.

## External services and integrations

These are integrations used by application code, not packages bundled as
services by this repository:

- **Broker API:** login, market quotes/OI, and account book access, with a
  WebSocket market-data stream.
- **MongoDB:** required application database, configured with `MONGO_URL`;
  deployment may use the hosting platform's MongoDB or an external MongoDB
  service such as Atlas.
- **Twelve Data:** provider for ADR and global-market data; API credentials are
  optional and managed server-side.
- **Yahoo Finance:** accessed via `yfinance` for GIFT/VIX-related market data.
- **Telegram Bot API:** optional configured alert/notification delivery.
- **OpenAI-compatible API:** optional desk AI integration, configurable with a
  provider/base URL and model. The documented default is `gpt-4o-mini`; an API
  key is configured on the backend, not in the browser.
- **Exchange / market endpoints:** backend services also make HTTP requests
  for exchange calendar, market reference, and event data.

Configuration examples are in `backend/.env.example` and
`frontend/.env.example`. They describe variable names and defaults; do not put
real credentials in this file or commit environment files.

## Testing and repository tooling

- Backend tests live in `backend/tests` and use pytest. Additional
  repository-level Python regression tests are present at the root.
- Frontend tests live alongside the source as `.spec.js` and `.test.js` files
  and run through CRA/Jest.
- `backend/pytest.ini` configures pytest. Frontend build, test, and lint
  commands are declared in `frontend/package.json`.
- `.emergent/emergent.yml` records an Emergent base-image reference, and
  `.emergent/` contains cron-related helper scripts. The hosting guide
  describes the current Emergent Kubernetes/Mongo hosting and a possible
  Linux VM + MongoDB Atlas + Caddy alternative.
- No Dockerfile, Docker Compose file, Kubernetes manifests, Python lockfile,
  or checked-in CI workflow is present in the application repository. The
  Emergent metadata is not a replacement for those general-purpose
  deployment manifests.

## Key stack references

- Product overview and workflow: [`README.md`](README.md)
- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Local prerequisites and commands: [`docs/LOCAL_SETUP.md`](docs/LOCAL_SETUP.md)
- Hosting options: [`docs/HOSTING.md`](docs/HOSTING.md)
- API and authentication: [`docs/ABOUT.md`](docs/ABOUT.md)
- Data model and polling: [`docs/DATA.md`](docs/DATA.md)
- AI integration: [`docs/AI.md`](docs/AI.md)
- Broker automation: [`docs/CAS_AUTO_TRADE_15_20.md`](docs/CAS_AUTO_TRADE_15_20.md)
- Dependency manifests: [`backend/requirements.txt`](backend/requirements.txt),
  [`frontend/package.json`](frontend/package.json), and
  [`frontend/yarn.lock`](frontend/yarn.lock)

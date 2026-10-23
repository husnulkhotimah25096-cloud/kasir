# AGENTS — rms-dashboard

## Monorepo Structure

Three npm workspaces under `packages/`:
- **`packages/api/`** — Express server (`server.mjs`), Prisma ORM, MySQL
- **`packages/web/`** — Vanilla JS SPA, served by `lite-server`, no build step
- **`packages/shared/`** — Shared Zod schemas/types

## Setup & Dev

| Command | Description |
|---|---|
| `npm run setup` | Starts `lite-server` (web only) |
| `npm run dev` | **Starts both API + web**: `concurrently "cd packages/api && npm run start" "cd packages/web && npm run start"` |
| `npm run db:generate` | `prisma generate` (inside `packages/api`) |
| `npm run db:migrate` | `prisma migrate deploy` (inside `packages/api`) |
| `npm run db:reset` | `prisma migrate reset` (inside `packages/api`) |

**Environment**: `packages/api` uses `dotenv` — create `.env` at root with `DATABASE_URL`. The API base URL defaults to `http://localhost:8000/api/v1` and can be overridden via `RMS_CONFIG.apiBase`.

## API Server

- Entrypoint: `packages/api/server.mjs`
- Runs via `node --experimental-json-modules server.mjs`
- JWT auth: token stored in `localStorage.rms_token` (set by `utils/api.js` `setAuthToken`)
- All API calls go through `utils/api.js` — it injects the `Authorization: Bearer <token>` header automatically
- Health check: `GET /api/v1/health`

## Web (Frontend)

- Served by `lite-server` at `http://localhost:3000` (default)
- **No build step** — `npm run build` just echoes "Vanilla JS - no build step"
- ES modules throughout (`"type": "module"` in all package `package.json` files)
- `scripts/app.js` is the root router / startup file
- Offline mode: when offline, POS transactions are queued in IndexedDB via `idb.js`; sync via `POST /sales/sync-batch` when back online
- Theme toggle (light/dark) persisted to `indexedDB` via `utils/idb.js`
- WebSocket: `ws://localhost:8000` (configurable via `RMS_CONFIG.wsUrl`)

## Testing

- Smoke test only: `tests/smoke.mjs` — uses JSDOM, mocks the API contract, tests the rendered frontend
- To run: `node tests/smoke.mjs` (requires JSDOM, `fake-indexeddb/auto`, and `chart.js` globals)
- The test mocks `fetch` at `/api/v1/*` endpoints and checks UI rendering, POS flow, inventory opname logic, finance/journal, procurement, event logs, and RBAC
- **Do not** rely on an actual running API — the smoke test uses a fully mock database

## Prisma

- Schema: `prisma/schema.prisma` — 60+ models (Store, User, Product, Category, Order, Payment, Inventory, Stock Transfer, Opname, Bookkeeping, Analytics)
- After changing schema: run `npm run db:generate` then `npm run db:migrate`
- Generates `node_modules/.prisma/client/` — used by `packages/api` via `@prisma/client`

## Key Conventions & Quirks

- **All packages are `"type": "module"`** — import paths use `.js` extensions, no `.js` extension errors
- **`scripts/app.js` exposes functions to `window`** at bottom via `Object.assign(window, {...})` — UI buttons use `onclick="..."` in HTML
- **Offline-first pattern**: POS queues sales in IndexedDB when network fails; syncs on reconnect via `syncOfflineQueue()`
- **Debounce pattern**: `utils/idb.js` exports a debounce used by search (`250ms`) and period filter (`300ms`)
- **deviation function**: `scripts/modules/inventory.js` exports `opnameDeviation(physical, system)` → `{ action: 'none' | 'auto-adjust' | 'approval', percent: number }`
- **Defer API calls on tab switch**: `TAB_LOADERS` in `app.js` — only the active tab fetches data; event logs stop polling when leaving
- **RBAC**: `utils/auth.js` exports `hasRole(...roles)` — checked before POS transactions and page access (kasir role restricted)
- **Lint**: `npm run lint` in each package is a placeholder echo — actual lint rules are informal/none currently
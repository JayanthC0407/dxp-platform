# Demo Bank DXP platform (POC)

Fork of the DXP prototype backend and console, changed to the
`CONTRACT-OBDX.md` contract (`obdx-1`, in the Demo Bank app repo under
`docs/dxp/`). What changed from the prototype:

| Area | Change |
|---|---|
| App login | `POST /api/app/v1/auth/login` removed. The app opens a platform session with `POST /api/app/v1/session` after its OBDX login (header `X-DXP-App-Key`, body: userType, segment, opaque userRef). Retail only |
| Customer data | None. `/data/{source}` and server-side journey tasks are gone from the App API. The app resolves data from OBDX |
| `nativeRoute` | Checked at publish against the app's route table (`src/validate.js`, `NATIVE_ROUTES`) |
| Seed | Demo Bank screens: `home` (the whole Retail Home body, `layout: full`, starting as today's Home), `offers`, `my_money`; menu entries Offers and My money |
| `AppWidget` | New palette entry: places one of the app's own Home widgets by name (`APP_WIDGETS` in `src/seed.js`, checked at publish) |
| Studio preview | `public/app` is the Demo Bank app's own preview build (`scripts/build_dxp_preview.sh` in the app repo); the prototype's is in `public/app_prototype` |
| CORS | Allows `If-None-Match` and `X-DXP-App-Key`; exposes `ETag` |

The console, releases (maker-checker, rollback), SSE and events are unchanged.
The console preview still uses the prototype's mock customers as **sample
data**.

## Run

```bash
cd backend
npm start -- --reset        # http://localhost:8090, console at /console/
```

Staff logins (dev only): `maker / maker123`, `checker / checker123`,
`admin / admin123`. Set `DXP_APP_KEY` (default `demo-bank-dev-key` in dev) and
`DXP_TOKEN_SECRET` outside dev.

---

# DXP — Digital Experience Platform for banking (reference prototype)

A working reference build of the framework described in the blueprint doc *"Digital Banking App Framework — Architecture Blueprint"*:

| Part | Folder | What it proves |
|---|---|---|
| Backend (Node 18+, Express) | `backend/src` | App API, Console API, server-driven UI resolver (segments, entitlements, visibility), maker-checker releases with rollback, live channel (SSE), journey engine + transaction gateway (limits, idempotency, anti-skip), event store, Customer 360, hash-chained audit, mock core-banking adapter |
| Back-office console | `backend/public/console` | Visual screen builder (palette, live phone preview, property panel, outline), journey storyboard, theme editor, segment/menu assignment, widget registry, releases (submit / approve / reject / rollback), entitlements & limits, customers + 360, staff & audit |
| Device simulator | `backend/public/simulator` | Browser build of the runtime contract — demonstrates live updates without a reload |
| Flutter runtime | `flutter_app` | The mobile runtime: login, manifest, renderer + widget catalogue, action engine, journeys, SSE live updates, event batching. Structured to drop into the existing Banking Flutter App (`lib/src/sdui/…`) |
| Contract | `CONTRACT.md` | The single source of truth all runtimes implement |

## Run it (2 minutes)

```bash
cd backend
npm install
npm start            # http://localhost:8090   (add --reset to restore seed data)
npm test             # in a second terminal: 22-step end-to-end smoke test
```

* Console: http://localhost:8090/console/ — `maker / maker123` (designer + maker), `checker / checker123` (approver), `admin / admin123`
* Simulator: http://localhost:8090/simulator/ — customers `aisha` (Retail), `omar` (Premier), `lina` (Youth), password `1234`

### The 60-second demo
1. Open the simulator, log in as `aisha`.
2. In the console (as `maker`): **Screens → home → Open builder**, click **Banner** in the palette, edit its text, **Save draft**. Optionally recolour **Branding & themes → default**.
3. **Releases → Submit for approval**.
4. Sign in as `checker` (another browser/incognito) → **Releases → Approve & publish**.
5. The simulator recolours and shows the new banner within ~2 s — no rebuild, no store release, no reload.
6. Run a transfer in the simulator, then open **Customers & 360 → Aisha** to see the transaction and the full event timeline.
7. **Releases → Roll back to this** on release 1 restores the previous experience the same way.

## Containers and Kubernetes
| File | What it is |
|---|---|
| `backend/Dockerfile` | Multi-stage build to a distroless, non-root Node 22 image |
| `deploy/docker-compose.yml` | Local container run: read-only root FS, all capabilities dropped, data volume |
| `deploy/k8s/00-namespace.yaml` … `20-app.yaml` | Namespace with the `restricted` Pod Security profile, ServiceAccount, PVC, Deployment with startup/liveness/readiness probes on `/health/live` and `/health/ready`, Service, default-deny NetworkPolicies, internet App API ingress (SSE-friendly) and a separate intranet-only console ingress |
| `deploy/k8s/10-secret.yaml` | ExternalSecret (Vault) pattern for `DXP_TOKEN_SECRET` |
| `deploy/k8s/30-production-pattern.yaml` | Production shape per stateless service: 3+ replicas, zone spread, PDB, HPA |

The reference build runs as **one replica** (JSON-file store, in-process SSE fan-out). Production services keep no local state (PostgreSQL + Redis pub/sub), which is what allows the multi-replica, two-site HA design in blueprint §13.2. The server handles SIGTERM gracefully (readiness fails, connections drain, SSE clients reconnect) and sets baseline security headers; `DXP_TOKEN_SECRET` is mandatory when `NODE_ENV=production`.

## Flutter app
See `flutter_app/README.md`. Point it at the backend with `--dart-define=DXP_BASE_URL=http://10.0.2.2:8090 --dart-define=APP_ENV=dev` (Android emulator). The Flutter code was written without an SDK available in the build environment, so run `flutter pub get && flutter analyze` first and fix any minor analyzer findings.

## What is mocked vs production
| Prototype | Production (blueprint §9, §12, §13) |
|---|---|
| JSON file store | PostgreSQL + Redis + Kafka + ClickHouse |
| Mock core adapter | Core banking, payments, cards and CRM adapters — through the bank's ESB or point to point (DXP replaces OBDX) |
| HMAC tokens, scrypt passwords | Bank IAM / OIDC for staff, device-bound keys + MFA for customers, HSM-signed config |
| SSE only | SSE + silent push (FCM/APNs) + CDN for config documents |
| Entitlement edits apply directly (audited) | Entitlement changes through maker-checker |

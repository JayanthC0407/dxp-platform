# DXP Server-Driven UI Contract (prototype v1)

This is the contract between the DXP backend and any runtime (Flutter app, web simulator, console preview).
All runtimes MUST implement exactly this. Base URL default: `http://localhost:8090`.

## 1. App API — prefix `/api/app/v1`

All responses are JSON. Errors: `{ "error": { "code": "STRING", "message": "Human text" } }` with HTTP 4xx/5xx.
Authenticated calls send `Authorization: Bearer <accessToken>`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{username, password, deviceId, platform, runtime, widgets:[ "Column@1", ... ]}` | `{accessToken, customer:{id, name, firstName, segment}}` |
| POST | `/auth/logout` | – | `{ok:true}` |
| GET | `/manifest` | – | Manifest (2) |
| GET | `/screens/{id}` | – | Screen (3) |
| GET | `/journeys/{id}` | – | Journey (5) |
| GET | `/data/{source}` | – | data (see 6) |
| POST | `/journeys/{id}/instances` | `{}` | `{instanceId, journey, step, state:{}}` |
| POST | `/journeys/instances/{instanceId}/tasks/{task}` | `{state:{...}, idempotencyKey}` | ok: `{ok:true, data:{...}, state:{...}, next:"stepName"}` / fail: `{ok:false, error:{code,message}, state:{...}, next:"stepName"}` (HTTP 200 in both cases) |
| POST | `/events` | `{events:[Event]}` | `{accepted:n}` |
| GET | `/live?token=<accessToken>` | – | Server-Sent Events stream (7) |

## 2. Manifest

```json
{
  "configVersion": 3,
  "releaseNo": 3,
  "segment": "PREMIER",
  "theme": {
    "id": "premier", "version": 1, "brandName": "Bank One Premier",
    "colors": { "primary": "#8A6D1F", "onPrimary": "#FFFFFF", "secondary": "#1B1B1B",
                "background": "#F7F4EC", "surface": "#FFFFFF", "onSurface": "#1B1B1B",
                "muted": "#6B6B6B", "success": "#1E8E3E", "danger": "#C62828" },
    "radius": 16, "fontFamily": "Roboto"
  },
  "home": "home",
  "menu": [ { "label": "Home", "icon": "home", "action": { "type": "navigate", "screen": "home" } } ],
  "screens":  { "home": "sha256:ab12...", "accounts": "sha256:..." },
  "journeys": { "transfer": "sha256:..." },
  "entitlements": ["TXN.TRANSFER.OWN", "CARD.FREEZE"]
}
```
Runtimes cache screens/journeys by hash and refetch only when the hash changes. `menu` is shown as a bottom navigation bar (2–5 items).

## 3. Screen

```json
{
  "id": "home", "version": 2, "title": "Home",
  "data": { "accounts": { "source": "accounts.list" }, "txns": { "source": "txn.history" } },
  "root": { "type": "Column", "props": { "padding": 16, "gap": 12, "scroll": true }, "children": [ Node, ... ] }
}
```
The server has already removed nodes the customer may not see (`visibleIf` by entitlement / segment).
Optional `"sensitive": true` on a screen → the runtime wraps it in the host app's screen-capture protection.

### Node
```json
{ "type": "Button", "props": { "label": "Transfer", "variant": "primary" },
  "bind": { "items": "accounts" },
  "on": { "tap": Action } ,
  "children": [ Node ] }
```
* `props`: static values. Any **string** prop may contain `{{path}}` placeholders, interpolated against the render context.
* `bind`: map of prop name → context path; the resolved value REPLACES the prop (used for arrays/objects, e.g. `items`).
* `on`: event name (`tap`) → Action.
* Unknown `type` → render a small grey placeholder box `Unsupported: <type>` and post an `ERROR` event. Never crash.

### Render context (paths are dot-separated, e.g. `customer.firstName`, `state.amount`, `item.balance`)
* `customer` — always present: the `customer.profile` data source.
* one key per `data` alias of the screen (e.g. `accounts`, `txns`), loaded via `GET /data/{source}` before render.
* `state` — the current journey state object (empty object outside journeys). Also contains task results merged in.
* `item` — inside list widgets, the current element.
* `theme` — the manifest theme.
A missing path renders as empty string.

### Formatting in placeholders
`{{path|money}}` formats a number with 3 decimals and thousands separators (e.g. `1,250.500`). `{{path|date}}` shows the ISO date part `YYYY-MM-DD`. No other filters.

## 4. Widget catalogue (type@major = 1 for all)

| type | props | children | events |
|---|---|---|---|
| `Column` | `padding` (num), `gap` (num), `scroll` (bool), `align` (`start`/`center`/`stretch`, default stretch) | yes | – |
| `Row` | `gap`, `align` (`start`/`center`/`spaceBetween`) | yes | – |
| `Card` | `padding` (default 16), `tone` (`surface`/`primary`) — primary = primary bg + onPrimary text | yes | `tap` |
| `Text` | `text`, `style` (`headline`/`title`/`body`/`caption`/`muted`), `align` (`start`/`center`/`end`) | – | – |
| `Button` | `label`, `variant` (`primary`/`secondary`/`text`), `icon` | – | `tap` |
| `Banner` | `title`, `text`, `tone` (`info`/`promo`/`warning`), `icon` | – | `tap` |
| `BalanceCard` | `title`, `amount` (num or placeholder string), `currency`, `subtitle` | – | `tap` |
| `AccountList` | `items` (array of account) | – | `tap` (context `item`) |
| `TxnList` | `items` (array of txn), `limit` (num) | – | – |
| `QuickActions` | `items`: `[{label, icon, action}]` — grid of icon tiles, each tile runs its own `action` | – | – |
| `TextField` | `label`, `field` (state key), `placeholder`, `keyboard` (`text`/`number`) | – | – |
| `AmountField` | `label`, `field`, `currency` | – | – |
| `SelectList` | `label`, `field` (state key), `items` (array), `labelKey`, `subtitleKey`, `valueKey` — tap selects: sets `state[field] = item[valueKey]` and `state[field + "Label"] = item[labelKey]` | – | `tap` after select |
| `OtpInput` | `field`, `length` (default 6) | – | – |
| `ReviewSummary` | `rows`: `[{label, value}]` (values may contain placeholders) | – | – |
| `ResultPanel` | `status` (`success`/`failure`), `title`, `message` | – | – |
| `Divider` | – | – | – |
| `Spacer` | `size` (default 16) | – | – |

Account object: `{id, name, number, type, balance, currency}`. Txn object: `{id, date, description, amount, currency, status}` (amount negative = debit).
Icons (string names): `home, send, swap, card, receipt, wallet, user, logout, bolt, gift, info, lock, chart, phone, star`. Unknown → `info`.

Input widgets write to `state[field]` on every change (numbers parsed for `AmountField` / `keyboard:number`).

## 5. Journey

```json
{
  "id": "transfer", "version": 1, "title": "Transfer money", "entitlement": "TXN.TRANSFER.OWN",
  "start": "from",
  "steps": {
    "from":     { "screen": "transfer_from",   "next": "amount" },
    "amount":   { "screen": "transfer_amount", "next": "validate" },
    "validate": { "task": "transfer.validate", "onSuccess": "review", "onError": "amount" },
    "review":   { "screen": "transfer_review", "next": "submit" },
    "submit":   { "task": "transfer.submit",   "onSuccess": "done", "onError": "failed" },
    "done":     { "screen": "transfer_result", "terminal": true },
    "failed":   { "screen": "transfer_failed", "terminal": true }
  }
}
```
Runtime algorithm:
1. `startJourney` → `GET /journeys/{id}` (or cache), `POST /journeys/{id}/instances` → `instanceId`, state `{}`; go to `start`.
2. Screen step: render its screen with context `state`. Action `next` → go to `step.next`.
3. Task step: `POST /journeys/instances/{iid}/tasks/{task}` with `{state, idempotencyKey}` (idempotencyKey = `iid + ":" + stepName`). Replace local state with response `state`, go to response `next`. If `ok:false`, show `error.message` as a toast/snackbar on the step it goes to.
4. Terminal step screen: the `finish` action (or back) ends the journey and returns to home.
5. Journey screens show a back arrow (→ previous screen step) and a close (→ `cancelJourney`).

## 6. Data sources (`GET /data/{source}`)
* `customer.profile` → `{id, name, firstName, segment, email, mobile, rm}`
* `accounts.list` → `[account]`
* `txn.history` → `[txn]` newest first
* `payees.list` → `[{id, name, account, bank}]`
* `cards.list` → `[{id, name, number, status, limit, currency}]`

## 7. Actions (closed set)

| type | fields | effect |
|---|---|---|
| `navigate` | `screen` | push screen |
| `back` | – | pop (in journey: previous step) |
| `startJourney` | `journey` | start journey |
| `next` | – | advance journey (5) |
| `finish` | – | end journey → home |
| `cancelJourney` | – | abandon journey → home (post `JOURNEY_ABANDONED`) |
| `setState` | `key`, `value` | `state[key] = value` (value placeholders interpolated) |
| `refresh` | – | reload screen data |
| `openUrl` | `url` | open external URL (only `https://`) |
| `toast` | `message` | show snackbar |
| `logout` | – | `POST /auth/logout`, go to login |
| `nativeRoute` | `route`, `args` | hand off to an existing hand-coded screen of the host app (`Navigator.pushNamed`) — hybrid adoption |

## 8. Live updates (SSE)
`GET /api/app/v1/live?token=...` → `text/event-stream`. Messages:
```
event: hello
data: {"configVersion":3}

event: config.published
data: {"configVersion":4,"releaseNo":4}

event: session.revoked
data: {}
```
Comment lines `: ping` arrive every 20 s. On `config.published` (or a `hello` with a higher configVersion than the cached one) the runtime refetches `/manifest`, applies the new theme immediately, refetches changed screens/journeys by hash, re-renders the current screen if it is not inside a journey (journey screens keep their version until the journey ends), and posts a `CONFIG_APPLIED` event `{configVersion}`. On `session.revoked` → logout. Reconnect with backoff (2s, 4s, max 30s).

## 9. Events (`POST /events`)
```json
{ "events": [ { "type": "SCREEN_VIEW", "ts": "2026-11-06T10:00:00.000Z", "screen": "home",
               "journey": { "id": "transfer", "instance": "J-..", "step": "amount" }, "payload": {} } ] }
```
Types the runtime posts: `SCREEN_VIEW`, `UI_ACTION` (payload `{action:type, ...}`), `JOURNEY_STARTED`, `JOURNEY_STEP`, `JOURNEY_COMPLETED`, `JOURNEY_ABANDONED`, `CONFIG_APPLIED`, `ERROR`. Batch and flush every 3 s or 20 events; keep in memory on failure and retry.
The server itself records `SESSION_LOGIN`, `SESSION_LOGOUT`, `LOGIN_FAILED`, `TXN_SUBMITTED`, `TXN_SUCCEEDED`, `TXN_FAILED`, `SERVICE_REQUEST`.

## 10. Demo credentials
Customers (password `1234`): `aisha` (RETAIL), `omar` (PREMIER), `lina` (YOUTH, transfer limit 50 KWD per transaction).
Console staff: `maker` / `maker123` (designer, maker), `checker` / `checker123` (approver), `admin` / `admin123` (all).

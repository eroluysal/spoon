# Spoon — eSIM Go Travel API v2.5 mock

A **stateful mock of the `esim-go.com` API, version 2.5**. It behaves like a real
eSIM provider: it takes orders, provisions eSIMs, applies bundles, simulates data
consumption, expires bundles when their window closes, deletes idle eSIMs, and
fires webhooks (callbacks) for all of it.

- **Language / stack:** JavaScript (Node.js ≥ 20.11, ESM) + Fastify 5. No build
  step, one dependency set, runs with `node src/index.js`.
- **Source of truth:** the [eSIM Go v2.5 OpenAPI document](https://docs.esim-go.com/api/v2_5/)
  (kept in the repo as `openapi/esim_go_schema_v2_5.yaml`), the Notifications API,
  and the official guides (rate limits, bundle status, suspend/unsuspend, eSIM
  lifecycle, webhooks, QR delivery, balance, branding).
- **Port:** **4010** by default (`PORT` overrides it). 3000 is deliberately left
  free.

## Quick start

```bash
npm install
npm start                      # http://localhost:4010/v2.5
npm test                       # 87 tests, no network or port needed (fastify inject)
./examples/quickstart.sh       # end-to-end scenario (order → install → usage)
```

```bash
curl http://localhost:4010/v2.5/organisation -H 'X-API-Key: esimgo-mock-key'
```

Authentication works the way the live API does: an `X-API-Key` header on every
request (the header name is case insensitive). A missing or wrong key gives
**403** `{"message":"Forbidden"}`. The default key is `esimgo-mock-key`, changed
through `API_KEYS`.

## Supported endpoints

**Every** v2.5 operation is implemented, deprecated ones included.

### eSIMs
| Method | Path | Notes |
|---|---|---|
| GET | `/esims` | `page`, `perPage` (10/25/50/100), `orderBy=iccid`, `direction`, `filterBy`, `filter` |
| PUT | `/esims` | `iccid` + `customerRef` (query string or JSON body) |
| POST | `/esims/apply` | One bundle plus `iccid`, or a `bundles[]` list; `repeat`, `allowReassign` |
| GET | `/esims/assignments` | `reference`; **JSON / CSV / ZIP(QR)** per the `Accept` header, `additionalFields=installUrl` |
| GET | `/esims/{iccid}` | `additionalFields=installUrl` → Apple/Android one-tap install links |
| DELETE | `/esims/{iccid}` | Deactivates the eSIM |
| GET | `/esims/{iccid}/history` | The documented lifecycle events, newest first |
| GET | `/esims/{iccid}/refresh` | Re-pushes the profile to the device |
| GET | `/esims/{iccid}/compatible/{bundle}` | Network profile match |
| POST | `/esims/{iccid}/sms` | `message` (1–160, UTF-8), `from` (defaults to `eSIM`) |
| GET | `/esims/{iccid}/bundles` | `includeUsed`, `limit` (1–200, default 15) |
| GET | `/esims/{iccid}/bundles/{name}` | Every assignment of that bundle |
| DELETE | `/esims/{iccid}/bundles/{name}` | `type=validate\|transaction`, `refundToBalance`, `offerId` |
| DELETE | `/esims/{iccid}/bundles/{name}/assignments/{assignmentId}` | Revoke a single assignment |
| POST | `/esims/{iccid}/suspend` | `{"suspend":true\|false}` → **201** |
| GET | `/esims/{iccid}/suspend` | Current suspension state |
| GET | `/esims/{iccid}/location` | Last seen network and country |

### Orders, Inventory, Organisation, Catalogue, Networks
| Method | Path | Notes |
|---|---|---|
| GET | `/orders` | `includeIccids`, `page`, `limit`, `createdAt=lte:…\|gte:…` |
| POST | `/orders` | `type=validate` prices it, `type=transaction` charges the balance; `assign`, `profileID` |
| GET | `/orders/{orderReference}` | With eSIM details |
| GET | `/inventory` | Batches per bundle (`usageId`, `total`, `remaining`, `expiry`) |
| POST | `/inventory/refund` | `usageId` + `quantity` → credited to the balance |
| GET | `/organisation` | Balance, test credit, users, groups |
| POST | `/organisation/balance` | `amount` (query string or body) → charge the saved card |
| GET | `/organisation/groups` | The organisation's bundle groups |
| GET | `/catalogue` | `page`, `perPage`, `orderBy`, `direction`, `description`, `group`, `countries`, `region` |
| GET | `/catalogue/bundle/{name}` | A single bundle (names are **case sensitive**) |
| GET | `/catalogue/prices` | Consumption price list plus a content `hash` |
| GET | `/networks` | `countries` (names), `isos` (ISO2), `returnAll` |

### Deprecated (still working, answered with a `Deprecation: true` header)
| Method | Path |
|---|---|
| GET | `/esims/qr/{reference}` |
| GET | `/esims/csv/{reference}` |
| POST | `/esims/{iccid}/bundles` |
| DELETE | `/esims/{iccid}/bundles/{name}/applications/{assignmentId}` |

## What it reproduces faithfully

**Error envelope.** Every error is `{"message": "..."}`. Status codes follow the
documentation: `400` validation, `403` bad key / non-whitelisted IP / an ICCID
belonging to another organisation (never 401), `404` no such route, `410` install
details for a deactivated eSIM, `429` rate limit, `503` through injection.

**Rate limits.** Fixed window per IP, 10 requests per second. Every response
carries `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset` and
`X-Ratelimit-Cost`; a 429 adds `Retry-After`. Heavier endpoints such as catalogue
and networks cost 5 tokens.

**Bundle state machine.** `processing → queued → active → depleted | expired |
revoked | lapsed`. An eSIM runs one active data bundle at a time; the rest wait in
a queue and take over automatically when the one in front ends. A bundle whose
validity runs out before it ever starts becomes `lapsed`.

**Data accounting.** Base-10 bytes: 1 GB = 1,000,000,000. `initialQuantity` and
`remainingQuantity` are bytes, while the catalogue's `dataAmount` is MB. Unlimited
bundles count down to zero but never become `depleted` (fair use).

**Order rules.** ICCIDs may only be given with `assign: true`, `quantity` has to
match the number of ICCIDs, `profileID` requires `assign: true`, an incompatible
profile is refused without `allowReassign`, `assign: false` writes to stock, and
an insufficient balance is a 400.

**Revoke and refund.** An untouched bundle goes back to inventory (or to the
balance with `refundToBalance=true`); a used one is not refunded. `type=validate`
only reports what would happen and leaves the state alone.

**Suspension.** A `partner` suspension can be lifted through the API; a `policy`
one cannot (`403`). An already suspended or deactivated eSIM gives `400`.
Suspending does not pause bundle timers.

**eSIM lifecycle.** 180 days of inactivity → `esim.deletion_scheduled`, then
deactivation plus `esim.deleted` after 7 days. Applying a bundle in between
cancels the deletion.

**Install delivery.** `/esims/assignments` returns a ZIP (a real QR PNG per eSIM
plus the mapping CSV), JSON or CSV depending on the `Accept` header. The QR
encodes a real LPA string: `LPA:1$<smdp>$<matchingId>`.

**Catalogue.** 80 countries, 238 operators and roughly 1,950 bundles are generated
deterministically: country, regional and global coverage, in fixed, unlimited and
Voice & SMS variants. Prices line up with the live API (for example
`esim_1GB_7D_GB_V2` = 2.28 USD). The `countryNetworks` block v2.5 added (TADIG,
`mccMnc`, `speeds`, `potentialNetworks`) is there too.

## Webhooks (callbacks)

Every type in the Notifications API is produced:

`Utilisation` (1/50/80/100%), `FirstAttachment`, `FirstUse`, `CountryChange`,
`Topup`, `LowBalance` / `InsufficientBalance`, `esim.deletion_scheduled`,
`esim.deleted`, `MSISDNEnabled`, `MSISDNDisabled`, `SMSFailed`.

**V3** (the default) signs the raw body with HMAC-SHA256 using the API key and
sends it in `X-Signature-SHA256`; **V2** is unsigned and carries a slimmer
`bundle` object.

```bash
# Run the example receiver (it verifies the signature and prints the payload)
node examples/callback-receiver.mjs            # :4000

# Point the mock at it
curl -X POST localhost:4010/__mock/callbacks/config \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:4000/callback","version":"V3"}'
```

Every attempt is written to the `/__mock/callbacks` log even when no callback URL
is configured, so tests never have to stand up a receiver.

## Control plane — `/__mock`

For triggering synchronously what the real platform does on its own: installs,
network attachment, data consumption, the passage of time. It sits outside the API
prefix and needs no authentication.

| Method | Path | What it does |
|---|---|---|
| GET | `/__mock/health` | Liveness plus the virtual clock |
| GET | `/__mock/state` | Counters and an organisation summary |
| GET | `/__mock/state/dump` | The full state as JSON |
| POST | `/__mock/reset` | `{"seed":true\|false}` — start over |
| GET/POST | `/__mock/clock` | `{"days":8}` / `{"reset":true}` — move the virtual clock |
| POST | `/__mock/tick` | Run one simulation step (`consume`, `elapsedMs`) |
| POST | `/__mock/esims` | Provision bare eSIMs with no bundle (`count`) |
| POST | `/__mock/esims/{iccid}/install` | Mark the profile as Installed |
| POST | `/__mock/esims/{iccid}/attach` | `{"iso":"FR"}` — register on a network |
| POST | `/__mock/esims/{iccid}/usage` | `{"mb":500}` / `{"bytes":…}` — burn data |
| POST | `/__mock/esims/{iccid}/policy-suspend` | A suspension the API cannot lift |
| POST | `/__mock/esims/{iccid}/idle` | `{"days":181}` — backdate the activity clock |
| POST | `/__mock/inventory` | Add stock without placing an order |
| PATCH | `/__mock/organisation` | Balance, callback URL, thresholds and so on |
| GET/DELETE | `/__mock/callbacks` | The callback log (`?event=`, `?limit=`) |
| POST | `/__mock/callbacks/config` | Callback URL and version |
| POST | `/__mock/callbacks/test` | Send one type, or all of them |
| GET | `/__mock/sms` | Messages submitted through the API |
| GET/POST/DELETE | `/__mock/failures` | Failure injection |
| POST | `/__mock/persist` `/__mock/restore` | Snapshots, with `STATE_PATH` |
| GET | `/__mock/openapi.yaml` | The v2.5 OpenAPI document this mock follows |

**Failure injection** — for exercising retry and backoff code:

```bash
curl -X POST localhost:4010/__mock/failures -H 'Content-Type: application/json' \
  -d '{"path":"/orders","method":"POST","status":503,"message":"Processing","count":2,"delayMs":250}'
```

`path` also matches sub-paths (`/esims` covers `/esims/{iccid}/bundles`), `*`
catches everything, and a rule without `count` stays armed forever.

## Configuration

Everything is an environment variable; the full list is in `.env.example`. The
ones you will reach for:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4010` | HTTP port |
| `BASE_PATH` | `/v2.5` | API prefix |
| `API_KEYS` | `esimgo-mock-key` | Comma separated list of valid keys |
| `IP_WHITELIST` | empty | When set, only these IPs (403 otherwise) |
| `RATE_LIMIT_ENABLED` / `RATE_LIMIT` | `true` / `10` | Requests per second |
| `CALLBACK_URL` / `CALLBACK_VERSION` | empty / `V3` | Webhook target and version |
| `SIM_AUTO_USAGE` / `SIM_BYTES_PER_SECOND` | `true` / `250000` | Automatic data consumption |
| `SIM_AUTO_INSTALL_AFTER_MS` | `10000` | Auto install + attach an eSIM (0 = off) |
| `SIM_PROCESSING_MS` | `3000` | Time spent in the `processing` state |
| `SEED_ESIMS` / `SEED_INVENTORY` | `3` / `true` | Demo data created on boot |
| `STATE_PATH` | empty | When set, the state is written to disk on shutdown |

A handy profile for test suites: `RATE_LIMIT_ENABLED=false SIM_PROCESSING_MS=0
SIM_AUTO_USAGE=false SEED_ESIMS=0`.

## Project layout

```
src/
  index.js            entry point: state restore/seed, engine, listen
  server.js           Fastify setup, error envelope, route registration
  config.js           environment driven configuration
  routes/             HTTP layer (esims, bundles, orders, inventory,
                      catalogue, networks, organisation, deprecated, mock)
  domain/             business rules (esims, bundles, orders, inventory,
                      catalogue, networks, organisation)
  store/              in-memory state, snapshot/restore, seed data
  data/               country + operator reference data, catalogue generator
  callbacks/          webhook delivery and HMAC signing
  sim/                background simulation engine
  util/               errors, time (virtual clock), ids/ICCID, CSV, ZIP, QR, validation
  plugins/            auth, rate limiting, failure injection
tests/                87 tests (node:test + fastify inject)
examples/             quickstart.sh, callback-receiver.mjs
openapi/              the eSIM Go v2.5 OpenAPI document this mock follows
```

The code is fully JSDoc'd: every exported function has a `@param`/`@returns`
block, and the comments call out both the places that mirror the live API exactly
and the places that deliberately differ.

## Where it differs, because it is a mock

- ICCIDs are sequential and Luhn-valid (`8943108100000000010`…); the matching ID
  and SM-DP+ address are fake (`rsp.esim-go-mock.local`) and will not install on a
  real device.
- The catalogue is generated deterministically. It is not a copy of the real eSIM
  Go catalogue, but the naming, shape and price structure match.
- `/esims/assignments` returns an object for a single eSIM and an array for
  several (the documented example is a single object, while real orders can cover
  many eSIMs).
- State lives in memory; without `STATE_PATH` it resets on restart.
- The `/__mock` surface does not exist in the real API.

> **One-project deployment:** See [VERCEL_SETUP.md](VERCEL_SETUP.md) for the combined portal, driver app, and API setup. Run `npm run build` then `npm start` for the unified local preview.

# FlowDepot — Warehouse, Inventory & Delivery Management Suite

A single-package full-stack Vue application based on the supplied process diagram. It models the platform from four role perspectives: warehouse owner, tenant, warehouse manager and driver/3PL field user.

## Included applications

- `src/portal` — Vue 3 desktop/tablet operations portal.
- `src/driver` — Ionic Vue mobile app/PWA for drivers and on-the-ground staff. It can later be packaged with Capacitor for Android/iOS.
- `server` — Express API with role-based access, file-backed persistence, QR generation, RFID event ingestion, real-time notifications, proof-of-delivery uploads, incident handling and reporting.

## Major workflows implemented

- Multi-site → multi-warehouse → multi-tenant structure.
- Lease tracking, expiry awareness, rent, utilities and owner NOI/ROI dashboard.
- Owner Utilities & Metering command centre with kWh, m³, peak demand, energy/water intensity, tariff history, recovery cost/margin and meter connectivity.
- International currency model: organization reporting currency, site/lease/invoice transaction currencies, persisted FX rates and cross-currency portfolio rollups.
- Advanced KPIs for on-time delivery, inventory accuracy, digital traceability, warehouse space utilisation, dock-to-dispatch, order cycle, POD completion and incident workload.
- Tenant inventory across rented warehouses and retail stores.
- Store low-stock detection and restock suggestion API.
- Delivery orders, driver/vehicle assignment and delivery lifecycle.
- Driver schedule in both web and mobile interfaces.
- QR workflow events for pickup, departure, arrival, delivery and verification.
- RFID ingestion endpoint that writes to the same process-event ledger.
- Mobile proof-of-delivery photo capture/upload.
- Fault and incident reporting.
- Automatic rectification examples:
  - vehicle breakdown → assign an available backup vehicle;
  - driver unavailable → assign an available backup driver;
  - inventory mismatch → create reconciliation task;
  - returned goods → create return-processing task.
- Paperless process records with PDF and CSV exports for deliveries, incidents, invoices, utility consumption, meters and event history.
- Socket.IO notifications for operational updates.

## Demo accounts

| Role | Login | Password |
|---|---|---|
| Owner | `owner@demo.com` | `Owner123!` |
| Tenant | `tenant@demo.com` | `Tenant123!` |
| Warehouse Manager | `manager@demo.com` | `Manager123!` |
| Driver | `driver@demo.com` | `Driver123!` |

## Run locally

Prerequisite: Node.js 20+ and npm.

```bash
npm install
npm run reset:data
npm run dev
```

Open:

- Web portal: `http://127.0.0.1:5180`
- Mobile app/PWA: `http://127.0.0.1:5180/driver/login`
- Backend API: `http://localhost:4000/api`

To run only the desktop portal + API:

```bash
npm run dev:web
```

To run only the mobile app + API:

```bash
npm run dev:mobile
```

## QR testing

A generated delivery QR encodes a payload such as:

```text
WMS|DELIVERY|DEL-1001|PICKUP|v1
```

The mobile `Scan` screen currently provides a browser-friendly payload entry flow. When packaging with Capacitor, connect a barcode-scanner plugin and send the decoded string to `POST /api/scans`; no backend redesign is required.

## RFID integration

Readers/gateways can send tag events to:

```text
POST /api/rfid/events
```

Example body:

```json
{
  "tagId": "E2000017221101441890ABCD",
  "readerId": "DOCK-01-RFID",
  "entityType": "INVENTORY",
  "entityId": "INV-01",
  "action": "SEEN"
}
```

This intentionally uses a generic event adapter so Zebra, Impinj, Chainway, fixed readers or MQTT-to-HTTP gateways can be integrated without changing the workflow model.

## Recommended production hardening

The supplied project is a functional local suite and architecture baseline, not yet a production-certified SaaS deployment. Before live use, replace the local JSON repository with PostgreSQL, replace the demo SHA-256 password handling with Argon2/bcrypt + a proper identity service, use object storage for evidence photos, add tenant-level database isolation, append-only/auditable event storage, background jobs, map/routing integration, invoice/PDF templates, real utility-meter integrations, backups, observability, SSO/MFA, device management and automated tests.

## Suggested next implementation phases

1. PostgreSQL + Prisma and multi-tenant database model.
2. Full user/role/permission administration screen.
3. Warehouse floor/bin/location model with QR labels for pallet/bin/SKU.
4. Real RFID reader/MQTT adapter and EPC-to-item mapping.
5. Routing/geolocation and nearest-warehouse calculation using actual coordinates/travel time.
6. Branded invoice/report templates, scheduled report packs and email workflow (basic PDF/CSV export is already implemented).
7. Lease document storage, digital approval and renewal workflow.
8. Inventory receiving, put-away, picking, packing, cycle count and returns modules.
9. Driver GPS, route optimization, ETA and 3PL dispatch integration.
10. Mobile offline queue/sync for poor-connectivity sites.
11. Rule engine for exception/rectification policies and human approval thresholds.
12. Deployment with Docker, reverse proxy, TLS and CI/CD.

## v3 commercial leasing + multimodal freight

This version adds an owner Commercial & Leasing module with configurable warehouse rental rate cards, platform/service fee rules, prospective tenant applications, approval/rejection workflow, and a public `/apply` tenancy application page.

It also adds a Freight & Special Cargo control module covering ROAD/AIR/SEA/RAIL/MULTIMODAL jobs, FCL/LCL, container and airway-bill references, Incoterms, customs state, cargo handling profiles, and digital playbooks for fragile, cold-chain, hazardous/regulated and high-value goods. The same process-event architecture is intended to record each handoff, exception and rectification step.

## End-user UX conventions (v4)
The web navigation is grouped by everyday tasks rather than technical modules: Overview, Properties, Operations, Finance & Utilities, and Records & Tools. Labels use plain-language names such as **Rent & Leasing**, **Energy & Water**, **Deliveries & Dispatch**, **Issues & Incidents**, and **Scan QR / RFID**. Technical abbreviations remain inside detailed screens only where they are operationally necessary.

Design rule for future screens: show the user's next action first, use descriptive button labels, avoid internal IDs as the primary label when a human-readable name exists, explain specialist terms beside the field, and keep destructive/exception actions visually separate from normal workflow actions.

### Utility analytics drill-down (v5)
Energy & Water supports portfolio-wide and per-warehouse views. Users can switch the usage charts between hourly, daily, weekly, monthly and yearly intervals. Warehouse names in the usage table can be clicked to open that warehouse's trend directly. The demo API derives finer-grained example intervals from seeded monthly readings; in production, these intervals should be backed by actual interval meter telemetry (for example 15-minute/hourly IoT readings) and server-side aggregation.

## v6 - Professional documents and mobile sign-off

The suite now includes operational documents intended to mirror real warehouse/logistics paperwork rather than generic data dumps:
- Delivery Order (DO) PDF
- Proof of Delivery (POD) PDF with receiver name, company/reference, remarks, timestamp and captured signature
- Incident Report PDF with rectification and management sign-off section
- Commercial Invoice PDF
- Energy & Water Statement PDF
- CSV/PDF audit registers remain available separately

Owner-controlled document branding is available under Reports & Records. The Owner can maintain legal company details and upload a PNG/JPEG logo used on generated PDFs.

The mobile driver workflow includes a receiver sign-off sheet. The receiver signs directly on the phone; the signature, receiver details, time and optional device location are retained against the delivery and included in the POD. Signing closes the delivery as DELIVERED and creates an immutable process event in the demo audit trail.

For production use, add country-specific tax/e-invoicing fields, legally reviewed acknowledgement wording, cryptographic document hashing, stronger immutable audit storage, identity/SSO, retention controls and qualified/e-signature services where local law or contract requires them.


## Live Simulation & Training (v7)
FlowDepot now includes a first-class Live Simulation page for Owner and Warehouse Manager users. It can run NORMAL_DAY, PEAK_OPERATIONS, VEHICLE_BREAKDOWN and UTILITY_SPIKE scenarios at configurable simulated speed. Generated deliveries, telemetry, incidents, notifications and feed events are tagged as simulation records and can be reset without removing normal data.

The simulation uses the same API/database/event/Socket.IO paths as the operational application so the web dashboard and driver mobile experience update together. The driver mobile app now also includes a Calendar/List Schedule tab and receives live in-app notification popups when simulated assignments or urgent changes are generated.

Production note: browser Socket.IO popups demonstrate real-time behaviour. Native background push for installed iOS/Android applications still requires production FCM/APNs configuration, device-token registration and notification permission handling.

## v9 — Multi-stop route runs, GPS-assisted driving and standby drivers

FlowDepot now treats a driver's shift as a **route run** rather than assuming one delivery equals one point-to-point journey.

### Route model

`Route Run -> ordered Stops -> one or more Delivery records per stop`

Supported stop types include pickup, delivery and return in the prototype. The API accepts additional stop types so freight/transfer/customs/service stops can be added without changing the core model.

The seeded `RUN-1042` demonstrates one warehouse pickup followed by three customer destinations and a return to the warehouse. Individual `DEL-*` records remain separate for POD, customer visibility, billing and audit.

### Minimal driver interaction

The driver confirms pickup once using **Confirm Pickup & Start Route**. FlowDepot then:

- marks the pickup stop completed;
- changes all linked, open delivery records to `IN_TRANSIT`;
- starts the route;
- starts the mobile GPS tracking session;
- identifies the next required stop.

At each delivery stop, one receiver sign-off can close all delivery records linked to that stop. Return/non-delivery stops use a simple completion action.

### GPS and navigation

The mobile prototype uses `navigator.geolocation.watchPosition()` to send route location updates to `/api/route-runs/:id/location`. The backend maintains `LIVE`, `STALE` and `OFFLINE` tracking health and can mark the next stop `ARRIVED` when the phone enters a 150 m demo geofence.

The driver can launch Google Maps or Waze with the next stop coordinates already populated. The route remains owned by FlowDepot while turn-by-turn road navigation is delegated to a mature navigation provider.

**Production note:** browser/WebView geolocation is not sufficient for guaranteed background tracking after OS suspension or app termination. A production Capacitor build should use native iOS/Android background-location services, appropriate permissions, a foreground service on Android where required, battery-aware sampling, secure telemetry, and explicit privacy/retention controls. If vehicle telematics is available, FlowDepot should support it as an alternate location source.

### Standby driver workflow

A route can carry:

- primary driver;
- standby driver;
- standby approval state;
- active driver.

When `routePolicy.requireStandby` is enabled, the route cannot start until a standby driver has been selected and approved. Owner/warehouse-manager users can activate the approved standby driver without rewriting completed delivery history.

### Driver availability / medical leave

The mobile **Me** screen now supports leave, day-off, unavailable and medical-leave submissions. A photo or PDF can be attached as supporting evidence such as a medical certificate. The API identifies active/planned routes that may be affected, while replacement activation remains a manager-controlled action.

### New v9 API routes

- `GET /api/route-runs`
- `POST /api/route-runs`
- `PATCH /api/route-runs/:id/dispatch`
- `POST /api/route-runs/:id/start`
- `POST /api/route-runs/:id/location`
- `POST /api/route-runs/:id/stops/:stopId/signoff`
- `POST /api/route-runs/:id/stops/:stopId/complete`
- `POST /api/route-runs/:id/activate-standby`
- `GET /api/driver/availability`
- `POST /api/driver/availability`
- `PATCH /api/driver/availability/:id/status`

This is still a prototype/local architecture. Production hardening remains required for database transactions, tenant isolation, native background GPS, mapping/routing provider contracts, security, object storage, mobile push, auditing and operational resilience.

## v10 — POD Contact Distribution
FlowDepot now treats POD recipient configuration as a location-aware many-to-many model. A store can have multiple Receiving contacts, multiple Store Managers, plus company-wide Logistics/Finance contacts. At receiver sign-off the backend derives company/store/reference fields from the delivery record, generates the signed POD record, snapshots the applicable registered recipients and queues a distribution record for each recipient. The receiver only enters their name and signature (plus optional exception remarks).

The current prototype records distribution as `QUEUED`; a production deployment should wire this queue to a transactional email/SMS provider and process provider delivery/bounce callbacks asynchronously.


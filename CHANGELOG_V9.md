# FlowDepot v9 — Multi-stop Route & Driver Operations

Implemented from the v8 leasing/bidding baseline.

## Major additions

- Multi-stop `routeRuns` model with ordered pickup, delivery and return stops.
- Demo `RUN-1042`: Warehouse A pickup -> Orchard -> Novena -> Tampines -> Warehouse return.
- Individual deliveries remain independent records but link to `routeRunId` and `routeStopId`.
- One mobile **Confirm Pickup & Start Route** action sets linked deliveries to `IN_TRANSIT`.
- GPS route tracking endpoint and tracking health (`LIVE`, `STALE`, `OFFLINE`).
- 150 m demo destination geofence can mark the current stop as `ARRIVED`.
- Driver navigation shortcuts for Google Maps and Waze using destination coordinates.
- Stop-level receiver signature closes all delivery records linked to that stop.
- Ordered-stop enforcement prevents signing/completing a future stop accidentally.
- Return/non-delivery stop completion and route completion automatically stop tracking.
- Primary driver + standby driver + standby approval + active driver model.
- Route start is blocked when standby policy requires approval and it is missing.
- Manager can activate the approved standby driver without rewriting completed history.
- Driver leave/day-off/unavailability/medical-leave requests from mobile.
- Medical certificate/supporting file upload.
- Manager review of driver availability requests in the web dispatch screen.
- Driver mobile schedule now displays route runs and standby information.
- Operations portal now shows route progress, ordered stops, GPS health, primary/standby/active driver and individual delivery records.

## Validation performed

- `node --check server/src/index.js` — passed.
- `node --check server/src/seed.js` — passed.
- `node server/src/reset.js` — passed and generated the v9 demo DB.
- Full runtime/API and Vite builds were not verified because npm dependencies are not installed in this environment (`express` is unavailable locally). No claim is made that the frontend production build has been validated.

## Production GPS caveat

The current Ionic/Vue demo uses browser/WebView geolocation. Production background tracking requires native Capacitor iOS/Android background-location handling, platform permissions, Android foreground-service behavior where required, offline buffering, privacy controls, and OS-specific recovery after app termination/reboot. Vehicle telematics should remain an alternate location source for enterprise deployments.

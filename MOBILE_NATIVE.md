# Native mobile build

The mobile client is built with Ionic Vue + Capacitor. It runs immediately as a browser/PWA app and is already structured for Android/iOS packaging.

## Android

From the repository root:

```bash
npm install
npm --workspace apps/mobile run build
cd apps/mobile
npx cap add android
npx cap sync android
npx cap open android
```

Build/run from Android Studio. When testing against the API on another computer, copy `apps/mobile/.env.example` to `.env` and set `VITE_API_URL` to the backend computer's LAN IP before building.

## iOS

On macOS with Xcode:

```bash
npm --workspace apps/mobile run build
cd apps/mobile
npx cap add ios
npx cap sync ios
npx cap open ios
```

## Camera QR scanner

The current mobile screen uses browser-friendly QR payload entry so the project works without device-specific native permissions. For live camera scanning, connect any supported Capacitor barcode scanner and pass the decoded payload directly to `POST /api/scans`.

## Proof-of-delivery camera

The `Today` screen already uses a mobile file input with `capture="environment"`; on supported phones this opens the rear camera and uploads the resulting evidence image to the delivery record.

## v9 background GPS requirement

The v9 prototype starts location tracking when the driver confirms pickup for a route run. The current Vue/Ionic screen uses browser geolocation for demonstration only.

For production, implement a native Capacitor background-location service with these rules:

1. Start only for an active route after pickup confirmation.
2. Continue while the app is backgrounded or the phone is locked, subject to Android/iOS platform rules.
3. Use an Android foreground service / persistent system notification when required by the target Android version.
4. Stop automatically when the route is completed, cancelled or handed over.
5. Treat force-stop, permission removal, reboot and battery shutdown as recoverable tracking interruptions; the delivery stays `IN_TRANSIT` while tracking health becomes stale/offline.
6. On app restart, query `/api/dashboard`; if the driver owns an `IN_PROGRESS` route, restart the location service automatically after permissions are available.
7. Buffer a bounded number of points while offline and upload when connectivity returns.
8. Do not track a standby driver until that driver is actually activated as the route's active driver.
9. Make sampling adaptive rather than one-second polling; normal transit can use a lower frequency and increase near the destination if required.
10. Publish a clear company privacy/retention policy for employee location data.

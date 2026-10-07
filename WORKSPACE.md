# FlowDepot workspace

FlowDepot is one root npm package and one Vite application. The operations portal lives in `src/portal`, the driver interface in `src/driver`, and the API is deployed through `api/index.mjs`. No nested package manifests or npm workspaces remain.

Local combined preview:

```powershell
npm run build
npm start
```

Portal: http://127.0.0.1:5182/login
Driver: http://127.0.0.1:5182/driver/login

For live development, run `npm run dev` and open http://127.0.0.1:5180. The driver app is under /driver on that same address.

Demo driver: driver@demo.com / Driver123!
Demo owner: owner@demo.com / Owner123!

See [VERCEL_SETUP.md](VERCEL_SETUP.md) for the one-project Vercel configuration, database connection and initialization steps, hosted behavior, and verification limits.

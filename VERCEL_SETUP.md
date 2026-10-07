# FlowDepot: one Vercel project

The repository is one root Vue/Vite application package, with the Express API in `api/index.mjs`. There are no npm workspaces or separate frontend/server package manifests. Vercel imports the root as one Vite project.

| Address | Application |
| --- | --- |
| `/` or `/login` | Operations portal |
| `/driver/login` | Driver sign-in |
| `/driver/app/today` | Driver routes |
| `/api/*` | Shared Express API |
| `/uploads/*` | Stored signatures, documents, and photos |

The login page links to `/driver/login`. Both apps call `/api`, so no separate mobile domain or API domain is needed. Driver and portal sessions use separate storage keys.

## Local preview

```powershell
npm install
npm run build
npm start
```

Open http://127.0.0.1:5182. The driver app is at http://127.0.0.1:5182/driver/login. This is one Node server serving both apps and the API.

For live development, use `npm run dev` and open http://127.0.0.1:5180. One Vite development server serves both interfaces and forwards `/api` to the local API. `npm run build` builds one application into `dist`.

Local use without `DATABASE_URL` keeps the original JSON datastore and local uploads. Demo accounts are unchanged.

## Configure Vercel

1. Import the repository as **one project**, with Root Directory set to the repository root, with no subdirectory selected.
2. Use Application Preset **Vite**, not **Services**. The committed `vercel.json` sets Install Command `npm ci`, Build Command `npm run build`, and Output Directory `dist`.
3. Use Node.js **22.x**.
4. Connect a PostgreSQL database to the project through Vercel Storage/Marketplace or your existing PostgreSQL provider. This is a storage resource, not a second frontend deployment.
5. Set runtime environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Provider's PostgreSQL connection URL, with its required TLS settings; use a pooled connection URL when supplied |
| `JWT_SECRET` | A randomly generated secret of at least 32 characters |
| `APP_MODE` | `production` |
| `SIMULATION_ENABLED` | `false` |

Do not put database URLs, passwords, or JWT secrets in `VITE_*` variables. The combined build supplies the frontend API/mobile URLs automatically.

## Initialize the database once

Create a local ignored `.env` from `.env.example`, using the connected database URL. Set `BOOTSTRAP_OWNER_EMAIL`, `BOOTSTRAP_OWNER_NAME`, and `BOOTSTRAP_OWNER_PASSWORD` (minimum 12 characters). Then run:

```powershell
npm run init:cloud
```

This creates a clean datastore with the owner account. It refuses to overwrite an existing datastore. Remove bootstrap passwords from your local `.env` after initialization; Vercel runtime does not need them.

For a training/demo deployment with the existing driver routes and all four demo accounts, initialize an empty database with:

```powershell
npm run init:cloud -- --demo
```

Use the demo initializer instead of the clean owner initializer for that database. Demo accounts remain usable even when the production UI hides their hints. To display demo hints on a training deployment, set `VITE_DEMO_MODE=true` in Vercel before building. A clean owner initialization does not create driver accounts or sample routes.

## Deploy and verify

Deploy the root project. Verify `/api/health`, sign in to the portal, use the driver link, and refresh `/driver/app/today` directly. Then test a pickup, delivery sign-off, and the resulting POD document. Repeat after a redeployment to verify database and file persistence.

## Hosted behavior and limits

- PostgreSQL stores the existing record model as one transactionally locked JSON snapshot. Uploads and signatures are stored in a separate `bytea` table and committed with the record change. This retains the v12 workflows without a database-per-module migration.
- Hosted builds refresh notifications every 15 seconds. Driver route data also refreshes every 15 seconds while the app is visible and no sign-off form is open. These are in-app updates, not native background push notifications.
- Continuous live simulation is disabled with cloud storage. Its process timers are intended for local training; durable scheduled simulation would require a separate job implementation.
- Hosted uploads are limited to 4 MiB per file to leave space for multipart overhead within Vercel's function request limit. Large attachments require direct object-storage uploads.
- The snapshot datastore serializes requests; it is suited to this prototype and small deployments. Large portfolios should migrate to normalized tables and object storage. PDF requests currently load referenced images from the datastore.
- Inherited v12 permissions and dependency audit findings still require production review. This work makes the deployment unified; it does not certify the application for production.

## Verification performed

- Combined frontend build passes.
- Automated tests cover portal/mobile pages and their assets, direct driver route refresh, both account logins, instruction acknowledgement, pickup, sign-off, stored signature, and POD PDF generation.
- PostgreSQL-compatible PGlite tests cover persistent records/files and transaction rollback. A remote PostgreSQL provider and an actual Vercel deployment have not been verified in this session.
- Visual browser verification is unavailable in this session.

Official references: [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js), [project configuration](https://vercel.com/docs/project-configuration), and [PostgreSQL client transactions](https://node-postgres.com/features/transactions).

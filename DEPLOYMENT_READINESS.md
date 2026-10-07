# FlowDepot Deployment Edition

This edition is configured with `APP_MODE=production` and `SIMULATION_ENABLED=false`. It contains the controlled inventory/request/dispatch/POD workflow, server-side tenant checks, state-transition validation, maker/checker approval for sensitive stock adjustments, tamper-evident audit chaining, safer uploads, restricted CORS, request throttling, production bootstrap, Docker packaging and persistent data volumes.

## First deployment
1. Copy `server/.env.production.example` to `server/.env.production` and replace every placeholder.
2. Build the images with `docker compose -f docker-compose.production.yml build`.
3. Initialize the datastore once inside the API image with `npm run init:production` using the configured bootstrap owner credentials.
4. Start with `docker compose -f docker-compose.production.yml up -d`.
5. Put TLS/reverse-proxy/WAF controls in front of port 8080 in the target environment.
6. Change the bootstrap password immediately and create named staff accounts/roles.

## Operational controls implemented
- organisation/tenant resource scoping on operational APIs
- controlled delivery state transitions
- stock ledger rather than direct stock overwrite
- reservations before goods-request fulfilment
- maker/checker for large stock adjustments
- customer ad-hoc delivery request/review/planning
- driver/vehicle conflict detection
- primary/standby driver separation
- cargo/driver instructions with acknowledgement audit
- multi-stop delivery and POD recipient distribution
- tamper-evident process event chain
- atomic datastore writes
- production-only secret checks, CORS restrictions, request limits and security headers

## Important production boundary
The included datastore is a persistent, atomic single-node file store so this package can be deployed as a controlled single-instance application. For multi-instance/HA SaaS deployment, migrate the store to PostgreSQL before horizontal scaling. External penetration testing, backup/restore drills, country-specific privacy/tax/legal review, email/SMS provider configuration and infrastructure hardening remain deployment-environment acceptance activities rather than claims made by the source package.

# FlowDepot v12 — UX & Form Reliability

## Scope
This release hardens user-facing forms and action feedback across the deployment and client-simulation editions.

## Key changes
- Rebuilt ad-hoc delivery request around human-readable warehouse, destination and product selectors.
- Removed Pickup ID, Destination ID and raw SKU entry from the normal request workflow.
- Added structured delivery address fields: building/mall, street, unit/suite, postal code, country, loading/service entrance, contact and phone.
- Added multi-select oval handling chips with SKU handling rules inherited automatically.
- Increased destination instruction and remarks areas to practical multi-line fields.
- Fixed owner/manager ad-hoc delivery and goods request submissions by supplying the required tenant context.
- Rebuilt goods request and stock-adjustment forms around named customer, warehouse, store and product selectors.
- Added consistent submit/loading/success/error behavior and global toast feedback; successful forms close only after the API confirms the transaction.
- Fixed lease-renewal submission feedback and pending-renewal handling.
- Implemented working Rent & Leasing actions for New service charge, Set rental rate and Review applications.
- Added service-charge and rental-rate forms plus tenant-application review workflow.
- Replaced warehouse IDs with warehouse names in tenancy application selection and tenant lease display.
- Added public warehouse reference endpoint for the tenancy application form.
- Expanded operations reference data returned to the web UI so selectors can resolve warehouse/store/customer/product names.
- Added update endpoints for service charges and rental rate cards for future edit workflows.

## Validation
- `node --check server/src/index.js` passed for both editions.
- `node --check server/src/seed.js` passed for both editions.
- Demo datastore reset passed for both editions.
- Full Vue/Vite compilation was not run because frontend dependencies are not installed in the execution environment.

# FlowDepot v10 — POD Contact Distribution

## Proof of Delivery changes
- Receiver-facing sign-off is reduced to receiver name, optional remarks/exceptions, and signature.
- Company, store/location and delivery/reference ID are derived from the delivery record by the backend.
- A destination can have one or more `RECEIVING` contacts and one or more `STORE_MANAGER` contacts.
- Company-wide contacts such as `LOGISTICS` can also receive every applicable POD.
- The applicable distribution list is snapshotted at POD issuance so later contact changes do not rewrite historical records.
- POD document generation/storage is independent from email/SMS distribution status.
- Distribution failures can be retried without changing the delivery or POD status.

## New data and APIs
- `locationContacts`
- `documentDistributions`
- `GET/POST/PATCH/DELETE /api/pod-contacts`
- `GET /api/pod-distributions`
- `POST /api/pod-distributions/:id/retry`

## Web portal
- New **POD Contacts** screen for Owner, Warehouse Manager and Tenant roles.
- Supports multiple contacts per location and per role.
- Shows the POD distribution queue and historical recipient snapshots.

## Mobile
- Receiver no longer types company/store or reference ID.
- The sign-off sheet tells the driver/receiver how many registered recipients will automatically receive the signed POD.

## Production note
The prototype queues distribution records but does not claim a production email/SMS provider integration. Production deployment should connect the document queue to an email/SMS provider, record provider message IDs and delivery/bounce events, enforce retry/dead-letter policies, and configure retention/privacy rules.

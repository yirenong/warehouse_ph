# Security and anti-foul-play controls

FlowDepot treats sensitive changes as workflow requests, not arbitrary CRUD updates. Critical controls include least-privilege roles, tenant scoping, valid state transitions, maker/checker approval, immutable operational history, stock-ledger reconciliation, document recipient snapshots, route/driver/vehicle conflict checks and auditable instruction acknowledgement.

No system can truthfully guarantee that fraud or abuse is impossible. Production operation should combine these application controls with MFA/SSO, named accounts, log monitoring, backups, periodic access review, physical scan controls, CCTV/site controls where appropriate, financial reconciliation, incident response and independent security testing.

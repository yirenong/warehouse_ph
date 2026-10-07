# FlowDepot architecture

```text
                           ┌──────────────────────────┐
                           │ Users / Identity / RBAC  │
                           └────────────┬─────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
      ┌───────▼────────┐      ┌─────────▼────────┐      ┌────────▼────────┐
      │ Owner Web App  │      │ Tenant/Manager   │      │ Driver Mobile   │
      │ Sites/Leases   │      │ Inventory/Ops    │      │ Schedule/Proof  │
      └───────┬────────┘      └─────────┬────────┘      └────────┬────────┘
              └─────────────────────────┼─────────────────────────┘
                                        │ REST + Socket.IO
                             ┌──────────▼──────────┐
                             │ Workflow/API Layer │
                             │ QR/RFID/Incidents  │
                             └──────────┬──────────┘
                                        │
         ┌──────────────────────────────┼──────────────────────────────┐
         │                              │                              │
┌────────▼─────────┐         ┌──────────▼─────────┐         ┌──────────▼─────────┐
│ Asset/Lease Data │         │ Inventory/Delivery│         │ Process Event Log  │
│ Sites/Warehouses │         │ Store/Fleet/Proof │         │ Reports/Audit Trail│
└──────────────────┘         └────────────────────┘         └────────────────────┘
```

The key design decision is that QR and RFID do not form separate workflows. They are **capture methods** for the same process-event model. Every important handoff creates a timestamped event, which gives a single source for operational history, incident evidence, reports and later analytics.

## Commercial and leasing domain
Owner-managed rental rates are versioned by warehouse, space type, currency and effective date. Prospective tenants can submit a public digital application which enters a review workflow before lease creation. Platform/service fees are modeled as independent pricing rules so invoices can combine rent, utilities, handling/logistics and SaaS/platform charges without hard-coded pricing.

## Multimodal freight and special cargo domain
The freight model treats last-mile delivery as one leg of a larger shipment. Freight jobs can be road, sea, air, rail or multimodal, with FCL/LCL/air-freight service types, container/AWB references, Incoterms, customs status and mandatory documents. Cargo profiles attach handling constraints and checkpoints such as fragile photo evidence, shock/tilt monitoring, cold-chain temperature logs, dangerous-goods documentation and high-value chain-of-custody controls. Exceptions such as customs hold, missed vessel/flight, demurrage/detention, partial shipment, damage, quarantine and return should create process events and rectification tasks.

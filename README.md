# ACC Crappie Stix - Inventory Management System

Custom inventory management system built for ACC Crappie Stix. A simplified alternative to tools like Cin7 or Finale Inventory, tailored for fishing tackle wholesale operations.

## Features

- **Fulfillment Pipeline** - Kanban board tracking orders through Confirmed → Picked & Packed → Shipment Booked → Shipped stages. Inventory is locked from confirmation through shipment.
- **Dealer PO Import** - Native support for ACC Crappie Stix order writer Excel files (dealer & distributor programs). Also supports generic CSV import with column mapping.
- **Inventory Management** - Real-time available-to-promise calculations. Stock adjustments, manual holds, and reorder point alerts.
- **Sales Orders** - Full order lifecycle with backorder tracking, partial fulfillment, and auto-allocation when stock arrives.
- **Purchase Orders** - Track inbound orders with auto-fill of backordered items on receipt.
- **Reports & Analytics** - Revenue, COGS, margins, pipeline value, stock health charts.
- **Audit Log** - Full activity history for all inventory and order changes.
- **Customer & Supplier Management** - CRM for dealers, distributors, and retailers.

## Getting Started

```bash
npm install
npm run dev
```

## Build for Production

```bash
npm run build
npm run preview  # preview the production build locally
```

## Tech Stack

- React 19 + Vite
- Recharts for analytics
- xlsx for Excel file parsing
- localStorage for data persistence

## Project Structure

```
src/
├── App.jsx                 # Root app with sidebar navigation
├── main.jsx                # Entry point
├── lib/
│   ├── constants.js        # Stage definitions, status colors, CSV aliases
│   ├── defaultData.js      # Seed data (products, orders, suppliers)
│   ├── inventory.js        # Core engine (available calc, stage advancement, auto-allocation)
│   ├── parseAccOrderWriter.js  # ACC order writer Excel parser
│   ├── storage.js          # localStorage persistence
│   └── utils.js            # Formatting, CSV helpers, ID generation
└── components/
    ├── ui.jsx              # Shared UI primitives (Modal, Table, Badge, Field, styles)
    ├── Dashboard.jsx       # Overview with KPIs and alerts
    ├── PipelineView.jsx    # Kanban fulfillment board
    ├── SalesOrders.jsx     # Order list + OrderDrawer detail panel
    ├── DealerPOImport.jsx  # Multi-step PO import wizard
    ├── Products.jsx        # Product list + SkuDrawer + stock adjustments
    ├── PurchaseOrders.jsx  # PO management with receive & auto-allocate
    ├── Reports.jsx         # Analytics charts and metrics
    ├── Suppliers.jsx       # Supplier CRM
    ├── Customers.jsx       # Customer CRM
    └── AuditLog.jsx        # Activity log with filtering
```

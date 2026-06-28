# MedServicePrice.kz

> **Aviasales for medicine in Kazakhstan** — a price comparison platform that helps patients find, compare, and track public prices for analyses, doctor visits, diagnostics, and procedures across clinics.

[Live demo](https://m1wce5cu8p40-d.space-z.ai) · [Backup mirror](https://preview-chat-574bbfd4-6988-47e0-84af-b4f57ece9813.space-z.ai) · [GitHub repository](https://github.com/emixor/medserviceprice)

---

## Why this exists

Patients in Kazakhstan often need to check dozens of clinic websites to answer a simple question: **where is this service cheaper, faster, and closer to me?**

MedServicePrice.kz solves that problem by aggregating public clinic price data, normalizing service names into a common catalog, and presenting the results in a search-first interface that is fast to scan, compare, and act on.

This project was built for the **MedServicePrice.kz hackathon brief** and is designed around three core ideas:

1. **Search** — find a medical service quickly.
2. **Compare** — compare clinics by price, freshness, distance, rating, and availability.
3. **Trust** — show source links, update timestamps, and transparency cues instead of hiding the data pipeline.

---

## Live product snapshot

The deployed product already exposes a much richer surface than a basic landing page. In the current UI you can use search, popular query shortcuts, filters, sorting, saved presets, export actions, price-history views, map-oriented discovery, and admin/navigation entry points.

---

## What the platform does

### For users
- Search medical services with a command-palette style entry point.
- Compare clinic prices side by side.
- Filter by city, category, price range, minimum rating, online booking, and freshness.
- Sort by price, distance, or update date.
- View clinic details, contacts, hours, and source references.
- Export results to PDF or CSV.
- Save and reuse filter presets.
- Explore price history, map-based discovery, and “near me” flows.

### For operators / maintainers
- Ingest public data from multiple open sources.
- Keep a raw layer separate from normalized records.
- Deduplicate repeated runs.
- Normalize noisy service names into a canonical service catalog.
- Track stale data and hide or flag outdated prices.
- Keep the architecture extensible so new cities and sources can be added without redesigning the core.

---

## Feature tour

### Discovery
- Global search with popular query suggestions.
- Fast filters for common use cases such as blood tests, MRI, ultrasound, dentist visits, vaccines, and doctor appointments.
- Responsive layout for desktop and mobile.

### Comparison
- Price comparison across clinics.
- Distance-aware browsing where location is available.
- Sorting by affordability, freshness, and proximity.

### Transparency
- Source links for each clinic/service record.
- Last-updated context so users can judge freshness.
- Public-data-only approach with no patient personal data collection.

### Power-user workflow
- PDF export.
- CSV export.
- Saved presets for frequent searches.
- Command palette navigation.
- Price history / trend exploration.
- Admin entry point for internal workflows.

---

## Architecture overview

The system is built around a simple but scalable pipeline:

```text
Public clinic sources
   ↓
Raw ingestion layer
   ↓
Normalization / deduplication / catalog matching
   ↓
Database
   ↓
Search, comparison, filters, exports, history views
   ↓
User interface
```

### Data model goals
The hackathon brief expects the project to store structured entities such as clinics, services, prices, timestamps, source URLs, and normalization status. It also expects a raw layer, a normalized layer, and a service dictionary with synonyms and categories.

### Operational goals
- Source failures must not stop the whole ingestion pipeline.
- Pricing data should remain transparent and auditable.
- The product should scale to new sources without reworking the core UX.

---

## Technology stack

The repository is a **Next.js + TypeScript** project with Prisma, Bun scripts, and a modern UI stack. The dependency set includes React 19, TanStack Query/Table, Leaflet / React Leaflet, Framer Motion, cmdk, Recharts, NextAuth, next-intl, Zod, Zustand, and Tailwind-compatible styling utilities. The repository also contains `app/`, `src/`, `db/`, `prisma/`, and `public/` directories, plus scripts for development, build, start, linting, and Prisma database operations.

### Core stack
- **Frontend:** Next.js, React, TypeScript
- **Styling:** Tailwind CSS, shadcn/ui ecosystem
- **Data layer:** Prisma
- **State / data fetching:** Zustand, TanStack Query
- **Tables / interactions:** TanStack Table, dnd-kit, cmdk
- **Maps / charts:** Leaflet, Recharts
- **Auth / i18n:** NextAuth, next-intl
- **Animation:** Framer Motion
- **Runtime / scripts:** Bun

---

## Repository structure

```text
app/        App Router pages and route-level UI
src/        Shared components, hooks, utilities, and store code
db/         Local database files / storage
prisma/     Prisma schema and database layer configuration
public/     Static assets
examples/   Example websocket-related assets
```

---

## Getting started

### Prerequisites
- Bun
- A compatible Node.js environment for Next.js tooling
- A local database file or a valid `DATABASE_URL`

### 1) Install dependencies

```bash
bun install
```

### 2) Configure environment variables

Create a local `.env` file from `.env.example` and set the database connection.

Example:

```bash
DATABASE_URL=file:DB_LOCATION
```

### 3) Run the app locally

```bash
bun run dev
```

The development server runs on port `3000`.

### 4) Build for production

```bash
bun run build
```

### 5) Start the production server

```bash
bun run start
```

---

## Available scripts

```bash
bun run dev         # Start the Next.js dev server
bun run build       # Build the production bundle
bun run start       # Start the standalone production server
bun run lint        # Run ESLint
bun run db:push     # Push Prisma schema changes
bun run db:generate # Generate Prisma Client
bun run db:migrate  # Run Prisma migrations
bun run db:reset    # Reset the local database
```

---

## Data sources and product policy

MedServicePrice.kz is designed for **open, public, non-authenticated** clinic data only.

The project brief calls for support for common open formats such as HTML, PDF, DOCX, and Excel, with source-by-source resilience, deduplication, logging, raw-data retention, and daily freshness expectations. It also emphasizes transparent source attribution and a service catalog that can normalize equivalent service names such as local abbreviations, full Russian names, and English variants into a single canonical service.

### Important usage note
Prices shown on the platform are indicative and sourced from public clinic information. Users should always confirm the final cost, availability, and appointment details directly with the clinic before visiting.

---

## Hackathon requirements this project targets

- Public price aggregation for medical services in Kazakhstan.
- Minimum viable search and comparison UX.
- Normalized service dictionary.
- Raw + normalized data separation.
- Deduplication and error logging.
- Filters, sorting, and transparency around freshness.
- Extensible architecture for additional cities and sources.

---

## Roadmap ideas

- More cities and clinic sources across Kazakhstan.
- Better service synonym matching and unmatched-queue tooling.
- Automated freshness monitoring and stale-price alerts.
- Price-change subscriptions.
- Clinic and service comparison tables.
- Search relevance improvements and richer ranking signals.
- More granular analytics for source quality and coverage.

---

## License

MIT

---

## Acknowledgements

Built for the MedTech hackathon case.

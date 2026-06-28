# MedServicePrice.kz

MedServicePrice.kz is a medical service price aggregator for Kazakhstan. It helps users search, compare, and track prices for analyses, doctor visits, diagnostics, and related services across clinics in one place.

## Demo

- Production: https://m1wce5cu8p40-d.space-z.ai
- Backup mirror: https://preview-chat-574bbfd4-6988-47e0-84af-b4f57ece9813.space-z.ai

## What this project does

The MVP is built around the hackathon brief for MedServicePrice.kz: aggregate public clinic price data, normalize service names into a shared catalog, and provide a clear comparison experience for patients. The brief calls for support of multiple open data formats, deduplication, error logging, a raw data layer, normalization, and a user-facing search/comparison interface with filters and sorting.

## Key features

- Service search with fast lookup and popular query shortcuts
- Price comparison across clinics
- City, category, rating, price range, online booking, and freshness filters
- Sorting by price, distance, or update date
- Clinic cards with address, contacts, hours, and source links
- Price history tracking
- Map view
- Saved filter presets
- Export to PDF and CSV
- Admin section
- Command palette for quick navigation

## Tech stack

This repo is a Next.js application written in TypeScript. The project uses Prisma for database access and Bun-based scripts for development and production startup. The repository also includes Tailwind CSS / shadcn-style frontend structure and a `DATABASE_URL` example in `.env.example`.

## Project structure

```text
app/        App Router pages and UI entry points
src/        Shared components, hooks, lib, and store code
db/         Local database file / storage
prisma/     Prisma schema and data layer setup
public/     Static assets
```

## Getting started

### Prerequisites

- Bun
- Node.js compatible environment for Next.js tooling
- A local database file or database connection matching `DATABASE_URL`

### Environment variables

Create a `.env` file from the example:

```bash
DATABASE_URL=file:DB_LOCATION
```

### Install dependencies

```bash
bun install
```

### Run locally

```bash
bun run dev
```

The development server runs on port `3000`.

### Build for production

```bash
bun run build
```

### Start production build

```bash
bun run start
```

## Available scripts

- `dev` — start the Next.js development server
- `build` — build the production bundle
- `start` — run the standalone server
- `lint` — run ESLint
- `db:push` — push Prisma schema changes
- `db:generate` — generate Prisma client
- `db:migrate` — run Prisma migrations
- `db:reset` — reset the local database

## Data and product notes

The hackathon brief expects the system to work with public clinic data only, store raw and normalized layers separately, and keep the architecture extensible so new sources can be added without changing the core. It also emphasizes freshness, transparency, and avoiding stale prices in the UI.

## License

MIT

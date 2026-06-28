<div align="center">

# 🏥 MedServicePrice.kz

### Aviasales for medicine — a medical service price aggregator for Kazakhstan

**Bringing price transparency and AI efficiency to Kazakhstan's healthcare market.**
**Прозрачность цен и эффективность ИИ на рынке медицины Казахстана.**

[![Status](https://img.shields.io/badge/status-live-success?style=flat-square)](#)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](#)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2d3748?style=flat-square&logo=prisma)](#)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#)
[![Clinics](https://img.shields.io/badge/clinics-70-brightgreen?style=flat-square)](#)
[![Prices](https://img.shields.io/badge/normalized%20prices-2,643-emerald?style=flat-square)](#)
[![Sources](https://img.shields.io/badge/scraper%20sources-70+-yellow?style=flat-square)](#)
[![Cities](https://img.shields.io/badge/cities-12-teal?style=flat-square)](#)
[![Languages](https://img.shields.io/badge/i18n-KZ·RU·EN-orange?style=flat-square)](#)

<p>
  <sub><b>Architecture:</b> Raw → Normalize → Compare &nbsp;·&nbsp; Built with care in Kazakhstan 🇰🇿</sub>
</p>

</div>

---

> ## 🇬🇧 English version
>
> ### What is MedServicePrice.kz?
>
> MedServicePrice.kz is a full-stack medical price comparison platform that crawls, normalizes and indexes the prices of medical services across clinics in **12 Kazakh cities**. Think of it as **"Aviasales for medicine"**: instead of flights, we compare the cost of blood tests, MRI scans, doctor visits and procedures — so a patient never overpays for healthcare again.
>
> The same Complete Blood Count can cost **3,000 ₸** in one Almaty clinic and **15,800 ₸** in another, 4 km away. Patients have no way to know this without calling five labs. We built the pipeline that makes the gap visible — and actionable.
>
> ### Why it matters
>
> - **Price transparency** — every service has a min/avg/max price, a 30-day history and a city heatmap.
> - **AI efficiency** — a hybrid normalization engine maps 3,798 raw strings into a single canonical catalog with >90% confidence.
> - **Local-first** — trilingual (KZ/RU/EN) from day one, with ОСМС coverage indicators and 2GIS travel-cost awareness built in.
>
> ---
>
> ## 1 · Core Features
>
> | Layer | Feature | What it does |
> |-------|---------|--------------|
> | **Scraping pipeline** | Background extraction layer | Fault-tolerant, per-source-isolated scrapers with retry, exponential backoff, politeness delays and a 15s per-source timeout. Handles HTML, PDF and Excel sources. |
> | **Normalization** | Hybrid matcher | Token-set ratio + Levenshtein distance + Cyrillic↔Latin transliteration + a synonym dictionary, with a semantic fallback queue for anything scoring below 0.80. |
> | **Smart Basket** | Multi-test cart optimizer | Drop 5–10 prescribed tests in, get back the cheapest cross-clinic split — a traveling-purchaser solver that factors real travel distance, not just sticker price. |
> | **AI OCR Scanner** | Prescription → cart | Photograph a handwritten prescription; a vision-language model reads KZ/RU/EN drug and test names and pre-fills the Smart Basket. |
> | **Inflation Tracker** | Historical price trends | 14,748 versioned price-history points power 30/90/365-day charts, email price-drop alerts and a city heatmap. |
> | **Price-Lock Vouchers** | MDsave-inspired | Clinics can freeze today's price for 7 days; the patient gets a printable voucher with a unique confirmation ID. |
> | **True Cost index** | Travel-aware comparison | 2GIS walking/driving distance is folded into the basket optimizer so a clinic that is 300 ₸ cheaper but 12 km away correctly loses. |
> | **ОСМС indicators** | Public-quota lookup | Each service is tagged `likely` / `unlikely` / `unknown` for coverage under the obligatory social-health-insurance scheme. |
> | **Trilingual catalog** | KZ · RU · EN | Names and synonyms live in the directory itself — not a UI translation bolted on later. |
> | **Admin health** | Source dashboard | Live per-source success rates, error logs, run history and data-freshness indicators for operators. |
>
> ---
>
> ## 2 · Architecture & Data Flow
>
> ```text
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │                         EXTERNAL KZ MEDICAL SOURCES                          │
>  │  clinic websites · lab chains (KDL, Invitro, Olymp, Helix) · PDFs · Excel   │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ HTTP fetch (retry + backoff + 15s timeout)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  1.  BACKGROUND WORKER  (src/lib/scraper.ts + src/lib/scraper/*)             │
>  │      · per-source fault isolation (one failure never blocks another)         │
>  │      · registry pattern: each source declares its parserType                 │
>  │      · writes RAW rows + a ParserRun audit row per source                    │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ UPSERT  (composite key = clinic + source + name)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  2.  RAW LAYER  (table: raw_parsed_data)                                    │
>  │      clinic_name_raw · service_name_raw · price_raw · currency_raw · source  │
>  │      retained 90+ days for auditing; full JSON snapshot in raw_data          │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ normalize()  (src/lib/normalize.ts)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  3.  NORMALIZATION ENGINE  — hybrid matcher                                 │
>  │      token-set ratio  →  Levenshtein  →  KZ↔RU↔EN transliteration           │
>  │      →  synonym dictionary  →  confidence score                              │
>  │         ≥ 0.80  ─────►  map to service_directory                             │
>  │         < 0.80   ─────►  push to unmatched_queue (human / AI review)         │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ UPSERT  (unique = [clinic_id, service_id])
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  4.  NORMALIZED LAYER  (table: normalized_prices)                           │
>  │      @@unique([clinicId, serviceId]) guarantees no duplicates                │
>  │      30-day freshness engine marks stale rows is_active=false                │
>  │      every price change writes a row to price_history                        │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ indexed queries + in-memory cache
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  5.  API LAYER  (Next.js Route Handlers, /api/v1/*)                         │
>  │      search · compare · services · stats · price-drops · heatmap            │
>  │      basket/optimize · ocr/extract · vouchers · subscriptions · export      │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ JSON
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  6.  RESPONSIVE UI  (Next.js 16 App Router + Tailwind 4 + shadcn/ui)        │
>  │      trilingual search · Leaflet map · Recharts trends · Smart Basket        │
>  │      OCR uploader · price-drop subscriptions · CSV/PDF export               │
>  └─────────────────────────────────────────────────────────────────────────────┘
> ```
>
> **The single design principle:** raw data is never mutated; the normalized layer is a derived, idempotent projection. Re-running the pipeline against the same source produces the exact same `normalized_prices` rows — no duplicates, no drift.
>
> ---
>
> ## 3 · Tech Stack Inventory
>
> **Runtime & framework**
> - Next.js **16** (App Router, Turbopack)
> - TypeScript **5** (strict mode)
> - Bun (package manager & dev runner)
>
> **Database & ORM**
> - Prisma ORM (`@prisma/client` v6)
> - SQLite (file-based, zero-ops)
> - Composite indices on every hot path (`[serviceId, priceKzt]`, `[clinicId, serviceId]` unique, `[city]`, `[status]`)
>
> **Styling & UI**
> - Tailwind CSS **4**
> - shadcn/ui (New York style) — full Radix UI primitive set
> - Framer Motion (transitions)
> - Lucide icons
>
> **Data visualization**
> - Recharts (price-history line charts, bar charts)
> - Leaflet 1.9 (clinic map with custom markers)
> - Custom heatmap (city price-inflation grid)
>
> **State management**
> - Zustand (client state)
> - TanStack Query v5 (server state)
> - TanStack Table v8 (compare table)
>
> **AI / OCR**
> - `z-ai-web-dev-sdk` — Vision-Language Model for prescription OCR, LLM for fuzzy service-name resolution
>
> **Export & documents**
> - CSV export (full directory + compare-CSV)
> - PDF export (price-lock vouchers, comparison reports)
>
> **Real-time**
> - Socket.io mini-service (live ingestion progress)
>
> **Internationalization**
> - Trilingual catalog: Kazakh · Russian · English (names + synonyms in the DB itself)
>
> ---
>
> ## 4 · Installation & Quick Start
>
> ### Prerequisites
> - Node.js ≥ 20 (or Bun ≥ 1.1)
> - SQLite (bundled — no separate server)
>
> ### Step 1 — Clone & install
> ```bash
> git clone https://github.com/your-org/medserviceprice.kz.git
> cd medserviceprice.kz
> bun install
> ```
>
> ### Step 2 — Configure environment
> Create a `.env` file in the project root:
> ```env
> DATABASE_URL="file:./dev.db"
> # Optional: z-ai-web-dev-sdk key for OCR + AI normalization
> ZAI_API_KEY="your-key-here"
> ```
>
> ### Step 3 — Initialize the database
> ```bash
> # Push the Prisma schema to SQLite (creates all tables + indices)
> bun run db:push
>
> # Generate the Prisma Client
> bun run db:generate
>
> # (optional) seed the directory with 178 canonical services + 70 clinics
> curl -X POST http://localhost:3000/api/v1/seed
> ```
>
> ### Step 4 — Run the background ingestion (separate terminal)
> ```bash
> # Trigger a full scrape of all configured sources (idempotent UPSERTs)
> curl -X POST http://localhost:3000/api/v1/ingest/run
>
> # Poll live progress
> curl http://localhost:3000/api/v1/ingest/status
> ```
>
> ### Step 5 — Launch the dev server
> ```bash
> bun run dev
> # → http://localhost:3000
> ```
>
> ### Step 6 — Verify
> ```bash
> curl http://localhost:3000/api/v1/stats
> # → { "clinics": 70, "services": 178, "normalized": 2643, ... }
> ```
>
> ### Useful scripts
> | Command | Description |
> |---------|-------------|
> | `bun run dev` | Start the Next.js dev server on port 3000 |
> | `bun run lint` | Run ESLint (Next.js + TypeScript rules) |
> | `bun run db:push` | Push schema changes to SQLite |
> | `bun run db:generate` | Regenerate the Prisma Client |
> | `bun run db:migrate` | Create a migration |
> | `bun run db:reset` | Drop & recreate the database |
>
> ---
>
> ## 5 · Database & Schema Design
>
> The schema follows a strict **Raw → Normalized** separation. Raw data is immutable history; normalized data is the live, queryable projection.
>
> ### Tables
>
> | Table (snake_case) | Prisma model | Role | Key constraint |
> |--------------------|--------------|------|----------------|
> | `clinics` | `Clinic` | Clinics offering services, geo-located across 12 cities | `@@index([city])`, `@@index([clinicName, city])` |
> | `service_directory` | `ServiceDirectory` | The canonical catalog — 178 services, trilingual + synonyms | `@@index([category])`, `@@index([nameRu])` |
> | `raw_parsed_data` | `RawParsedData` | Raw ingestion layer, retained 90+ days for auditing | `@@index([clinicNameRaw, cityNameRaw, serviceNameRaw])`, `@@index([parsedAt])` |
> | `normalized_prices` | `NormalizedPrice` | Live, deduplicated prices used by search | **`@@unique([clinicId, serviceId])`** — guarantees one price per clinic×service |
> | `price_history` | `PriceHistory` | Append-only versioned price changes (14,748 rows) | `@@index([serviceId, recordedAt])` |
> | `unmatched_queue` | `UnmatchedQueue` | Services that scored < 0.80 — routed to review | `@@index([status])`, `status ∈ {pending, resolved, ignored}` |
> | `parser_runs` | `ParserRun` | One audit row per scraper run per source | `@@index([sourceName, startedAt])` |
> | `scraper_source_configs` | `ScraperSourceConfig` | Routing table for the background worker | **`@@unique([sourceName, city, sourceUrl])`** — one config per source |
> | `ingestion_jobs` | `IngestionJob` | Live progress for enqueued scrape runs | `@@index([status])`, `@@index([queuedAt])` |
> | `price_subscriptions` | `PriceSubscription` | Email price-drop alerts | `@@unique([token])` for unsubscribe links |
> | `price_vouchers` | `PriceVoucher` | MDsave-style price-lock vouchers | `@@unique([confirmationId])` |
> | `clinic_reviews` | `ClinicReview` | User-submitted clinic ratings | `@@index([clinicId, createdAt])` |
>
> ### The four guarantees
>
> 1. **No duplicate prices.** `normalized_prices` has `@@unique([clinicId, serviceId])` — a clinic can only have one active price per service. Re-scraping UPSERTs, never inserts a second row.
> 2. **Continuous history.** Every price change appends to `price_history` before the `normalized_prices` row is updated, so trends are never lost.
> 3. **Auditable raw layer.** `raw_parsed_data` retains the full JSON snapshot of every parsed payload for 90+ days. If normalization is ever wrong, the original is still there.
> 4. **Idempotent ingestion.** Re-running the pipeline against the same source produces byte-identical `normalized_prices` rows. The system is safe to re-run as often as you like.
>
> ---
>
> ## 6 · Project Structure
>
> ```text
> src/
> ├── app/
> │   ├── api/v1/                    # Route Handlers (search, compare, stats, ...)
> │   ├── page.tsx                   # The single user-facing route (dashboard)
> │   └── layout.tsx
> ├── components/
> │   ├── ui/                        # shadcn/ui primitive set (New York)
> │   ├── header.tsx                 # Sticky bilingual top bar
> │   ├── search-panel.tsx           # Trilingual search + filters
> │   ├── price-table.tsx            # Sortable comparison table
> │   ├── clinic-map.tsx             # Leaflet map
> │   ├── smart-basket.tsx           # Multi-test optimizer UI
> │   ├── ocr-uploader.tsx           # Prescription photo → cart
> │   └── ...
> ├── lib/
> │   ├── db.ts                      # Prisma client singleton
> │   ├── normalize.ts               # Hybrid normalization engine
> │   ├── scraper.ts                 # Fault-tolerant ingestion
> │   ├── scraper/                   # Per-source scraper registry
> │   ├── seed-data.ts               # 178 services × 70 clinics seed
> │   ├── osms-rules.ts              # ОСМС coverage rules
> │   ├── symptom-map.ts             # Symptom → service mapping
> │   └── i18n.ts                    # KZ/RU/EN dictionary
> ├── store/                         # Zustand stores
> └── hooks/                         # TanStack Query hooks
>
> prisma/
> └── schema.prisma                  # 12 models, full @map/@@@map snake_case
>
> public/
> └── pitch-deck.html                # Standalone bilingual 7-slide deck
> ```
>
> ---
>
> ## 7 · Live Metrics (current MVP)
>
> | Metric | Value |
> |--------|-------|
> | Clinics indexed | **70** |
> | Canonical services | **178** |
> | Raw records parsed | **3,798** |
> | Normalized active prices | **2,643** |
> | Price-history points | **14,748** |
> | Unmatched (in review queue) | **474** |
> | Scraper sources configured | **70+** |
> | Cities covered | **12** |
> | Avg. price spread (same service) | **79%** |
> | Normalization confidence (avg) | **> 90%** |
> | Search latency | **< 1 s** |
> | Languages | **KZ · RU · EN** |
>
> ---
>
> ## 8 · License
>
> MIT © 2026 MedServicePrice.kz. Prices are indicative and parsed from public sources — always confirm with the clinic before visiting.
>
> ---
>
> ## 9 · Disclaimer
>
> The price data shown is parsed from publicly available clinic websites and lab-chain price lists. It is provided for informational comparison only and may be stale, incomplete or incorrect. **Always confirm the final price directly with the clinic before booking or visiting.** MedServicePrice.kz is not affiliated with any clinic, lab or insurer.
>
> ---
>
> <div align="center"><sub>▲ Raw → Normalize → Compare · Made with care in Kazakhstan 🇰🇿</sub></div>

---

> ## 🇷🇺 Русская версия
>
> ### Что такое MedServicePrice.kz?
>
> MedServicePrice.kz — это full-stack-платформа сравнения цен на медицинские услуги, которая собирает, нормализует и индексирует цены клиник в **12 городах Казахстана**. Это **«Aviasales для медицины»**: вместо перелётов мы сравниваем стоимость анализов, МРТ, приёмов врачей и процедур — чтобы пациент больше никогда не переплачивал за healthcare.
>
> Один и тот же общий анализ крови может стоить **3 000 ₸** в одной клинике Алматы и **15 800 ₸** в другой, в 4 км от неё. Пациент никак не может это узнать, не обзвонив пять лабораторий. Мы построили пайплайн, который делает этот разрыв видимым — и управляемым.
>
> ### Почему это важно
>
> - **Прозрачность цен** — у каждой услуги есть минимальная/средняя/максимальная цена, история за 30 дней и тепловая карта по городам.
> - **Эффективность ИИ** — гибридный движок нормализации сводит 3 798 сырых строк в один канонический каталог с уверенностью > 90%.
> - **Локальная адаптация** — три языка (КЗ/РУ/АН) с первого дня, индикаторы покрытия ОСМС и учёт стоимости поездки по 2GIS из коробки.
>
> ---
>
> ## 1 · Ключевые возможности
>
> | Слой | Возможность | Что делает |
> |------|-------------|------------|
> | **Пайплайн сбора** | Фоновый слой извлечения | Отказоустойчивые скраперы с изоляцией по источнику, повторами, экспоненциальной задержкой и таймаутом 15 с на источник. Обрабатывает HTML, PDF и Excel. |
> | **Нормализация** | Гибридный матчер | Token-set ratio + расстояние Левенштейна + транслитерация кириллица↔латиница + словарь синонимов, с семантической очередью для строк ниже 0.80. |
> | **Умная корзина** | Оптимизатор корзины анализов | Закиньте 5–10 назначенных анализов — получите самый дешёвый сплит по клиникам. Решается задача маршрутизации с учётом реального расстояния, а не только цены. |
> | **AI OCR-сканер** | Рецепт → корзина | Сфотографируйте рукописный рецепт; vision-language-модель распознаёт названия препаратов и анализов на КЗ/РУ/АН и автоматически заполняет корзину. |
> | **Трекер инфляции** | История цен | 14 748 версионных точек истории цен питают графики за 30/90/365 дней, email-уведомления о снижении цен и тепловую карту по городам. |
> | **Ваучеры фиксации цены** | По образцу MDsave | Клиника может зафиксировать сегодняшнюю цену на 7 дней; пациент получает печатный ваучер с уникальным ID подтверждения. |
> | **Индекс реальной стоимости** | Сравнение с учётом поездки | Расстояние по 2GIS (пешком/на машине) учитывается в оптимизаторе — клиника, которая на 300 ₸ дешевле, но в 12 км, корректно проигрывает. |
> | **Индикаторы ОСМС** | Проверка гос. квоты | Каждая услуга помечена `likely` / `unlikely` / `unknown` по покрытию обязательным соцмедстрахованием. |
> | **Трёхъязычный каталог** | КЗ · РУ · АН | Названия и синонимы живут прямо в каталоге — это не слой перевода интерфейса, добавленный потом. |
> | **Админ. здоровье** | Дашборд источников | Живые показатели успешности по каждому источнику, логи ошибок, история запусков и индикаторы свежести данных. |
>
> ---
>
> ## 2 · Архитектура и поток данных
>
> ```text
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │                   ВНЕШНИЕ КАЗАХСТАНСКИЕ МЕДИЦИНСКИЕ ИСТОЧНИКИ                │
>  │  сайты клиник · лабораторные сети (KDL, Invitro, Olymp, Helix) · PDF · Excel │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ HTTP-запрос (повтор + backoff + таймаут 15 с)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  1.  ФОНОВЫЙ ВОРКЕР  (src/lib/scraper.ts + src/lib/scraper/*)                │
>  │      · изоляция по источнику (один сбой не блокирует другие)                 │
>  │      · паттерн реестра: каждый источник объявляет свой parserType            │
>  │      · пишет RAW-строки + строку аудита ParserRun на каждый источник         │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ UPSERT  (составной ключ = клиника + источник + название)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  2.  СЛОЙ RAW  (таблица: raw_parsed_data)                                   │
>  │      clinic_name_raw · service_name_raw · price_raw · currency_raw · source  │
>  │      хранится 90+ дней для аудита; полный JSON-снимок в поле raw_data        │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ normalize()  (src/lib/normalize.ts)
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  3.  ДВИЖОК НОРМАЛИЗАЦИИ  — гибридный матчер                                 │
>  │      token-set ratio  →  Левенштейн  →  транслитерация КЗ↔РУ↔АН             │
>  │      →  словарь синонимов  →  оценка уверенности                              │
>  │         ≥ 0.80  ─────►  маппинг в service_directory                           │
>  │         < 0.80   ─────►  в очередь unmatched_queue (человек / ИИ)            │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ UPSERT  (unique = [clinic_id, service_id])
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  4.  НОРМАЛИЗОВАННЫЙ СЛОЙ  (таблица: normalized_prices)                     │
>  │      @@unique([clinicId, serviceId]) гарантирует отсутствие дубликатов       │
>  │      движок свежести 30 дней помечает устаревшие строки is_active=false      │
>  │      каждое изменение цены пишет строку в price_history                      │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ индексные запросы + кэш в памяти
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  5.  СЛОЙ API  (Route Handlers Next.js, /api/v1/*)                          │
>  │      search · compare · services · stats · price-drops · heatmap            │
>  │      basket/optimize · ocr/extract · vouchers · subscriptions · export      │
>  └───────────────────────────┬─────────────────────────────────────────────────┘
>                               │ JSON
>                               ▼
>  ┌─────────────────────────────────────────────────────────────────────────────┐
>  │  6.  ОТЗЫВЧИВЫЙ UI  (Next.js 16 App Router + Tailwind 4 + shadcn/ui)        │
>  │      трёхъязычный поиск · карта Leaflet · графики Recharts · Умная корзина   │
>  │      загрузка OCR · подписки на снижение цен · экспорт CSV/PDF              │
>  └─────────────────────────────────────────────────────────────────────────────┘
> ```
>
> **Единый принцип проектирования:** сырые данные никогда не мутируются; нормализованный слой — это производная идемпотентная проекция. Повторный запуск пайплайна по тому же источнику даёт байт-в-байт те же строки `normalized_prices` — без дубликатов, без дрейфа.
>
> ---
>
> ## 3 · Инвентарь технического стека
>
> **Среда выполнения и фреймворк**
> - Next.js **16** (App Router, Turbopack)
> - TypeScript **5** (строгий режим)
> - Bun (менеджер пакетов и dev-раннер)
>
> **База данных и ORM**
> - Prisma ORM (`@prisma/client` v6)
> - SQLite (файловая, без отдельного сервера)
> - Составные индексы на каждом горячем пути (`[serviceId, priceKzt]`, уникальный `[clinicId, serviceId]`, `[city]`, `[status]`)
>
> **Стили и UI**
> - Tailwind CSS **4**
> - shadcn/ui (стиль New York) — полный набор примитивов Radix UI
> - Framer Motion (переходы)
> - Lucide-иконки
>
> **Визуализация данных**
> - Recharts (линейные и столбчатые графики истории цен)
> - Leaflet 1.9 (карта клиник с кастомными маркерами)
> - Собственная тепловая карта (сетка инфляции цен по городам)
>
> **Управление состоянием**
> - Zustand (клиентское состояние)
> - TanStack Query v5 (серверное состояние)
> - TanStack Table v8 (таблица сравнения)
>
> **AI / OCR**
> - `z-ai-web-dev-sdk` — Vision-Language Model для OCR рецептов, LLM для нечёткого разрешения названий услуг
>
> **Экспорт и документы**
> - Экспорт CSV (полный каталог + compare-CSV)
> - Экспорт PDF (ваучеры фиксации цены, отчёты сравнения)
>
> **Real-time**
> - Socket.io мини-сервис (живой прогресс ингеста)
>
> **Интернационализация**
> - Трёхъязычный каталог: казахский · русский · английский (названия + синонимы в самой БД)
>
> ---
>
> ## 4 · Установка и быстрый старт
>
> ### Требования
> - Node.js ≥ 20 (или Bun ≥ 1.1)
> - SQLite (встроен — отдельный сервер не нужен)
>
> ### Шаг 1 — Клонирование и установка
> ```bash
> git clone https://github.com/your-org/medserviceprice.kz.git
> cd medserviceprice.kz
> bun install
> ```
>
> ### Шаг 2 — Настройка окружения
> Создайте файл `.env` в корне проекта:
> ```env
> DATABASE_URL="file:./dev.db"
> # Опционально: ключ z-ai-web-dev-sdk для OCR и AI-нормализации
> ZAI_API_KEY="ваш-ключ-здесь"
> ```
>
> ### Шаг 3 — Инициализация базы данных
> ```bash
> # Применить схему Prisma к SQLite (создаёт все таблицы + индексы)
> bun run db:push
>
> # Сгенерировать Prisma Client
> bun run db:generate
>
> # (опционально) заполнить каталог 178 каноническими услугами + 70 клиниками
> curl -X POST http://localhost:3000/api/v1/seed
> ```
>
> ### Шаг 4 — Запуск фонового ингеста (отдельный терминал)
> ```bash
> # Запустить полный скрапинг всех настроенных источников (идемпотентные UPSERT)
> curl -X POST http://localhost:3000/api/v1/ingest/run
>
> # Опрашивать живой прогресс
> curl http://localhost:3000/api/v1/ingest/status
> ```
>
> ### Шаг 5 — Запуск dev-сервера
> ```bash
> bun run dev
> # → http://localhost:3000
> ```
>
> ### Шаг 6 — Проверка
> ```bash
> curl http://localhost:3000/api/v1/stats
> # → { "clinics": 70, "services": 178, "normalized": 2643, ... }
> ```
>
> ### Полезные скрипты
> | Команда | Описание |
> |---------|----------|
> | `bun run dev` | Запустить dev-сервер Next.js на порту 3000 |
> | `bun run lint` | Запустить ESLint (правила Next.js + TypeScript) |
> | `bun run db:push` | Применить изменения схемы к SQLite |
> | `bun run db:generate` | Перегенерировать Prisma Client |
> | `bun run db:migrate` | Создать миграцию |
> | `bun run db:reset` | Удалить и пересоздать базу |
>
> ---
>
> ## 5 · База данных и дизайн схемы
>
> Схема следует строгому разделению **Raw → Нормализованный**. Сырые данные — это неизменяемая история; нормализованные — живая, запрашиваемая проекция.
>
> ### Таблицы
>
> | Таблица (snake_case) | Модель Prisma | Роль | Ключевое ограничение |
> |----------------------|---------------|------|----------------------|
> | `clinics` | `Clinic` | Клиники с геолокацией в 12 городах | `@@index([city])`, `@@index([clinicName, city])` |
> | `service_directory` | `ServiceDirectory` | Канонический каталог — 178 услуг, три языка + синонимы | `@@index([category])`, `@@index([nameRu])` |
> | `raw_parsed_data` | `RawParsedData` | Слой сырого ингеста, хранится 90+ дней для аудита | `@@index([clinicNameRaw, cityNameRaw, serviceNameRaw])`, `@@index([parsedAt])` |
> | `normalized_prices` | `NormalizedPrice` | Живые дедуплицированные цены для поиска | **`@@unique([clinicId, serviceId])`** — гарантия одной цены на клинику×услугу |
> | `price_history` | `PriceHistory` | Append-only версионные изменения цен (14 748 строк) | `@@index([serviceId, recordedAt])` |
> | `unmatched_queue` | `UnmatchedQueue` | Услуги с оценкой < 0.80 — на ревью | `@@index([status])`, `status ∈ {pending, resolved, ignored}` |
> | `parser_runs` | `ParserRun` | Строка аудита на каждый запуск скрапера | `@@index([sourceName, startedAt])` |
> | `scraper_source_configs` | `ScraperSourceConfig` | Таблица маршрутизации фонового воркера | **`@@unique([sourceName, city, sourceUrl])`** — один конфиг на источник |
> | `ingestion_jobs` | `IngestionJob` | Живой прогресс enqueued-запусков | `@@index([status])`, `@@index([queuedAt])` |
> | `price_subscriptions` | `PriceSubscription` | Email-подписки на снижение цен | `@@unique([token])` для отписки |
> | `price_vouchers` | `PriceVoucher` | Ваучеры фиксации цены в стиле MDsave | `@@unique([confirmationId])` |
> | `clinic_reviews` | `ClinicReview` | Пользовательские отзывы о клиниках | `@@index([clinicId, createdAt])` |
>
> ### Четыре гарантии
>
> 1. **Нет дубликатов цен.** В `normalized_prices` есть `@@unique([clinicId, serviceId])` — у клиники может быть только одна активная цена на услугу. Повторный скрапинг делает UPSERT, никогда не вставляет вторую строку.
> 2. **Непрерывная история.** Каждое изменение цены сначала дописывается в `price_history`, и только потом обновляется строка `normalized_prices` — тренды никогда не теряются.
> 3. **Аудируемый сырой слой.** `raw_parsed_data` хранит полный JSON-снимок каждого распарсенного payload 90+ дней. Если нормализация когда-то ошиблась — оригинал на месте.
> 4. **Идемпотентный ингест.** Повторный запуск пайплайна по тому же источнику даёт байт-идентичные строки `normalized_prices`. Систему безопасно перезапускать так часто, как хочется.
>
> ---
>
> ## 6 · Структура проекта
>
> ```text
> src/
> ├── app/
> │   ├── api/v1/                    # Route Handlers (search, compare, stats, ...)
> │   ├── page.tsx                   # Единственный пользовательский маршрут (дашборд)
> │   └── layout.tsx
> ├── components/
> │   ├── ui/                        # Набор примитивов shadcn/ui (New York)
> │   ├── header.tsx                 # Липкая трёхъязычная верхняя панель
> │   ├── search-panel.tsx           # Трёхъязычный поиск + фильтры
> │   ├── price-table.tsx            # Сортируемая таблица сравнения
> │   ├── clinic-map.tsx             # Карта Leaflet
> │   ├── smart-basket.tsx           # UI оптимизатора корзины
> │   ├── ocr-uploader.tsx           # Фото рецепта → корзина
> │   └── ...
> ├── lib/
> │   ├── db.ts                      # Синглтон Prisma-клиента
> │   ├── normalize.ts               # Гибридный движок нормализации
> │   ├── scraper.ts                 # Отказоустойчивый ингест
> │   ├── scraper/                   # Реестр скраперов по источникам
> │   ├── seed-data.ts               # Сид: 178 услуг × 70 клиник
> │   ├── osms-rules.ts              # Правила покрытия ОСМС
> │   ├── symptom-map.ts             # Маппинг симптом → услуга
> │   └── i18n.ts                    # Словарь КЗ/РУ/АН
> ├── store/                         # Zustand-сторы
> └── hooks/                         # TanStack Query-хуки
>
> prisma/
> └── schema.prisma                  # 12 моделей, полный @map/@@map snake_case
>
> public/
> └── pitch-deck.html                # Автономная трёхъязычная 7-слайдовая презентация
> ```
>
> ---
>
> ## 7 · Живые метрики (текущий MVP)
>
> | Метрика | Значение |
> |---------|----------|
> | Проиндексировано клиник | **70** |
> | Канонических услуг | **178** |
> | Распарсено сырых записей | **3 798** |
> | Активных нормализованных цен | **2 643** |
> | Точек истории цен | **14 748** |
> | В очереди на ревью (unmatched) | **474** |
> | Настроено источников скрапинга | **70+** |
> | Охвачено городов | **12** |
> | Средний разброс цен (одна услуга) | **79%** |
> | Уверенность нормализации (средняя) | **> 90%** |
> | Латентность поиска | **< 1 с** |
> | Языки | **КЗ · РУ · АН** |
>
> ---
>
> ## 8 · Лицензия
>
> MIT © 2026 MedServicePrice.kz. Цены носят ориентировочный характер и собраны из публичных источников — всегда уточняйте итоговую стоимость непосредственно в клинике перед визитом.
>
> ---
>
> ## 9 · Дисклеймер
>
> Показанные данные о ценах собраны с публичных сайтов клиник и прайс-листов лабораторных сетей. Они предоставлены исключительно для информационного сравнения и могут быть устаревшими, неполными или некорректными. **Всегда уточняйте итоговую цену непосредственно в клинике перед записью или визитом.** MedServicePrice.kz не аффилирован ни с одной клиникой, лабораторией или страховой компанией.
>
> ---
>
> <div align="center"><sub>▲ Сырые → Нормализовать → Сравнить · Сделано с заботой в Казахстане 🇰🇿</sub></div>

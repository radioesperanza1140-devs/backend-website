# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Strapi 5 (v5.36.1) headless CMS backend for Radio Esperanza 1140, a radio station website. TypeScript, Node.js 20-24.x. Includes a Bold payment processor integration for handling donations via webhooks.

## Commands

```bash
npm run develop        # Start dev server with hot reload (port 1337)
npm run build          # Build the admin panel
npm run start          # Production start (no hot reload)
npm run seed:example   # Seed the database
```

Production rebuild is handled by `rebuild-strapi.sh` which runs on cPanel with Node 22, installs prod deps, builds, and restarts via `tmp/restart.txt`.

## Architecture

### Strapi API Pattern

Most API modules under `src/api/` use Strapi's factory pattern for auto-generated CRUD:

```typescript
// controllers, services, routes all follow this pattern:
import { factories } from '@strapi/strapi';
export default factories.createCoreController('api::resource.resource');
```

API collections: about-us, banner, contacto, donation, global, palabra-de-sabiduria, peticion, programation, promise, radio-player, testimonial.

### Bold Webhook (Custom Implementation)

The `src/api/bold-webhook/` module is the only non-standard API — it has custom controllers, services, routes, and types instead of using Strapi factories.

**Two endpoints:**
- `POST /api/bold-webhook` — Receives Bold payment events (no JWT auth, uses HMAC-SHA256 signature validation via `x-bold-signature` header)
- `POST /api/bold-webhook/get-signature` — Generates integrity hash for Bold Checkout client-side

**Flow:** Raw body middleware (`src/middlewares/bold-raw-body.ts`) captures request bytes before Strapi's body parser → controller validates signature → service extracts donation data → upserts donation record.

**Event mapping:** `SALE_APPROVED` → approved, `SALE_REJECTED` → rejected, `VOID_APPROVED` → voided, `VOID_REJECTED` → approved.

### Middleware Pipeline

Custom middleware `global::bold-raw-body` is inserted **before** `strapi::body` in `config/middleware.ts`. It only intercepts POST requests to `/api/bold-webhook` to preserve raw bytes for HMAC validation.

### Shared Components

Reusable content schemas in `src/components/shared/`: seo, media, quote, rich-text, slider.

## Database

- **Development:** SQLite (`.tmp/data.db`)
- **Production:** MySQL (`config/env/production/database.ts`), pool min=2/max=10

## Environment Variables

All secrets are in `.env` / `.env.production`. Key variables:
- `DATABASE_*` — DB connection params
- `BOLD_IDENTITY_KEY`, `BOLD_SECRET_KEY` — Bold payment integration
- `APP_KEYS`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` — Strapi security keys

## REST API Defaults

Configured in `config/api.ts`: default limit 25, max limit 100, count enabled.

## Language

Commit messages and some code comments are in Spanish. The project serves a Spanish-language radio station.

# Betcha

## Monolithic Next.js full-stack app

From the repository root:

```bash
npm install
npm run dev
```

This runs a single Next.js app that serves both UI pages and API routes.

## Environment

Copy `.env.example` to `.env.local` and set:

- `DATABASE_URL` for Postgres
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` for server-side Supabase access
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser auth

`NEXT_PUBLIC_API_URL` is optional and usually left blank to use same-origin `/api/*`.

## Scripts

- `npm run dev` — start full-stack app locally
- `npm run build` — production build
- `npm run start` — run production server
- `npm run migrate` — apply SQL schema in `server/migrations/001_create_tables.sql`
- `npm test` — resolve flow test

## API endpoints

- `POST /api/waitlist`
- `POST /api/markets/:id/resolve`
- `GET /api/health`

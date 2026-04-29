Backend prototype

Quick start:

1. Ensure Postgres is running and DATABASE_URL is set (default: postgres://localhost:5432/betcha_dev)
2. Install deps:

```bash
cd backend
npm install
```

3. Run migrations:

```bash
npm run migrate
```

4. Start server:

```bash
npm start
```

Endpoint of interest: `POST /api/markets/:id/resolve` with JSON body `{ "outcome": true }` and optional header `Idempotency-Key`.

Waitlist:

- Static page: `/waitlist` serves a simple signup form.
- API: `POST /api/waitlist` accepts `{ "email": "you@example.com", "name": "Optional name" }` and inserts into the `waitlist` table in Supabase.

Make sure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in the environment before starting the server.

Deployment notes — independent Vercel projects

Recommended: create a separate Vercel project for the backend and point its root to the `backend/` folder in the monorepo. This lets you configure environment variables and deploy the backend independently from the frontend.

Quick steps:

1. In Vercel, create a project -> Import Git Repository -> select the repo.
2. For the frontend project: set "Root Directory" to `frontend/`.
3. For the backend project: create another Vercel project for the same repo, set "Root Directory" to `backend/`.

Environment variables for the backend project (Vercel > Project Settings > Environment Variables):
- `DATABASE_URL` — Postgres connection string (if using direct Postgres)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` — for Supabase client usage (optional)
- `FRONTEND_URL` — the frontend origin (used for CORS)

CORS and auth:
- The backend will use `FRONTEND_URL` to set allowed origin; in dev it falls back to allowing all.

Serverless architecture:
- The `POST /api/markets/:id/resolve` endpoint is now available both as an Express route (local dev) and as a Vercel Serverless Function (`backend/api/markets/[id]/resolve.js`).
- Shared logic lives in `src/resolveHandler.js` so both Express and serverless use the same core logic.
- When deployed to Vercel, `vercel.json` configures the function runtime and environment variables.

Deploy from CLI:

```bash
cd backend
vercel --prod
```

The backend will deploy with:
- Serverless function at `POST /api/markets/:id/resolve` (native Vercel Functions)
- Express app still works locally and can be deployed to Render/Fly if preferred

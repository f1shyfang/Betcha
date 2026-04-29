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

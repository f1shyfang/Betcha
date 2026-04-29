# Betcha

## Run both frontend + backend

From the repository root:

```bash
npm install
npm run dev
```

This command loads variables from `.env.local`, starts the backend on `PORT` (default `3001`), and starts the Next.js frontend on `3000`.

If `3000` is already in use, set `FRONTEND_PORT` in `.env.local` and rerun `npm run dev`.

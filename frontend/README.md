# Hackerhouse frontend

Betcha prediction market frontend — built with Next.js.

## Run locally

```bash
cd frontend
npm install
npm run dev
```

The app runs at `http://localhost:3000` and calls the backend API at `http://localhost:5000` (configurable).

## Configuration

Create a `.env.local` file (copy from `.env.example`):

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your values:

```
# Backend API URL (point to your Express/Vercel backend)
NEXT_PUBLIC_API_URL=http://localhost:5000

# Supabase configuration (from your Supabase project settings)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

## API integration

- **`lib/supabase.js`** — Supabase client (auth, realtime)
- **`lib/api.js`** — Frontend API helpers for calling backend endpoints (`resolveMarket`, etc.)

Example usage in components:

```js
import { resolveMarket } from '../lib/api';

// In your component:
const handleResolve = async () => {
  const result = await resolveMarket(marketId, true, 'creator', 'outcome reason');
  console.log('Market resolved:', result);
};
```

## Deploy to Vercel

1. Create a new Vercel project pointing to `frontend/` root directory.
2. Set environment variables in Vercel Project Settings:
   - `NEXT_PUBLIC_API_URL` — your deployed backend URL (e.g., https://betcha-backend.vercel.app)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy:

```bash
cd frontend
vercel --prod
```

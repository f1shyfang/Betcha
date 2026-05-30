// Better Auth server instance (Neon-backed, cookie sessions).
// ESM module: better-auth ships ESM-only. Consumed by pages/api/auth/[...all].js
// and by API routes via `getUserFromRequest`.
import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const needsSsl = connectionString && /neon\.tech|sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

export const auth = betterAuth({
  database: pool,
  emailAndPassword: {
    enabled: true,
    // No email-verification flow wired up; let users in immediately.
    requireEmailVerification: false,
    minPasswordLength: 6,
  },
  databaseHooks: {
    user: {
      create: {
        // Mirror every new auth user into the domain `users` table, which is the
        // FK target for groups/markets/predictions/ledger. id stays identical.
        after: async (user) => {
          await pool.query(
            `INSERT INTO users (id, email, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (id) DO UPDATE
               SET email = EXCLUDED.email,
                   display_name = COALESCE(users.display_name, EXCLUDED.display_name)`,
            [user.id, user.email, user.name || null]
          );
        },
      },
    },
  },
});

// Replacement for the old Supabase `getUserFromRequest`. Reads the Better Auth
// session cookie off the incoming Node request.
export async function getUserFromRequest(req) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) return null;
    return { id: session.user.id, email: session.user.email };
  } catch (e) {
    console.warn('auth session error', e && e.message ? e.message : e);
    return null;
  }
}

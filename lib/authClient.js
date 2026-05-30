// Better Auth browser client. Replaces lib/supabase.js for auth.
// baseURL defaults to the current origin, so same-origin cookies just work.
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, getSession } = authClient;

export default authClient;

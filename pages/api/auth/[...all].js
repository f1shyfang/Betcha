// Better Auth catch-all handler (sign-up / sign-in / session / sign-out, etc.).
import { toNodeHandler } from 'better-auth/node';
import { auth } from '../../../lib/auth';

// Better Auth reads the raw request body itself.
export const config = { api: { bodyParser: false } };

export default toNodeHandler(auth);

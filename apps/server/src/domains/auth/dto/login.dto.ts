/**
 * POST /api/auth/login body. `password` stays optional on purpose: a body
 * without it is a wrong password (401), not a malformed request — the login
 * page may submit before anything is typed.
 */

import { z } from "zod";

export const LOGIN_BODY_SCHEMA = z.object({ password: z.string().optional() });

export type LoginBody = z.infer<typeof LOGIN_BODY_SCHEMA>;

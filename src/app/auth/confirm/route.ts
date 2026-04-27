// Some Supabase email templates point to /auth/confirm instead of /auth/callback.
// Forward to the canonical handler.
export { GET } from "../callback/route"

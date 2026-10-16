#!/usr/bin/env node
// Mints a one-shot sign-in URL for a TEST-project account (creating the
// account if needed), for clicking through flows on the dev server started
// by scripts/dev-against-test.mjs. Never works against production: the
// service-role key comes from .env.test.local and the URL is checked.
//
//   node scripts/test-sign-in-link.mjs someone@isolation.test [/next/path]
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { randomBytes } from "node:crypto"

const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.test.local"), "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")] })
)
const prodEnv = fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : ""
if (prodEnv.includes(new URL(env.TEST_SUPABASE_URL).host)) {
  console.error("TEST_SUPABASE_URL matches production — refusing.")
  process.exit(2)
}

const [email, next = "/dashboard"] = process.argv.slice(2)
if (!email || !email.endsWith("@isolation.test")) {
  console.error("Usage: node scripts/test-sign-in-link.mjs <name>@isolation.test [/next/path]")
  process.exit(2)
}

const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (!list?.users.some((u) => u.email === email)) {
  const { error } = await admin.auth.admin.createUser({ email, password: randomBytes(12).toString("base64url"), email_confirm: true })
  if (error) { console.error(error.message); process.exit(1) }
}
const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email })
if (error) { console.error(error.message); process.exit(1) }
const url = `http://localhost:3001/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`
console.log(url)

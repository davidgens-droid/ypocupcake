#!/usr/bin/env node
// Cupcake — cross-tenant isolation test suite.
//
// Runs ONLY against a dedicated test Supabase project (never production):
//   .env.test.local
//     TEST_SUPABASE_URL=https://xxxx.supabase.co
//     TEST_SUPABASE_ANON_KEY=...
//     TEST_SUPABASE_SERVICE_ROLE_KEY=...
//     TEST_DATABASE_URL=postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres
//
// What it does: resets the public schema, applies supabase/migrations/* in
// order, creates two forums with two members each (service role for fixtures
// until the onboarding RPCs exist), signs in as each member with their own
// session, and asserts the NEGATIVE space of the spec (§12): nothing readable
// or writable across forums, nothing of another member's private data
// readable even by admins/moderators, identity columns immutable, functions
// locked down, realtime/storage side channels closed.
//
//   npm run test:isolation            # full run
//   npm run test:isolation -- --keep  # keep the schema afterwards for poking
//
// Every assertion prints PASS/FAIL; the process exits 1 on any FAIL.

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { randomUUID, randomBytes } from "node:crypto"

const require = createRequire(import.meta.url)
const { Client } = require("pg")
const { createClient } = require("@supabase/supabase-js")

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")

// ─── env ─────────────────────────────────────────────────────────────────────
const envFile = path.join(ROOT, ".env.test.local")
if (!fs.existsSync(envFile)) {
  console.error(`Missing ${envFile}. See the header of this script.`)
  process.exit(2)
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")] })
)
for (const k of ["TEST_SUPABASE_URL", "TEST_SUPABASE_ANON_KEY", "TEST_SUPABASE_SERVICE_ROLE_KEY", "TEST_DATABASE_URL"]) {
  if (!env[k]) { console.error(`Missing ${k} in .env.test.local`); process.exit(2) }
}
// Refuse to run against anything that looks like production.
const prodEnv = fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : ""
if (prodEnv.includes(new URL(env.TEST_SUPABASE_URL).host)) {
  console.error("TEST_SUPABASE_URL matches the production project in .env.local — refusing to run.")
  process.exit(2)
}

const KEEP = process.argv.includes("--keep")
const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const pg = new Client({ connectionString: env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false } })

// ─── reporting ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${detail ? "  — " + detail : ""}`) }
}
const isRejected = (res) => !!res.error

// ─── 1. reset + migrate ──────────────────────────────────────────────────────
async function resetAndMigrate() {
  await pg.connect()
  console.log("· resetting public schema")
  await pg.query(`
    drop schema if exists public cascade;
    create schema public;
    grant usage on schema public to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
    drop policy if exists "photos_read_forum" on storage.objects;
    drop policy if exists "photos_insert_self" on storage.objects;
    drop policy if exists "photos_delete_self" on storage.objects;
    delete from storage.objects where bucket_id = 'photos';
    delete from storage.buckets where id = 'photos';
    drop trigger if exists on_auth_user_created on auth.users;
  `)
  // Remove auth users from previous runs.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of list?.users ?? []) if (u.email?.endsWith("@isolation.test")) await admin.auth.admin.deleteUser(u.id)

  const dir = path.join(ROOT, "supabase", "migrations")
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8")
    process.stdout.write(`· applying ${f} … `)
    try {
      await pg.query(sql)
      console.log("ok")
    } catch (e) {
      console.log("FAILED")
      console.error(e.message)
      process.exit(1)
    }
  }
}

// ─── 2. fixtures ─────────────────────────────────────────────────────────────
async function makeUser(email) {
  const password = randomBytes(12).toString("base64url")
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  return { id: data.user.id, email, password }
}
async function sessionFor(user) {
  const c = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await c.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error) throw error
  return c
}

/** Every fixture write must succeed, or later "sees nothing" passes are vacuous. */
function must(res, what) {
  if (res.error) throw new Error(`fixture ${what}: ${res.error.message}`)
  return res.data
}

async function fixtures() {
  console.log("· creating fixtures (service role)")
  const year = new Date().getFullYear()
  const forums = {}
  for (const key of ["A", "B"]) {
    const f = must(await admin.from("forums").insert({ name: `Forum ${key}` }).select("id").single(), "forum")
    const adminUser = await makeUser(`${key.toLowerCase()}1@isolation.test`)
    const memberUser = await makeUser(`${key.toLowerCase()}2@isolation.test`)
    must(await admin.from("members").insert([
      { id: adminUser.id, forum_id: f.id, email: adminUser.email, name: `${key} Admin`, is_admin: true },
      { id: memberUser.id, forum_id: f.id, email: memberUser.email, name: `${key} Member`, is_admin: false },
    ]), "members")
    must(await admin.from("roles").insert([
      { forum_id: f.id, member_id: adminUser.id, role_type: "moderator", year },
      { forum_id: f.id, member_id: adminUser.id, role_type: "technology", year },
    ]), "roles")
    const meeting = must(await admin.from("meetings").insert({ forum_id: f.id, scheduled_at: new Date().toISOString(), location: `Room ${key}` }).select("id").single(), "meeting")
    must(await admin.from("attendees").insert({ meeting_id: meeting.id, member_id: memberUser.id, attending: true }), "attendee")
    const agenda = must(await admin.from("agenda_items").insert({ meeting_id: meeting.id, kind: "updates", title: "Updates", position: 1 }).select("id").single(), "agenda item")
    const item = must(await admin.from("parking_lot_items").insert({
      forum_id: f.id, submitter_member_id: memberUser.id, added_by_member_id: memberUser.id,
      topic: `Topic ${key}`, tool_category: "EQ", exploration_format: "fsfe",
    }).select("id").single(), "parking-lot item")
    must(await admin.from("updates").insert({
      member_id: memberUser.id, meeting_id: meeting.id, ready: true, completed_at: new Date().toISOString(),
      content: { qol: { physical_health: 7, mental_health: 6, financial_health: 8, friends_community: 5 }, secret: `SECRET-${key}` },
    }), "update")
    must(await admin.from("commitments").insert({ forum_id: f.id, member_id: memberUser.id, text: `Commit ${key}` }), "commitment")
    const album = must(await admin.from("photo_albums").insert({ forum_id: f.id, name: `Album ${key}`, created_by: memberUser.id }).select("id").single(), "album")
    const memberClient = await sessionFor(memberUser)
    // A REAL object, uploaded as the member, so the storage assertions bite.
    const objectPath = `${f.id}/${memberUser.id}/${randomUUID()}.txt`
    const up = await memberClient.storage.from("photos").upload(objectPath, new Blob([`photo ${key}`]))
    if (up.error) throw new Error(`fixture upload ${key}: ${up.error.message}`)
    must(await admin.from("photos").insert({ forum_id: f.id, uploader_member_id: memberUser.id, storage_path: objectPath, album_id: album.id }), "photo")
    forums[key] = {
      id: f.id, meeting: meeting.id, item: item.id, agenda: agenda.id, objectPath,
      admin: { ...adminUser, client: await sessionFor(adminUser) },
      member: { ...memberUser, client: memberClient },
    }
  }
  return forums
}

// ─── 3. assertions ───────────────────────────────────────────────────────────
async function assertions(F) {
  const A = F.A, B = F.B
  const forumTables = ["members", "roles", "meetings", "attendees", "agenda_items", "meeting_rounds", "parking_lot_items", "commitments", "photos", "photo_albums"]

  // §12.1 — every forum-scoped table returns 0 rows of the other forum
  for (const who of [A.admin, A.member]) {
    for (const t of forumTables) {
      const res = await who.client.from(t).select("*")
      const leaked = (res.data ?? []).filter((r) => r.forum_id === B.id)
      ok(`12.1 ${t}: A (${who.name ?? "user"}) sees no forum-B rows`, !res.error && leaked.length === 0, res.error?.message)
    }
    const f = await who.client.from("forums").select("id")
    ok(`12.1 forums: A sees only its own forum`, (f.data ?? []).every((r) => r.id === A.id))
    const byId = await who.client.from("meetings").select("id").eq("id", B.meeting)
    ok(`12.1 meetings by id: foreign id returns nothing`, (byId.data ?? []).length === 0)
  }

  // §12.2 — writes carrying a foreign UUID are rejected
  const w1 = await A.member.client.from("parking_lot_items").insert({
    forum_id: A.id, submitter_member_id: A.member.id, added_by_member_id: A.member.id,
    topic: "x", tool_category: "EQ", exploration_format: "fsfe", scheduled_meeting_id: B.meeting,
  })
  ok("12.2 parking-lot item pointing at a foreign meeting is rejected", isRejected(w1))
  const w2 = await A.member.client.from("attendees").insert({ meeting_id: B.meeting, member_id: A.member.id })
  ok("12.2 attendee row on a foreign meeting is rejected", isRejected(w2))
  const w3 = await A.member.client.from("updates").insert({ member_id: A.member.id, meeting_id: B.meeting, content: {} })
  ok("12.2 update filed against a foreign meeting is rejected", isRejected(w3))
  const w4 = await A.member.client.from("commitments").update({ forum_id: B.id }).eq("member_id", A.member.id)
  const w4check = await admin.from("commitments").select("forum_id").eq("member_id", A.member.id).single()
  ok("12.2 commitment cannot be moved to another forum", w4check.data?.forum_id === A.id, w4.error?.message)
  const w5 = await A.admin.client.from("meeting_rounds").insert({ meeting_id: A.meeting, forum_id: A.id, round_type: "updates", order_member_ids: [A.member.id, B.member.id], current_index: 0 })
  ok("12.2 presenting order containing a foreign member is rejected", isRejected(w5))
  // Positive control, exactly the app's payload (no forum_id — the trigger derives it).
  const w6 = await A.admin.client.from("meeting_rounds").insert({ meeting_id: A.meeting, round_type: "updates", order_member_ids: [A.admin.id, A.member.id], current_index: 0, current_started_at: null, per_member_seconds: 300 }).select("id, forum_id").single()
  ok("12.2 (control) app-style round insert without forum_id succeeds and gets the meeting's forum", !w6.error && w6.data?.forum_id === A.id, w6.error?.message)
  if (w6.data) {
    const w7 = await A.admin.client.from("meeting_rounds").update({ order_member_ids: [A.member.id, A.admin.id] }).eq("id", w6.data.id)
    ok("12.2 (control) reordering a round within the forum succeeds", !w7.error, w7.error?.message)
    const w8 = await A.admin.client.from("meeting_rounds").update({ order_member_ids: [A.member.id, A.admin.id, B.member.id] }).eq("id", w6.data.id)
    ok("12.2 adding a foreign member to an existing order is rejected", isRejected(w8))
  }
  // Removed members: hidden from members, visible to admins, excluded from new orders.
  const rm = await A.admin.client.rpc("remove_member", { p_member_id: A.member.id })
  ok("12.3 (control) admin can remove a member", !rm.error, rm.error?.message)
  const seenByAdmin = await A.admin.client.from("members").select("id, status").eq("id", A.member.id).maybeSingle()
  ok("12.3 removed member still visible to the admin (for Restore)", seenByAdmin.data?.status === "removed")
  const removedSelf = await A.member.client.from("meetings").select("id")
  ok("12.3 removed member can no longer read forum data", (removedSelf.data ?? []).length === 0)
  const w9 = await A.admin.client.from("meeting_rounds").insert({ meeting_id: A.meeting, round_type: "commitments", order_member_ids: [A.admin.id, A.member.id], current_index: 0 })
  ok("12.3 a new round cannot include a removed member", isRejected(w9))
  const rs = await A.admin.client.rpc("restore_member", { p_member_id: A.member.id })
  ok("12.3 (control) admin can restore a member", !rs.error, rs.error?.message)

  // §12.3 — identity columns immutable; allowed columns work
  const h1 = await A.member.client.from("members").update({ forum_id: B.id }).eq("id", A.member.id)
  const h1check = await admin.from("members").select("forum_id").eq("id", A.member.id).single()
  ok("12.3 forum hop via PATCH forum_id is rejected", h1check.data?.forum_id === A.id, h1.error?.message)
  const h2 = await A.member.client.from("members").update({ is_admin: true }).eq("id", A.member.id)
  const h2check = await admin.from("members").select("is_admin").eq("id", A.member.id).single()
  ok("12.3 is_admin self-grant is rejected", h2check.data?.is_admin === false, h2.error?.message)
  const h3 = await A.member.client.from("members").update({ status: "removed" }).eq("id", A.admin.id)
  const h3check = await admin.from("members").select("status").eq("id", A.admin.id).single()
  ok("12.3 member cannot change another member's status", h3check.data?.status === "active", h3.error?.message)
  const h4 = await A.member.client.from("members").update({ name: "A Member Renamed" }).eq("id", A.member.id)
  const h4check = await admin.from("members").select("name").eq("id", A.member.id).single()
  ok("12.3 profile fields (name) still editable by self", !h4.error && h4check.data?.name === "A Member Renamed", h4.error?.message)
  const h5 = await A.admin.client.rpc("admin_update_member", { p_member_id: B.member.id, p_patch: { name: "pwned" } })
  ok("12.3 admin_update_member refuses a member of another forum", isRejected(h5))
  const h6 = await A.admin.client.rpc("admin_update_member", { p_member_id: A.admin.id, p_patch: { is_admin: false } })
  ok("12.3 admin_update_member refuses to demote the last admin", isRejected(h6))

  // §12.4 — roles cannot cross forums; has_role never true across forums
  const r1 = await A.admin.client.from("roles").insert({ forum_id: A.id, member_id: B.member.id, role_type: "moderator", year: new Date().getFullYear() })
  ok("12.4 admin of A cannot grant a role to a member of B", isRejected(r1))
  const r2 = await admin.from("roles").insert({ forum_id: A.id, member_id: A.admin.id, role_type: "czar", year: new Date().getFullYear() })
  ok("12.4 (fixture) same-forum role insert works", !r2.error, r2.error?.message)

  // §12.5 — notifications cannot cross forums; links must be relative
  const n1 = await A.admin.client.rpc("create_notification", { p_member_id: B.member.id, p_kind: "photo_comment", p_link: "/forum" })
  ok("12.5 create_notification to a member of another forum is rejected", isRejected(n1))
  const n2 = await A.admin.client.rpc("create_notification", { p_member_id: A.member.id, p_kind: "photo_comment", p_link: "https://evil.example" })
  ok("12.5 create_notification with an absolute link is rejected", isRejected(n2))
  const n2b = await A.admin.client.rpc("create_notification", { p_member_id: A.member.id, p_kind: "photo_comment", p_link: "/\\evil.example/login" })
  ok("12.5 create_notification with a backslash link is rejected", isRejected(n2b))
  const n3 = await A.admin.client.rpc("create_notification", { p_member_id: A.member.id, p_kind: "photo_comment", p_link: "/forum/photos" })
  ok("12.5 create_notification in-forum with a relative link works", !n3.error, n3.error?.message)
  const n3row = await A.member.client.from("notifications").select("title").eq("id", n3.data).maybeSingle()
  ok("12.5 the title names the CALLER, not a caller-supplied string", (n3row.data?.title ?? "").startsWith("A Admin "), JSON.stringify(n3row.data))
  const n3spoof = await A.admin.client.rpc("create_notification", { p_member_id: A.member.id, p_kind: "photo_comment", p_title: "B Admin commented on your photo" })
  ok("12.5 a p_title argument is not accepted (old overload gone)", isRejected(n3spoof))
  const anon = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY)
  const n4 = await anon.rpc("create_notification", { p_member_id: A.member.id, p_kind: "photo_comment" })
  ok("12.5 anonymous caller cannot create notifications", isRejected(n4))
  const n5 = await A.member.client.from("parking_lot_items").insert({ forum_id: A.id, submitter_member_id: A.member.id, added_by_member_id: A.member.id, topic: "sneak", tool_category: "EQ", exploration_format: "fsfe", status: "captured", captured_meeting_id: A.meeting })
  ok("12.5 a plain member cannot plant a 'captured' item into a meeting", isRejected(n5))
  const n6 = await A.member.client.from("parking_lot_items").update({ status: "scheduled", scheduled_meeting_id: A.meeting }).eq("id", A.item)
  const n6check = await admin.from("parking_lot_items").select("status").eq("id", A.item).single()
  ok("12.5 a plain member cannot schedule their own item", n6check.data?.status === "parked", n6.error?.message)

  // §12.6 — storage prefixes
  const up1 = await A.member.client.storage.from("photos").upload(`${B.id}/${A.member.id}/${randomUUID()}.txt`, new Blob(["x"]))
  ok("12.6 upload under another forum's prefix is rejected", !!up1.error)
  const up2 = await A.member.client.storage.from("photos").upload(`${A.id}/${A.admin.id}/${randomUUID()}.txt`, new Blob(["x"]))
  ok("12.6 upload under another member's prefix is rejected", !!up2.error)
  const up3 = await A.member.client.storage.from("photos").upload(`${A.id}/${A.member.id}/${randomUUID()}.txt`, new Blob(["x"]))
  ok("12.6 upload under own prefix works", !up3.error, up3.error?.message)
  // B's object really exists (uploaded in fixtures), so a refusal is RLS, not a 404.
  const suOwn = await B.member.client.storage.from("photos").createSignedUrl(B.objectPath, 60)
  ok("12.6 (control) owner can sign their own object", !suOwn.error && !!suOwn.data?.signedUrl, suOwn.error?.message)
  const su = await A.member.client.storage.from("photos").createSignedUrl(B.objectPath, 60)
  ok("12.6 signed URL for another forum's object is refused", !!su.error)
  const dl = await A.member.client.storage.from("photos").download(B.objectPath)
  ok("12.6 download of another forum's object is refused", !!dl.error)
  const ls = await A.member.client.storage.from("photos").list(`${B.id}/${B.member.id}`)
  ok("12.6 listing another forum's prefix returns nothing", !!ls.error || (ls.data ?? []).length === 0)

  // §12.7 — realtime DELETE events carry only the PK
  const ri = await pg.query(`select relname, relreplident from pg_class where relname in ('meetings','meeting_rounds','attendees','notifications')`)
  ok("12.7 replica identity is DEFAULT on all published tables", ri.rows.length === 4 && ri.rows.every((r) => r.relreplident === "d"), JSON.stringify(ri.rows))

  // §12.8 — member-private tables: self-only, even for admin/moderator; exact policy set
  for (const t of ["updates", "ai_interactions", "ai_pattern_cards", "notifications"]) {
    const res = await A.admin.client.from(t).select("*")
    const others = (res.data ?? []).filter((r) => r.member_id !== A.admin.id)
    ok(`12.8 ${t}: forum admin+moderator sees no other member's rows`, !res.error && others.length === 0, res.error?.message)
    const pol = await pg.query(`select policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename=$1`, [t])
    const onlySelf = pol.rows.length === 1 && pol.rows[0].cmd === "ALL" && /member_id = auth\.uid\(\)/.test(pol.rows[0].qual) && /member_id = auth\.uid\(\)/.test(pol.rows[0].with_check)
    ok(`12.8 ${t}: exactly one self-only policy`, onlySelf, JSON.stringify(pol.rows.map((r) => r.policyname)))
  }
  const secret = await A.admin.client.from("updates").select("content").eq("member_id", A.member.id)
  ok("12.8 admin cannot read a member's update content", (secret.data ?? []).length === 0)

  // §12.9 — QoL history is forum-scoped and role-gated
  const q1 = await A.admin.client.rpc("forum_qol_history")
  ok("12.9 moderator sees only same-forum QoL rows", !q1.error && (q1.data ?? []).every((r) => [A.member.id, A.admin.id].includes(r.member_id)), q1.error?.message)
  const q2 = await A.member.client.rpc("forum_qol_history")
  ok("12.9 plain member cannot call forum_qol_history", isRejected(q2))
  ok("12.9 QoL rows never contain update content", (q1.data ?? []).every((r) => !("content" in r) && !("secret" in r)))

  // §12.10 / 12.11 — onboarding + platform RPCs (present from Phase 3 / 4)
  const { rows: fnRows } = await pg.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)
  const fns = new Set(fnRows.map((r) => r.proname))
  if (fns.has("create_forum")) {
    const c1 = await A.member.client.rpc("create_forum", { p_name: "Dup", p_timezone: "UTC", p_admin_name: "X" })
    ok("12.10 create_forum refuses an existing member", isRejected(c1))
  } else console.log("skip  12.10 (create_forum not yet migrated)")
  if (fns.has("platform_forum_stats")) {
    const p1 = await A.admin.client.rpc("platform_forum_stats")
    ok("12.11 platform_forum_stats refuses a non-platform user", isRejected(p1))
  } else console.log("skip  12.11 (platform layer not yet migrated)")

  // §12.12 — hygiene: no service-role key in src/, no PUBLIC execute on definer functions
  const grep = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && fs.readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))
  ok("12.12 SUPABASE_SERVICE_ROLE_KEY is not referenced in src/", grep.length === 0, grep.join(", "))
  const { rows: defs } = await pg.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  `)
  const anonExec = defs.filter((d) => d.anon_exec).map((d) => d.proname)
  ok("12.12 no SECURITY DEFINER function is executable by anon", anonExec.length === 0, anonExec.join(", "))
}

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p)
  }
  return out
}

// ─── main ────────────────────────────────────────────────────────────────────
try {
  await resetAndMigrate()
  const F = await fixtures()
  await assertions(F)
} catch (e) {
  console.error("\nSuite aborted:", e?.message ?? e)
  fail++
} finally {
  if (!KEEP) {
    try {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
      for (const u of list?.users ?? []) if (u.email?.endsWith("@isolation.test")) await admin.auth.admin.deleteUser(u.id)
    } catch {}
  }
  await pg.end().catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed${failures.length ? "\n  " + failures.join("\n  ") : ""}`)
process.exit(fail ? 1 : 0)

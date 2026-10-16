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
/** Rejected with the given stable error code (the RPCs raise e.g. 'not_admin'). */
const codeIs = (res, code) => isRejected(res) && (res.error?.message ?? "").includes(code)

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
    drop trigger if exists on_auth_user_created on auth.users;
  `)
  // Storage rows can't be deleted with SQL on current Supabase projects
  // ("Use the Storage API instead"), so the bucket is emptied through the
  // API. The bucket itself stays: 0004 creates it with `on conflict do
  // nothing`, and deleting it right after emptying races the async cleanup.
  for (const bucket of ["photos", "charters"]) {
    const emptied = await admin.storage.emptyBucket(bucket)
    if (emptied.error && !/not found/i.test(emptied.error.message)) throw new Error(`emptyBucket ${bucket}: ${emptied.error.message}`)
  }
  // Remove auth users from previous runs.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of list?.users ?? []) if (u.email?.endsWith("@isolation.test")) await admin.auth.admin.deleteUser(u.id)

  const dir = path.join(ROOT, "supabase", "migrations")
  // Mirror production exactly: 0015 (captured items readable by privileged
  // roles only) was deliberately NOT applied there, so it is not applied here.
  const NOT_IN_PRODUCTION = new Set(["0015_captured_items_privileged_read.sql"])
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && !NOT_IN_PRODUCTION.has(f)).sort()
  // Production consumed the bootstrap invite (0003) on the owner's first
  // sign-in; the test project never signs him in, so clear it before 0021's
  // "no pending invites" guard — which must stay, for production's sake.
  const BEFORE = { "0021_onboarding.sql": "delete from member_invites" }
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8")
    process.stdout.write(`· applying ${f} … `)
    try {
      if (BEFORE[f]) await pg.query(BEFORE[f])
      await pg.query(sql)
      console.log("ok")
    } catch (e) {
      console.log("FAILED")
      console.error(e.message)
      process.exit(1)
    }
  }
  // Every migration from the multi-forum work on is applied by hand and must
  // survive a second run (the owner re-runs a file after a fix). Prove it.
  for (const f of files.filter((f) => f >= "0017")) {
    process.stdout.write(`· re-applying ${f} (idempotency) … `)
    try {
      await pg.query(fs.readFileSync(path.join(dir, f), "utf8"))
      console.log("ok")
    } catch (e) {
      console.log("FAILED")
      console.error(`${f} is not re-runnable: ${e.message}`)
      process.exit(1)
    }
  }
  // The migrations ran over a direct connection; PostgREST (what the app and
  // these fixtures talk to) caches the schema and must be told to reload —
  // then given a moment to do it.
  await pg.query("notify pgrst, 'reload schema'")
  for (let i = 0; i < 30; i++) {
    const probe = await admin.from("platform_settings").select("key").limit(1)
    if (!probe.error) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error("PostgREST schema cache did not pick up the new tables within 15s")
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
  console.log("· creating fixtures (the real onboarding RPCs, then service-role content)")
  // Signups are closed by default; open them for the run (the closed state
  // is asserted in §12.10).
  must(await admin.from("platform_settings").update({ value: true }).eq("key", "signup_enabled"), "open signups")
  const forums = {}
  for (const key of ["A", "B"]) {
    const adminUser = await makeUser(`${key.toLowerCase()}1@isolation.test`)
    const memberUser = await makeUser(`${key.toLowerCase()}2@isolation.test`)
    const adminClient = await sessionFor(adminUser)
    // The founder creates the forum (becomes admin + moderator + technology)…
    const forumId = must(await adminClient.rpc("create_forum", { p_name: `Forum ${key}`, p_timezone: "America/Vancouver", p_admin_name: `${key} Admin` }), "create_forum")
    // …issues the invite link, and the member joins through it.
    const linkId = must(await adminClient.rpc("create_invite_link", { p_expires_days: 14, p_max_uses: 25 }), "create_invite_link")
    const link = must(await adminClient.from("forum_invite_links").select("token").eq("id", linkId).single(), "read link")
    const memberClient = await sessionFor(memberUser)
    must(await memberClient.rpc("join_forum", { p_token: link.token, p_name: `${key} Member` }), "join_forum")
    const f = { id: forumId }
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
    // A REAL object, uploaded as the member, so the storage assertions bite.
    const objectPath = `${f.id}/${memberUser.id}/${randomUUID()}.txt`
    const up = await memberClient.storage.from("photos").upload(objectPath, new Blob([`photo ${key}`]))
    if (up.error) throw new Error(`fixture upload ${key}: ${up.error.message}`)
    must(await admin.from("photos").insert({ forum_id: f.id, uploader_member_id: memberUser.id, storage_path: objectPath, album_id: album.id }), "photo")
    forums[key] = {
      id: f.id, meeting: meeting.id, item: item.id, agenda: agenda.id, objectPath, linkId, token: link.token,
      admin: { ...adminUser, client: adminClient },
      member: { ...memberUser, client: memberClient },
    }
  }
  return forums
}

/** A brand-new signed-in account with no membership anywhere. */
async function freshAccount(tag) {
  const u = await makeUser(`${tag}@isolation.test`)
  return { ...u, client: await sessionFor(u) }
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
  // Charter documents: the forum's admins write under the forum's prefix; its members read; nobody else anything.
  // (The bucket allow-lists MIME types, and supabase-js sends a Blob's own type.)
  const txt = { contentType: "text/plain" }
  const textBlob = (s) => new Blob([s], { type: "text/plain" })
  const ch1 = await A.member.client.storage.from("charters").upload(`${A.id}/${randomUUID()}.txt`, textBlob("norms"), txt)
  ok("12.6 a plain member cannot upload a charter document", !!ch1.error)
  const ch2 = await A.admin.client.storage.from("charters").upload(`${B.id}/${randomUUID()}.txt`, textBlob("norms"), txt)
  ok("12.6 an admin cannot upload a charter document under another forum's prefix", !!ch2.error)
  const charterPath = `${A.id}/${randomUUID()}.txt`
  const ch3 = await A.admin.client.storage.from("charters").upload(charterPath, textBlob("our norms"), txt)
  ok("12.6 (control) the forum's admin can upload a charter document", !ch3.error, ch3.error?.message)
  const ch4 = await B.member.client.storage.from("charters").createSignedUrl(charterPath, 60)
  ok("12.6 another forum's member cannot open our charter document", !!ch4.error)
  const ch5 = await A.member.client.storage.from("charters").createSignedUrl(charterPath, 60)
  ok("12.6 (control) our own member can open the charter document", !ch5.error && !!ch5.data?.signedUrl, ch5.error?.message)
  const ch6 = await B.admin.client.storage.from("charters").remove([charterPath])
  const ch6check = await A.admin.client.storage.from("charters").createSignedUrl(charterPath, 60)
  ok("12.6 another forum's admin cannot delete our charter document", !!ch6.error || (!ch6check.error && !!ch6check.data?.signedUrl), ch6.error?.message)
  const doc = { path: charterPath, name: "Norms.txt", size: 9, type: "text/plain" }
  const sd1 = await A.member.client.rpc("set_charter_document", { p_document: doc })
  ok("12.6 a plain member cannot record a charter document", codeIs(sd1, "not_admin"), sd1.error?.message)
  const sd2 = await B.admin.client.rpc("set_charter_document", { p_document: doc })
  ok("12.6 another forum's admin cannot record our object as their charter", codeIs(sd2, "invalid_document"), sd2.error?.message)
  const sd3 = await A.admin.client.rpc("set_charter_document", { p_document: { ...doc, path: `${A.id}/${randomUUID()}.txt` } })
  ok("12.6 a charter record must point at a real upload", codeIs(sd3, "document_not_found"), sd3.error?.message)
  const sd4 = await A.admin.client.rpc("set_charter_document", { p_document: doc })
  const sd4check = await admin.from("forums").select("settings").eq("id", A.id).single()
  ok("12.6 (control) the forum's admin records the charter document", !sd4.error && sd4check.data?.settings?.charter_document?.path === charterPath && sd4check.data?.settings?.charter_document?.name === "Norms.txt", sd4.error?.message ?? JSON.stringify(sd4check.data?.settings))
  const sd5 = await A.admin.client.rpc("set_charter_document", { p_document: null })
  const sd5check = await admin.from("forums").select("settings").eq("id", A.id).single()
  ok("12.6 (control) ...and can remove it again", !sd5.error && sd5check.data?.settings?.charter_document === undefined, sd5.error?.message)

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

  // §12.13 — my_forum_status: status + forum name, nothing more, for any member state
  const st0 = await A.member.client.rpc("my_forum_status").maybeSingle()
  ok("12.13 my_forum_status for an active member", st0.data?.member_status === "active" && st0.data?.forum_status === "active" && st0.data?.forum_name === "Forum A", JSON.stringify(st0.data ?? st0.error))
  must(await A.admin.client.rpc("remove_member", { p_member_id: A.member.id }), "remove for 12.13")
  const st1 = await A.member.client.rpc("my_forum_status").maybeSingle()
  ok("12.13 a removed member learns 'removed' and the forum name only", st1.data?.member_status === "removed" && Object.keys(st1.data ?? {}).sort().join() === "forum_name,forum_status,member_status", JSON.stringify(st1.data ?? st1.error))
  must(await A.admin.client.rpc("restore_member", { p_member_id: A.member.id }), "restore for 12.13")
  const stAnon = await anon.rpc("my_forum_status")
  ok("12.13 anonymous caller cannot call my_forum_status", isRejected(stAnon))

  // §12.14 — forum settings: admin-only, validated, same-forum; no direct UPDATE on forums
  const fs1 = await A.member.client.rpc("update_forum_settings", { p_name: "Hijacked" })
  ok("12.14 a plain member cannot change forum settings", isRejected(fs1))
  const fs2 = await A.admin.client.rpc("update_forum_settings", { p_timezone: "Mars/Olympus_Mons" })
  ok("12.14 an unknown timezone is rejected", isRejected(fs2))
  const fs3 = await A.admin.client.rpc("update_forum_settings", { p_name: "Forum A Renamed", p_timezone: "Europe/London", p_charter: "Be kind." })
  ok("12.14 (control) admin can set name, timezone and charter", !fs3.error, fs3.error?.message)
  const fsA = await admin.from("forums").select("name, timezone, settings").eq("id", A.id).single()
  const fsB = await admin.from("forums").select("name, timezone, settings").eq("id", B.id).single()
  ok("12.14 settings landed on forum A (charter stamped with the caller)", fsA.data?.name === "Forum A Renamed" && fsA.data?.timezone === "Europe/London" && fsA.data?.settings?.charter === "Be kind." && fsA.data?.settings?.charter_updated_by === A.admin.id, JSON.stringify(fsA.data))
  ok("12.14 forum B untouched", fsB.data?.name === "Forum B" && fsB.data?.timezone === "America/Vancouver" && !fsB.data?.settings?.charter, JSON.stringify(fsB.data))
  const fs4 = await A.admin.client.from("forums").update({ name: "Direct" }).eq("id", A.id)
  const fs4check = await admin.from("forums").select("name").eq("id", A.id).single()
  ok("12.14 direct UPDATE forums.name is refused even for an admin", fs4check.data?.name === "Forum A Renamed", fs4.error?.message)
  const fs5 = await A.admin.client.from("forums").update({ status: "suspended" }).eq("id", B.id)
  const fs5check = await admin.from("forums").select("status").eq("id", B.id).single()
  ok("12.14 forum status cannot be changed from a user session", fs5check.data?.status === "active", fs5.error?.message)
  // A suspended forum: its members read nothing, its admin can't change settings, my_forum_status says why.
  must(await admin.from("forums").update({ status: "suspended" }).eq("id", B.id), "suspend B")
  const sus1 = await B.member.client.from("meetings").select("id")
  ok("12.14 a member of a suspended forum reads nothing", (sus1.data ?? []).length === 0)
  const sus2 = await B.admin.client.rpc("update_forum_settings", { p_name: "Still here" })
  ok("12.14 an admin of a suspended forum cannot change its settings", isRejected(sus2))
  const sus3 = await B.member.client.rpc("my_forum_status").maybeSingle()
  ok("12.14 my_forum_status reports the suspension", sus3.data?.forum_status === "suspended" && sus3.data?.member_status === "active", JSON.stringify(sus3.data ?? sus3.error))
  must(await admin.from("forums").update({ status: "active" }).eq("id", B.id), "reactivate B")

  // §12.15 — AI fair-use counter: the caller's forum only, a bare integer
  must(await admin.from("ai_interactions").insert([
    { member_id: A.admin.id, kind: "brain_dump", tokens_in: 1, tokens_out: 1 },
    { member_id: A.member.id, kind: "brain_dump", tokens_in: 1, tokens_out: 1 },
    { member_id: B.member.id, kind: "brain_dump", tokens_in: 1, tokens_out: 1 },
  ]), "ai_interactions")
  const ai1 = await A.member.client.rpc("forum_ai_calls_today")
  ok("12.15 forum_ai_calls_today counts only the caller's forum", !ai1.error && ai1.data === 2, JSON.stringify(ai1.data ?? ai1.error))
  const ai2 = await B.member.client.rpc("forum_ai_calls_today")
  ok("12.15 ...and for the other forum too", !ai2.error && ai2.data === 1, JSON.stringify(ai2.data ?? ai2.error))
  const ai3 = await anon.rpc("forum_ai_calls_today")
  ok("12.15 anonymous caller cannot call forum_ai_calls_today", isRejected(ai3))

  // §12.10 — onboarding: one forum per account; links expire/revoke/exhaust; peek reveals only the name
  const aName = (await admin.from("forums").select("name").eq("id", A.id).single()).data?.name
  const c1 = await A.member.client.rpc("create_forum", { p_name: "Dup", p_timezone: "UTC", p_admin_name: "X" })
  ok("12.10 create_forum refuses an existing member", codeIs(c1, "already_member"), c1.error?.message)
  const j1 = await A.member.client.rpc("join_forum", { p_token: B.token, p_name: "Hopper" })
  ok("12.10 join_forum refuses a member of another forum (one forum per account)", codeIs(j1, "already_member"), j1.error?.message)
  must(await A.admin.client.rpc("remove_member", { p_member_id: A.member.id }), "remove for 12.10")
  const j1b = await A.member.client.rpc("join_forum", { p_token: B.token, p_name: "Hopper" })
  ok("12.10 a removed member cannot join another forum either", codeIs(j1b, "already_member"), j1b.error?.message)
  must(await A.admin.client.rpc("restore_member", { p_member_id: A.member.id }), "restore for 12.10")
  const pk = await anon.rpc("peek_invite", { p_token: A.token }).maybeSingle()
  ok("12.10 peek_invite (anon) returns exactly forum_name / valid / reason / is_mine", !pk.error && pk.data?.valid === true && pk.data?.forum_name === aName && pk.data?.is_mine === false && Object.keys(pk.data ?? {}).sort().join() === "forum_name,is_mine,reason,valid", JSON.stringify(pk.data ?? pk.error))
  const pkMine = await A.member.client.rpc("peek_invite", { p_token: A.token }).maybeSingle()
  const pkOther = await A.member.client.rpc("peek_invite", { p_token: B.token }).maybeSingle()
  ok("12.10 peek_invite tells a member whether the link is their own forum's (by id, not name)", pkMine.data?.is_mine === true && pkOther.data?.is_mine === false, JSON.stringify({ mine: pkMine.data, other: pkOther.data }))
  const pk2 = await anon.rpc("peek_invite", { p_token: "x".repeat(64) }).maybeSingle()
  ok("12.10 peek_invite with an unknown token reveals nothing", !pk2.error && pk2.data?.valid === false && pk2.data?.forum_name == null && pk2.data?.reason === "unknown", JSON.stringify(pk2.data ?? pk2.error))
  const l1 = await A.member.client.from("forum_invite_links").select("token")
  ok("12.10 a plain member cannot read invite links", (l1.data ?? []).length === 0)
  const l2 = await B.admin.client.from("forum_invite_links").select("token").eq("forum_id", A.id)
  ok("12.10 another forum's admin cannot read our invite links", (l2.data ?? []).length === 0)
  const l3 = await anon.from("forum_invite_links").select("token")
  ok("12.10 anon cannot read invite links", isRejected(l3) || (l3.data ?? []).length === 0)
  const l4 = await A.admin.client.from("forum_invite_links").update({ max_uses: 1000 }).eq("id", A.linkId)
  const l4check = await admin.from("forum_invite_links").select("max_uses").eq("id", A.linkId).single()
  ok("12.10 links cannot be edited directly, even by the admin", l4check.data?.max_uses === 25, l4.error?.message)
  const l5 = await A.member.client.rpc("create_invite_link", {})
  ok("12.10 a plain member cannot create invite links", codeIs(l5, "not_admin"), l5.error?.message)
  const l6 = await B.admin.client.rpc("revoke_invite_link", { p_link_id: A.linkId })
  ok("12.10 another forum's admin cannot revoke our link", codeIs(l6, "link_not_found"), l6.error?.message)
  // expired → new link (retires the old) with max_uses 1 → one join works, the second is exhausted, then revoked
  must(await admin.from("forum_invite_links").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", A.linkId), "expire A's link")
  const late = await freshAccount("fresh1")
  const e1 = await late.client.rpc("join_forum", { p_token: A.token, p_name: "Late" })
  ok("12.10 join_forum refuses an expired link", codeIs(e1, "expired"), e1.error?.message)
  const pkExp = await anon.rpc("peek_invite", { p_token: A.token }).maybeSingle()
  ok("12.10 peek_invite reports 'expired'", pkExp.data?.valid === false && pkExp.data?.reason === "expired", JSON.stringify(pkExp.data))
  const newLinkId = must(await A.admin.client.rpc("create_invite_link", { p_expires_days: 7, p_max_uses: 1 }), "new link")
  const newLink = must(await A.admin.client.from("forum_invite_links").select("token").eq("id", newLinkId).single(), "read new link")
  const oldLink = must(await admin.from("forum_invite_links").select("revoked_at").eq("id", A.linkId).single(), "old link")
  ok("12.10 creating a new link retires the previous one", !!oldLink.revoked_at)
  const first = await freshAccount("fresh2")
  const ok1 = await first.client.rpc("join_forum", { p_token: newLink.token, p_name: "First In" })
  ok("12.10 (control) a fresh account joins via a valid link", !ok1.error && ok1.data === A.id, ok1.error?.message)
  const firstRow = await admin.from("members").select("forum_id, is_admin, status, joined_via_link_id").eq("id", first.id).single()
  ok("12.10 the joiner is a plain active member of the right forum, tied to the link", firstRow.data?.forum_id === A.id && firstRow.data?.is_admin === false && firstRow.data?.status === "active" && firstRow.data?.joined_via_link_id === newLinkId, JSON.stringify(firstRow.data))
  const second = await freshAccount("fresh3")
  const ex = await second.client.rpc("join_forum", { p_token: newLink.token, p_name: "Too Late" })
  ok("12.10 join_forum refuses an exhausted link", codeIs(ex, "exhausted"), ex.error?.message)
  must(await A.admin.client.rpc("revoke_invite_link", { p_link_id: newLinkId }), "revoke")
  const rv = await second.client.rpc("join_forum", { p_token: newLink.token, p_name: "Too Late" })
  ok("12.10 join_forum refuses a revoked link", codeIs(rv, "revoked"), rv.error?.message)
  const noStatus = await second.client.rpc("my_forum_status").maybeSingle()
  ok("12.10 an account with no forum has no status row", !noStatus.error && noStatus.data == null, JSON.stringify(noStatus.data ?? noStatus.error))
  // the signup switch: enforced by the RPC, readable by anyone, flippable by nobody from a session
  must(await admin.from("platform_settings").update({ value: false }).eq("key", "signup_enabled"), "close signups")
  const closed = await second.client.rpc("create_forum", { p_name: "Nope", p_timezone: "UTC", p_admin_name: "X" })
  ok("12.10 create_forum refuses while signups are closed", codeIs(closed, "signup_disabled"), closed.error?.message)
  const flag = await anon.rpc("signup_enabled")
  ok("12.10 (control) anyone can read the signup switch", !flag.error && flag.data === false, flag.error?.message)
  const flip = await second.client.from("platform_settings").update({ value: true }).eq("key", "signup_enabled")
  const flipCheck = await admin.from("platform_settings").select("value").eq("key", "signup_enabled").single()
  ok("12.10 the signup switch cannot be flipped from a user session", flipCheck.data?.value === false, flip.error?.message)
  must(await admin.from("platform_settings").update({ value: true }).eq("key", "signup_enabled"), "reopen signups")
  const badTz = await second.client.rpc("create_forum", { p_name: "Zone", p_timezone: "Factory", p_admin_name: "X" })
  ok("12.10 create_forum refuses a non-renderable timezone", codeIs(badTz, "invalid_timezone"), badTz.error?.message)
  const made = await second.client.rpc("create_forum", { p_name: "Forum C", p_timezone: "Europe/London", p_admin_name: "C Admin" })
  ok("12.10 (control) a fresh account creates a forum", !made.error && !!made.data, made.error?.message)
  if (made.data) {
    const cm = await admin.from("members").select("is_admin, status").eq("id", second.id).single()
    const cr = await admin.from("roles").select("role_type").eq("forum_id", made.data).eq("member_id", second.id)
    ok("12.10 the founder is an active admin with the moderator + technology roles", cm.data?.is_admin === true && cm.data?.status === "active" && (cr.data ?? []).map((r) => r.role_type).sort().join() === "moderator,technology", JSON.stringify({ member: cm.data, roles: cr.data }))
    const vis = await second.client.from("members").select("id")
    ok("12.10 the new forum sees only itself", (vis.data ?? []).length === 1 && vis.data[0].id === second.id)
    const cf = await second.client.from("forums").select("id, created_by").single()
    ok("12.10 the new forum records its founder", cf.data?.id === made.data && cf.data?.created_by === second.id, JSON.stringify(cf.data ?? cf.error))
  }
  const gone = await pg.query(`select to_regclass('public.member_invites') as t, to_regproc('public.handle_new_user') as f`)
  ok("12.10 the email allowlist (member_invites, handle_new_user) is gone", gone.rows[0].t == null && gone.rows[0].f == null, JSON.stringify(gone.rows[0]))

  // §12.11 — platform layer: operators only; forum-level numbers only; suspend works everywhere at once
  const p1 = await A.admin.client.rpc("platform_forum_stats")
  ok("12.11 platform_forum_stats refuses a forum admin who isn't a platform operator", codeIs(p1, "not_platform_admin"), p1.error?.message)
  const p2 = await A.admin.client.rpc("platform_set_forum_status", { p_forum_id: B.id, p_status: "suspended" })
  ok("12.11 platform_set_forum_status refuses a non-operator", codeIs(p2, "not_platform_admin"), p2.error?.message)
  const p3 = await A.admin.client.rpc("platform_set_signup_enabled", { p_enabled: true })
  ok("12.11 platform_set_signup_enabled refuses a non-operator", codeIs(p3, "not_platform_admin"), p3.error?.message)
  const p5 = await A.admin.client.from("platform_admins").insert({ user_id: A.admin.id })
  const p5check = await admin.from("platform_admins").select("user_id").eq("user_id", A.admin.id)
  ok("12.11 nobody can make themselves a platform operator", isRejected(p5) && (p5check.data ?? []).length === 0, p5.error?.message)
  const isNot = await A.admin.client.rpc("is_platform_admin")
  ok("12.11 is_platform_admin is false for an ordinary admin", !isNot.error && isNot.data === false)
  // Promote A's admin to operator (service role) and look around.
  must(await admin.from("platform_admins").insert({ user_id: A.admin.id }), "platform admin")
  const isNow = await A.admin.client.rpc("is_platform_admin")
  ok("12.11 (control) is_platform_admin is true for an operator", !isNow.error && isNow.data === true)
  // Now that a row exists, the table must still be unreadable — even one's own row.
  const p4 = await A.admin.client.from("platform_admins").select("user_id")
  ok("12.11 platform_admins is unreadable from a session (even the operator's own row)", isRejected(p4) || (p4.data ?? []).length === 0, JSON.stringify(p4.data ?? p4.error))
  const own = await A.admin.client.rpc("platform_set_forum_status", { p_forum_id: A.id, p_status: "suspended" })
  const ownCheck = await admin.from("forums").select("status").eq("id", A.id).single()
  ok("12.11 an operator cannot pause their own forum (self-lockout guard)", codeIs(own, "own_forum") && ownCheck.data?.status === "active", own.error?.message)
  const stats = await A.admin.client.rpc("platform_forum_stats")
  const cols = "admin_count,ai_calls_30d,created_at,forum_id,founder_email,founder_name,last_activity,meeting_count,member_count,name,next_meeting_at,status,timezone"
  ok("12.11 platform_forum_stats lists every forum", !stats.error && (stats.data ?? []).length >= 3 && [A.id, B.id].every((id) => stats.data.some((r) => r.forum_id === id)), stats.error?.message)
  ok("12.11 platform_forum_stats returns exactly the operator-level columns (no member content)", (stats.data ?? []).every((r) => Object.keys(r).sort().join() === cols), JSON.stringify(Object.keys(stats.data?.[0] ?? {})))
  const rowB = (stats.data ?? []).find((r) => r.forum_id === B.id)
  ok("12.11 the numbers are right for forum B (2 active members, 1 admin, 1 meeting, founder = B Admin)", rowB?.member_count === 2 && rowB?.admin_count === 1 && rowB?.meeting_count === 1 && rowB?.founder_name === "B Admin" && rowB?.founder_email === B.admin.email, JSON.stringify(rowB))
  // A forum whose founder account is gone and whose only remaining member is
  // not an admin must not present that member as the founder.
  const orphan = must(await admin.from("forums").insert({ name: "Orphan", timezone: "UTC" }).select("id").single(), "orphan forum")
  const orphanUser = await makeUser("orphan@isolation.test")
  must(await admin.from("members").insert({ id: orphanUser.id, forum_id: orphan.id, email: orphanUser.email, name: "Not The Founder", is_admin: false }), "orphan member")
  const stats2 = await A.admin.client.rpc("platform_forum_stats")
  const rowO = (stats2.data ?? []).find((r) => r.forum_id === orphan.id)
  ok("12.11 a forum with no founder and no admin reports no founder (never an ordinary member)", !!rowO && rowO.founder_name == null && rowO.founder_email == null && rowO.member_count === 1 && rowO.admin_count === 0, JSON.stringify(rowO))
  const sus = await A.admin.client.rpc("platform_set_forum_status", { p_forum_id: B.id, p_status: "suspended" })
  ok("12.11 (control) an operator can pause a forum", !sus.error, sus.error?.message)
  const susRead = await B.admin.client.from("meetings").select("id")
  const susStatus = await B.admin.client.rpc("my_forum_status").maybeSingle()
  ok("12.11 a paused forum's admin reads nothing and is told why", (susRead.data ?? []).length === 0 && susStatus.data?.forum_status === "suspended", JSON.stringify(susStatus.data))
  const susPeek = await anon.rpc("peek_invite", { p_token: B.token }).maybeSingle()
  ok("12.11 a paused forum's invite link stops working", susPeek.data?.valid === false && susPeek.data?.reason === "forum_suspended", JSON.stringify(susPeek.data))
  const react = await A.admin.client.rpc("platform_set_forum_status", { p_forum_id: B.id, p_status: "active" })
  const reactRead = await B.admin.client.from("meetings").select("id")
  ok("12.11 (control) reactivating restores access", !react.error && (reactRead.data ?? []).length === 1, react.error?.message)
  const bad = await A.admin.client.rpc("platform_set_forum_status", { p_forum_id: B.id, p_status: "deleted" })
  ok("12.11 only active/suspended are accepted", codeIs(bad, "invalid_status"), bad.error?.message)
  const off = await A.admin.client.rpc("platform_set_signup_enabled", { p_enabled: false })
  const offFlag = await anon.rpc("signup_enabled")
  ok("12.11 (control) an operator can close public sign-up", !off.error && offFlag.data === false, off.error?.message)
  const on = await A.admin.client.rpc("platform_set_signup_enabled", { p_enabled: true })
  const onFlag = await anon.rpc("signup_enabled")
  ok("12.11 (control) …and open it again", !on.error && onFlag.data === true, on.error?.message)
  must(await admin.from("platform_admins").delete().eq("user_id", A.admin.id), "demote")

  // §12.12 — hygiene: no service-role key in src/, no PUBLIC execute on definer functions
  const grep = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && fs.readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))
  ok("12.12 SUPABASE_SERVICE_ROLE_KEY is not referenced in src/", grep.length === 0, grep.join(", "))
  const { rows: defs } = await pg.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  `)
  // peek_invite is the ONE deliberate exception (a link holder may learn the
  // forum's name before signing in); anything else here is a regression.
  const anonExec = defs.filter((d) => d.anon_exec).map((d) => d.proname).filter((n) => n !== "peek_invite")
  ok("12.12 no SECURITY DEFINER function other than peek_invite is executable by anon", anonExec.length === 0, anonExec.join(", "))
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

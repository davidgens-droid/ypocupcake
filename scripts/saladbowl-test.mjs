#!/usr/bin/env node
// Salad Bowl — applies supabase/migrations/0026_saladbowl.sql to the TEST
// Supabase project (.env.test.local; never production) and plays whole games
// through the public RPCs as anonymous callers, asserting the rules.
//
//   node scripts/saladbowl-test.mjs            apply + test
//   node scripts/saladbowl-test.mjs --apply    apply the migration only
//
// Run with the sandbox disabled (the DB handshake needs a direct connection).
import fs from "node:fs"
import path from "node:path"
import pgPkg from "pg"
import { createClient } from "@supabase/supabase-js"

const { Client } = pgPkg
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env.test.local"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")] })
)
const prodEnv = fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : ""
if (!env.TEST_SUPABASE_URL || prodEnv.includes(new URL(env.TEST_SUPABASE_URL).host)) {
  console.error("TEST_SUPABASE_URL missing or matches production — refusing.")
  process.exit(2)
}

// The direct database host is IPv6-only. On a network without IPv6, fall back
// to the project's session pooler (IPv4), signing in as postgres.<project ref>.
let pg
async function connectPg() {
  const direct = new Client({ connectionString: env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 })
  try {
    await direct.connect()
    pg = direct
    return
  } catch (e) {
    await direct.end().catch(() => {})
    console.log(`· direct database host unreachable (${e.code ?? e.message}); using the session pooler`)
  }
  const u = new URL(env.TEST_DATABASE_URL)
  const ref = new URL(env.TEST_SUPABASE_URL).host.split(".")[0]
  const pooled = new Client({
    host: env.TEST_DATABASE_POOLER_HOST || "aws-0-us-west-1.pooler.supabase.com",
    port: 5432, user: `postgres.${ref}`, password: decodeURIComponent(u.password), database: "postgres",
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
  })
  await pooled.connect()
  pg = pooled
}
const anon = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${detail ? "  — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function rpc(fn, args) {
  const { data, error } = await anon.rpc(fn, args)
  if (error) return { ok: false, error: "rpc:" + error.message }
  return data
}
const create = (name, settings = {}) => rpc("saladbowl_create", { p_name: name, p_settings: settings })
const join = (code, name) => rpc("saladbowl_join", { p_code: code, p_name: name })
const state = async (code, token = null) => (await rpc("saladbowl_state", { p_code: code, p_token: token }))
const addWord = (code, token, text) => rpc("saladbowl_add_word", { p_code: code, p_token: token, p_text: text })
const removeWord = (code, token, id) => rpc("saladbowl_remove_word", { p_code: code, p_token: token, p_word: id })
const host = (code, token, action, payload = {}) => rpc("saladbowl_host", { p_code: code, p_token: token, p_action: action, p_payload: payload })
const turn = (code, token, action, payload = {}) => rpc("saladbowl_turn", { p_code: code, p_token: token, p_action: action, p_payload: payload })

async function apply() {
  const sql = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "0026_saladbowl.sql"), "utf8")
  await pg.query(sql)
  await pg.query(sql) // idempotency: a second run must also succeed
  await pg.query("notify pgrst, 'reload schema'")
  console.log("· 0026_saladbowl.sql applied twice (idempotent)")
  // PostgREST needs a moment to see the new functions.
  for (let i = 0; i < 20; i++) {
    const r = await anon.rpc("saladbowl_state", { p_code: "ZZZZ", p_token: null })
    if (!r.error) return
    await sleep(500)
  }
  throw new Error("PostgREST never picked up saladbowl_state")
}

/** Set up a game with `n` players (host first), words written, ready to start. */
async function setup(n, settings = {}, wordsEach = 2) {
  const h = await create("Host", { wordsPerPlayer: wordsEach, turnSeconds: 15, ...settings })
  if (!h.ok) throw new Error("create failed: " + JSON.stringify(h))
  const seats = [{ name: "Host", id: h.playerId, token: h.token }]
  for (let i = 1; i < n; i++) {
    const j = await join(h.code, `P${i}`)
    if (!j.ok) throw new Error("join failed: " + JSON.stringify(j))
    seats.push({ name: `P${i}`, id: j.playerId, token: j.token })
  }
  let k = 0
  for (const s of seats) for (let w = 0; w < wordsEach; w++) {
    const r = await addWord(h.code, s.token, `${settings.letter ?? "w"}ord ${++k}`)
    if (!r.ok) throw new Error("addWord failed: " + JSON.stringify(r))
  }
  return { code: h.code, seats, hostToken: h.token }
}
const seatOf = (g, playerId) => g.seats.find((s) => s.id === playerId)

async function tests() {
  // ── creation, joining, lobby ──────────────────────────────────────────────
  const bad = await create("   ")
  ok("create rejects an empty name", bad.ok === false && bad.error === "name", bad)
  const c = await create("  Dave  ", { theme: "x".repeat(200), letter: "bq", wordsPerPlayer: 99, turnSeconds: 1, rounds: ["oneword", "bogus", "oneword", "charades"], teams: [{ name: "" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }], skipRule: "nope" })
  ok("create returns code + seat", c.ok && /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(c.code) && !!c.token && !!c.playerId, c)
  let st = (await state(c.code, c.token)).state
  ok("settings are clamped and cleaned", st.settings.theme.length === 80 && st.settings.letter === "B" && st.settings.wordsPerPlayer === 10 && st.settings.turnSeconds === 15 && JSON.stringify(st.settings.rounds) === '["oneword","charades","describe"]' && st.settings.teams.length === 4 && st.settings.teams[0].name === "Lettuce Zeppelin" && st.settings.skipRule === "one", st.settings)
  ok("host is trimmed, seated on team 0, flagged host", st.me.name === "Dave" && st.me.host === true && st.me.team === 0)
  ok("lowercase code + stray spaces still find the game", (await state(" " + c.code.toLowerCase() + " ")).ok === true)
  ok("unknown code → no_game", (await state("AAAA")).error === "no_game")
  ok("garbage token → spectator view, seat=false", await (async () => { const r = await state(c.code, "not-a-token"); return r.ok && r.seat === false && r.state.me === null })())

  const j1 = await join(c.code, "Alex")
  const dup = await join(c.code, "alex")
  ok("join works; duplicate name (any case) refused", j1.ok && dup.ok === false && dup.error === "name_taken", dup)
  ok("letter rule enforced", (await addWord(c.code, j1.token, "apple")).error === "letter")
  const w1 = await addWord(c.code, j1.token, "  Banana   split ")
  ok("word accepted and cleaned", w1.ok && w1.state.me.words[0].text === "Banana split", w1)
  ok("duplicate word (case/punctuation-insensitive) refused", (await addWord(c.code, c.token, "banana SPLIT!")).error === "duplicate")
  ok("punctuation-only word refused", (await addWord(c.code, c.token, "!!!")).error === "invalid")
  ok("spectator cannot see anyone's words", await (async () => { const r = await state(c.code); return JSON.stringify(r.state).includes("Banana") === false })())
  ok("another player cannot see my words", await (async () => { const r = await state(c.code, c.token); return JSON.stringify(r.state).includes("Banana") === false })())
  ok("non-host cannot use host actions", (await host(c.code, j1.token, "shuffle")).error === "not_host")
  ok("cannot remove someone else's word", await (async () => { await removeWord(c.code, c.token, w1.state.me.words[0].id); const r = await state(c.code, j1.token); return r.state.me.words.length === 1 })())
  const lt = await host(c.code, c.token, "settings", { letter: "C" })
  ok("changing the letter returns non-matching words", lt.ok && (await state(c.code, j1.token)).state.me.words.length === 0, lt)
  ok("start refused without enough players", (await host(c.code, c.token, "start")).error === "need_players")
  const two = await host(c.code, c.token, "settings", { teams: [{ name: "A" }, { name: "B" }] })
  ok("reducing teams keeps everyone on a valid team", two.ok && two.state.players.every((p) => p.team === 0 || p.team === 1), two.state?.players)
  ok("assign without a team number is refused (no null team)", (await host(c.code, c.token, "assign", { playerId: j1.playerId })).error === "invalid")
  const rm = await host(c.code, c.token, "remove", { playerId: j1.playerId })
  ok("host can remove a player in the lobby; their seat stops working", rm.ok && (await state(c.code, j1.token)).seat === false)
  ok("host cannot remove themself", (await host(c.code, c.token, "remove", { playerId: c.playerId })).error === "invalid")

  // ── direct table access is closed ─────────────────────────────────────────
  for (const t of ["saladbowl_games", "saladbowl_players", "saladbowl_words", "saladbowl_plays"]) {
    const r = await anon.from(t).select("*").limit(1)
    ok(`anon cannot read ${t}`, !!r.error || (r.data ?? []).length === 0, r.error?.message)
  }
  const ins = await anon.from("saladbowl_pulse").insert({ game_id: "00000000-0000-0000-0000-000000000000", v: 1 })
  ok("anon cannot write saladbowl_pulse", !!ins.error)
  const pulse = await anon.from("saladbowl_pulse").select("*").limit(1)
  ok("anon can read saladbowl_pulse (version pings only)", !pulse.error && Object.keys(pulse.data?.[0] ?? { game_id: 1, v: 1 }).sort().join() === "game_id,v", pulse.error?.message)
  for (const fn of ["saladbowl__state", "saladbowl__bump", "saladbowl__advance", "saladbowl__begin_turn", "saladbowl__draw"]) {
    const { rows } = await pg.query(`select bool_or(has_function_privilege('anon', p.oid, 'execute')) as x, bool_or(p.prosecdef) as d from pg_proc p where p.proname = $1`, [fn])
    ok(`internal ${fn} is not anon-executable and not definer`, rows[0].x === false && rows[0].d === false, rows[0])
  }

  // ── a full game: 2 teams × 2 players, 2 words each, 3 rounds ───────────────
  const g = await setup(4, { rounds: ["describe", "charades", "oneword"], skipRule: "one" }, 2)
  ok("players are auto-balanced across teams", await (async () => { const s = (await state(g.code, g.hostToken)).state; return s.players.filter((p) => p.team === 0).length === 2 && s.players.filter((p) => p.team === 1).length === 2 })())
  ok("word limit per player enforced", (await addWord(g.code, g.hostToken, "word extra")).error === "full")
  const started = await host(g.code, g.hostToken, "start")
  ok("game starts in round 1, ready", started.ok && started.state.status === "playing" && started.state.turn.state === "ready" && started.state.round.index === 0 && started.state.bowl.left === 8, started)
  ok("words are locked once playing", (await addWord(g.code, g.hostToken, "word late")).error === "locked")
  st = started.state
  const first = seatOf(g, st.turn.playerId)
  const other = g.seats.find((s) => s.id !== first.id)
  ok("only the clue-giver can start the turn", (await turn(g.code, other.token, "start")).error === "not_your_turn")
  let t = await turn(g.code, first.token, "start")
  ok("start → active with a word and a clock", t.ok && t.state.turn.state === "active" && !!t.state.turn.word?.id && t.state.turn.endsAt > t.state.now, t.state?.turn)
  ok("nobody else sees the live word", await (async () => { const o = (await state(g.code, other.token)).state; const sp = (await state(g.code)).state; return o.turn.word === null && sp.turn.word === null && !JSON.stringify({ ...o, me: null }).includes(t.state.turn.word.text) && !JSON.stringify(sp).includes(t.state.turn.word.text) })())
  ok("another player cannot score", (await turn(g.code, other.token, "correct", { wordId: t.state.turn.word.id })).error === "not_your_turn")
  const w0 = t.state.turn.word
  t = await turn(g.code, first.token, "correct", { wordId: w0.id })
  ok("correct → team scores 1, new word", t.ok && t.state.teams[t.state.turn.team].score === 1 && t.state.turn.word.id !== w0.id && t.state.turn.got === 1 && t.state.bowl.left === 7, t.state?.turn)
  const again = await turn(g.code, first.token, "correct", { wordId: w0.id })
  ok("replayed 'correct' for the old word is a no-op", again.ok && again.state.teams[again.state.turn.team].score === 1 && again.state.turn.word.id === t.state.turn.word.id)
  const wSkip = t.state.turn.word
  t = await turn(g.code, first.token, "skip", { wordId: wSkip.id })
  ok("skip → different word, skip used up", t.ok && t.state.turn.word.id !== wSkip.id && t.state.turn.canSkip === false && t.state.turn.skips === 1, t.state?.turn)
  ok("second skip refused under the one-skip rule", (await turn(g.code, first.token, "skip", { wordId: t.state.turn.word.id })).error === "no_skips")
  const beforeUndo = t.state.turn.word
  t = await turn(g.code, first.token, "undo", { got: 1 })
  ok("undo → the point comes off and that word is back on screen", t.ok && t.state.turn.got === 0 && t.state.turn.word.id === w0.id && t.state.teams[t.state.turn.team].score === 0 && t.state.bowl.left === 8, t.state?.turn)
  ok("undo with a stale tally is a no-op", (await turn(g.code, first.token, "undo", { got: 1 })).state.turn.got === 0)
  t = await turn(g.code, first.token, "correct", { wordId: w0.id })
  ok("can score the undone word again", t.ok && t.state.turn.got === 1)

  // host pause / resume
  let p = await host(g.code, g.hostToken, "pause")
  ok("pause freezes the clock and hides the word", p.ok && p.state.turn.state === "paused" && p.state.turn.remainingMs > 0 && (await state(g.code, first.token)).state.turn.word === null, p.state?.turn)
  p = await host(g.code, g.hostToken, "resume")
  ok("resume restarts the clock", p.ok && p.state.turn.state === "active" && p.state.turn.endsAt > p.state.now)

  // let the clock run out; ANY poll should close the turn
  const cur = (await state(g.code, first.token)).state
  const waitMs = cur.turn.endsAt - cur.now + 1600
  console.log(`· waiting ${Math.round(waitMs / 1000)}s for the buzzer`)
  const liveWord = cur.turn.word
  await sleep(waitMs)
  const late = await turn(g.code, first.token, "correct", { wordId: liveWord.id })
  ok("a tap after the buzzer + grace does not score", late.ok && late.state.turn.state === "review" && late.state.turn.got === 1, late.state?.turn)
  let rv = (await state(g.code, first.token)).state
  ok("review: clue-giver sees won words + the buzzer word", rv.turn.state === "review" && rv.turn.reason === "time" && rv.turn.words.length === 2 && rv.turn.words.filter((w) => w.got).length === 1 && rv.turn.words.some((w) => w.buzzer && !w.got && w.id === liveWord.id), rv.turn)
  const rvOther = (await state(g.code, other.token)).state
  ok("review: everyone else sees only the won words", rvOther.turn.words.length === 1 && rvOther.turn.words[0].got === true && !JSON.stringify({ ...rvOther, me: null }).includes(liveWord.text), rvOther.turn)
  let tg = await turn(g.code, first.token, "toggle", { wordId: liveWord.id, got: true })
  ok("clue-giver can award the buzzer word", tg.ok && tg.state.teams[tg.state.turn.team].score === 2, tg.state?.teams)
  tg = await turn(g.code, first.token, "toggle", { wordId: liveWord.id, got: false })
  ok("…and take it back", tg.ok && tg.state.teams[tg.state.turn.team].score === 1)
  ok("toggle refuses a word that was not in this turn", await (async () => { const r = await turn(g.code, first.token, "toggle", { wordId: beforeUndo.id === liveWord.id ? wSkip.id : beforeUndo.id, got: true }); return r.ok && r.state.teams[r.state.turn.team].score === 1 })())
  const notYet = g.seats.find((s) => s.id !== first.id && s.token !== g.hostToken)
  ok("a bystander cannot advance straight away", (await turn(g.code, notYet.token, "advance", { since: rv.turn.since })).error === "wait")
  ok("advance with a stale 'since' is a no-op", (await turn(g.code, first.token, "advance", { since: 1 })).state.turn.state === "review")
  const firstTeam = rv.turn.team
  let adv = await turn(g.code, first.token, "advance", { since: rv.turn.since })
  ok("advance → other team is up, ready", adv.ok && adv.state.turn.state === "ready" && adv.state.turn.team !== firstTeam && adv.state.turn.playerId !== first.id, adv.state?.turn)
  const dbl = await turn(g.code, first.token, "advance", { since: rv.turn.since })
  ok("double advance moves one step only", dbl.ok && dbl.state.turn.playerId === adv.state.turn.playerId && dbl.state.turn.state === "ready")

  // rotation: play turns that score nothing (host ends them) and record the order
  const order = [first.id]
  for (let i = 0; i < 4; i++) {
    const s = (await state(g.code, g.hostToken)).state
    order.push(s.turn.playerId)
    await turn(g.code, seatOf(g, s.turn.playerId).token, "start")
    const e = await host(g.code, g.hostToken, "end_turn")
    if (i === 0) ok("host can end a turn → review with reason 'host'", e.ok && e.state.turn.state === "review" && e.state.turn.reason === "host", e.state?.turn)
    await turn(g.code, g.hostToken, "advance", { since: e.state.turn.since })
  }
  ok("teams alternate and each team rotates through its players", order[0] !== order[1] && order[4] === order[0] && new Set(order.slice(0, 4)).size === 4, order)

  // skip_player
  let s0 = (await state(g.code, g.hostToken)).state
  const skipped = s0.turn.playerId
  const sp = await host(g.code, g.hostToken, "skip_player")
  ok("skip_player passes to a teammate", sp.ok && sp.state.turn.playerId !== skipped && sp.state.turn.team === s0.turn.team && sp.state.turn.state === "ready")

  // play out round 1: current player wins every remaining word → bowl empties
  async function clearBowl() {
    let s = (await state(g.code, g.hostToken)).state
    const giver = seatOf(g, s.turn.playerId)
    let r = await turn(g.code, giver.token, "start")
    let guard = 0
    while (r.state.turn.state === "active" && guard++ < 50) r = await turn(g.code, giver.token, "correct", { wordId: r.state.turn.word.id })
    return { giver, r }
  }
  let { giver, r } = await clearBowl()
  ok("emptying the bowl ends the turn with time left", r.state.turn.state === "review" && r.state.turn.reason === "bowl" && r.state.turn.leftoverMs > 5000 && r.state.bowl.left === 0, r.state?.turn)
  let re = await turn(g.code, giver.token, "advance", { since: r.state.turn.since })
  ok("→ round-end screen, carry-over announced", re.ok && re.state.turn.state === "round_end" && re.state.turn.carryNext === true && re.state.onDeck.playerId === giver.id && re.state.round.index === 0, re.state?.turn)
  ok("round 1 scores add up to the bowl", re.state.teams.reduce((a, x) => a + x.rounds[0], 0) === 8, re.state.teams)
  let nx = await turn(g.code, giver.token, "advance", { since: re.state.turn.since })
  ok("next round: same player opens with their leftover seconds, bowl refilled", nx.ok && nx.state.round.index === 1 && nx.state.round.type === "charades" && nx.state.turn.state === "ready" && nx.state.turn.playerId === giver.id && nx.state.turn.remainingMs > 5000 && nx.state.turn.remainingMs < 15000 && nx.state.bowl.left === 8, nx.state?.turn)
  let cs = await turn(g.code, giver.token, "start")
  ok("carry-over turn runs on the leftover clock", cs.ok && cs.state.turn.endsAt - cs.state.now < 15000 && cs.state.turn.endsAt - cs.state.now > 4000, cs.state?.turn)
  const e2 = await host(g.code, g.hostToken, "end_turn")
  await turn(g.code, g.hostToken, "advance", { since: e2.state.turn.since })

  // mid-game roster changes
  const late1 = await join(g.code, "Latecomer")
  ok("a latecomer can join mid-game and lands on a team", late1.ok && (await state(g.code, late1.token)).state.me.team !== null)
  s0 = (await state(g.code, g.hostToken)).state
  const curSeat = seatOf(g, s0.turn.playerId)
  if (curSeat.token !== g.hostToken) {
    const rmCur = await host(g.code, g.hostToken, "remove", { playerId: curSeat.id })
    ok("removing the player who is up passes the turn to a teammate", rmCur.ok && rmCur.state.turn.playerId !== curSeat.id && rmCur.state.turn.team === s0.turn.team && rmCur.state.bowl.total === 8, rmCur.state?.turn)
    g.seats = g.seats.filter((s) => s.id !== curSeat.id)
  } else {
    ok("removing the player who is up passes the turn to a teammate", true)
  }
  g.seats.push({ name: "Latecomer", id: late1.playerId, token: late1.token })
  const reis = await host(g.code, g.hostToken, "reissue", { playerId: late1.playerId })
  ok("reissue gives a new seat token and kills the old one", reis.ok && !!reis.token && reis.token !== late1.token && (await state(g.code, late1.token)).seat === false && (await state(g.code, reis.token)).seat === true, reis.error)
  g.seats.find((s) => s.id === late1.playerId).token = reis.token
  const adj = await host(g.code, g.hostToken, "adjust", { team: 0, delta: 1 })
  ok("host can adjust a score", adj.ok && adj.state.teams[0].adjust === 1 && adj.state.teams[0].score === adj.state.teams[0].rounds.reduce((a, b) => a + b, 0) + 1, adj.state?.teams)
  await host(g.code, g.hostToken, "adjust", { team: 0, delta: -1 })

  // finish rounds 2 and 3
  ;({ giver, r } = await clearBowl())
  re = await turn(g.code, giver.token, "advance", { since: r.state.turn.since })
  nx = await turn(g.code, giver.token, "advance", { since: re.state.turn.since })
  ok("round 3 begins", nx.ok && nx.state.round.index === 2 && nx.state.round.type === "oneword", nx.state?.round)
  ;({ giver, r } = await clearBowl())
  const fin = await turn(g.code, giver.token, "advance", { since: r.state.turn.since })
  ok("emptying the last bowl finishes the game", fin.ok && fin.state.status === "finished" && !!fin.state.final, fin.state?.status)
  const total = fin.state.teams.reduce((a, x) => a + x.score, 0)
  ok("final scores = 3 rounds × 8 words", total === 24, fin.state.teams)
  ok("finale has MVP, best turn, fastest word and the full word list with authors", !!fin.state.final.mvp?.playerId && fin.state.final.bestTurn?.count >= 8 && typeof fin.state.final.fastest?.ms === "number" && fin.state.final.words.length === 8 && fin.state.final.words.every((w) => w.author && w.text), fin.state.final)
  ok("joining a finished game is refused", (await join(g.code, "Too Late")).error === "game_over")
  const enc = await host(g.code, g.hostToken, "rematch")
  ok("encore → lobby, same teams, empty bowl, removed seats gone", enc.ok && enc.state.status === "lobby" && enc.state.bowl.total === 0 && enc.state.players.length === g.seats.length && enc.state.me.words.length === 0, enc.state)

  // ── skip rules ─────────────────────────────────────────────────────────────
  const gn = await setup(4, { skipRule: "none" }, 1)
  let sn = (await host(gn.code, gn.hostToken, "start")).state
  let ng = seatOf(gn, sn.turn.playerId)
  let nr = await turn(gn.code, ng.token, "start")
  ok("skipRule none → canSkip false and skip refused", nr.state.turn.canSkip === false && (await turn(gn.code, ng.token, "skip", { wordId: nr.state.turn.word.id })).error === "no_skips")

  const gu = await setup(4, { skipRule: "unlimited", carryOver: false }, 1)
  sn = (await host(gu.code, gu.hostToken, "start")).state
  ng = seatOf(gu, sn.turn.playerId)
  nr = await turn(gu.code, ng.token, "start")
  const seen = new Set([nr.state.turn.word.id])
  for (let i = 0; i < 3; i++) { nr = await turn(gu.code, ng.token, "skip", { wordId: nr.state.turn.word.id }); seen.add(nr.state.turn.word?.id) }
  ok("unlimited skips walk through every word before repeating", nr.ok && seen.size === 4, [...seen])
  nr = await turn(gu.code, ng.token, "skip", { wordId: nr.state.turn.word.id })
  ok("…then cycle back to skipped words", nr.ok && !!nr.state.turn.word)
  let guard = 0
  while (nr.state.turn.state === "active" && guard++ < 10) nr = await turn(gu.code, ng.token, "correct", { wordId: nr.state.turn.word.id })
  const re2 = await turn(gu.code, ng.token, "advance", { since: nr.state.turn.since })
  ok("carry-over off → no carry announced", re2.state.turn.state === "round_end" && re2.state.turn.carryNext === false && re2.state.onDeck.playerId !== ng.id, re2.state?.turn)
  const nx2 = await turn(gu.code, ng.token, "advance", { since: re2.state.turn.since })
  ok("…and the next team opens the round on a full clock", nx2.state.turn.playerId !== ng.id && nx2.state.turn.remainingMs === null && nx2.state.round.index === 1, nx2.state?.turn)
  const endG = await host(gu.code, gu.hostToken, "end_game")
  ok("host can end the game early", endG.ok && endG.state.status === "finished" && !!endG.state.final)

  // ── always three rounds; the host only picks the order ────────────────────
  const r3 = await create("Rounds", { rounds: ["charades"] })
  ok("a short rounds list is topped up to the classic three", JSON.stringify((await state(r3.code, r3.token)).state.settings.rounds) === '["charades","describe","oneword"]')
  const r3b = await host(r3.code, r3.token, "settings", { rounds: ["oneword", "sounds", "describe", "charades", "oneword"] })
  ok("unknown round types are dropped; order is kept", JSON.stringify(r3b.state.settings.rounds) === '["oneword","describe","charades"]', r3b.state?.settings?.rounds)

  // ── got-it → undo → got-it is not a free skip ─────────────────────────────
  const gz = await setup(4, { skipRule: "none" }, 3)
  sn = (await host(gz.code, gz.hostToken, "start")).state
  ng = seatOf(gz, sn.turn.playerId)
  nr = await turn(gz.code, ng.token, "start")
  const zA = nr.state.turn.word
  nr = await turn(gz.code, ng.token, "correct", { wordId: zA.id })
  const zB = nr.state.turn.word
  nr = await turn(gz.code, ng.token, "undo", { got: 1 })
  nr = await turn(gz.code, ng.token, "correct", { wordId: zA.id })
  ok("after an undo, the word that was pushed off screen comes straight back", nr.ok && nr.state.turn.word.id === zB.id, { expected: zB, got: nr.state?.turn?.word })
  ok("malformed toggle / assign payloads are refused cleanly, not crashed", await (async () => {
    const e = await host(gz.code, gz.hostToken, "end_turn")
    const t1 = await turn(gz.code, ng.token, "toggle", { wordId: zA.id, got: "maybe" })
    const a1 = await host(gz.code, gz.hostToken, "assign", { playerId: ng.id, team: 1e10 })
    const a2 = await host(gz.code, gz.hostToken, "adjust", { team: 1e10, delta: 1 })
    return e.ok && t1.ok && a1.error === "invalid" && a2.error === "invalid"
  })())

  // ── the host cannot read a player's words by reissuing their seat ─────────
  const gh = await create("Host", { wordsPerPlayer: 2 })
  const victim = await join(gh.code, "Victim")
  await addWord(gh.code, victim.token, "secret one")
  const stolen = await host(gh.code, gh.token, "reissue", { playerId: victim.playerId })
  const peekView = (await state(gh.code, stolen.token)).state
  ok("a reissued seat does not reveal words written before it", stolen.ok && peekView.me.words.length === 0 && !JSON.stringify(peekView).includes("secret one"), peekView.me)
  ok("…and the player can write a fresh set", (await addWord(gh.code, stolen.token, "new one")).ok && (await addWord(gh.code, stolen.token, "new two")).ok)

  // ── rotation survives a latecomer ─────────────────────────────────────────
  const gr = await setup(4, {}, 2)
  sn = (await host(gr.code, gr.hostToken, "start")).state
  const seenOrder = []
  async function passTurn() {
    const s = (await state(gr.code, gr.hostToken)).state
    seenOrder.push(s.turn.playerId)
    await turn(gr.code, seatOf(gr, s.turn.playerId).token, "start")
    const e = await host(gr.code, gr.hostToken, "end_turn")
    await turn(gr.code, gr.hostToken, "advance", { since: e.state.turn.since })
  }
  for (let i = 0; i < 3; i++) await passTurn()
  const lateR = await join(gr.code, "Late")
  gr.seats.push({ name: "Late", id: lateR.playerId, token: lateR.token })
  for (let i = 0; i < 7; i++) await passTurn()
  const lateTeam = (await state(gr.code, lateR.token)).state.me.team
  const teamOf = Object.fromEntries((await state(gr.code, gr.hostToken)).state.players.map((p) => [p.id, p.team]))
  const lateTeamOrder = seenOrder.filter((id) => teamOf[id] === lateTeam)
  ok("nobody goes twice in a row within a team after someone joins late", lateTeamOrder.every((id, i) => i === 0 || id !== lateTeamOrder[i - 1]) && lateTeamOrder.includes(lateR.playerId), lateTeamOrder)

  // ── concurrency: a burst of identical taps scores once ────────────────────
  const gc = await setup(4, {}, 2)
  sn = (await host(gc.code, gc.hostToken, "start")).state
  ng = seatOf(gc, sn.turn.playerId)
  nr = await turn(gc.code, ng.token, "start")
  const burst = await Promise.all(Array.from({ length: 6 }, () => turn(gc.code, ng.token, "correct", { wordId: nr.state.turn.word.id })))
  const after = (await state(gc.code, ng.token)).state
  ok("six simultaneous taps on one word score exactly one point", burst.every((b) => b.ok) && after.turn.got === 1 && after.teams[after.turn.team].score === 1, after.turn)
  const starts = await Promise.all(gc.seats.map((s) => turn(gc.code, s.token, "start")))
  ok("stray 'start' taps mid-turn change nothing", starts.filter((x) => x.ok).length === 1 && (await state(gc.code, ng.token)).state.turn.no === 1)
}

try {
  await connectPg()
  await apply()
  if (!process.argv.includes("--apply")) await tests()
} catch (e) {
  console.error("\nAborted:", e?.stack ?? e)
  fail++
} finally {
  await pg?.end().catch(() => {})
}
console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) console.log("Failed:\n  " + failures.join("\n  "))
process.exit(fail ? 1 : 0)

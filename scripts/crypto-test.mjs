#!/usr/bin/env node
// Unit tests for the end-to-end encryption primitives, run on Node's
// WebCrypto (the same algorithms the browser uses). The TypeScript module is
// client-only, so the primitives are re-implemented here byte-for-byte from
// the spec (§4) — this is a check of the DESIGN as well as of the browser code:
// an envelope produced here must open in the app and vice versa.
//
//   npm run test:crypto

import { webcrypto as crypto } from "node:crypto"
import assert from "node:assert/strict"

const enc = (s) => new TextEncoder().encode(s)
const dec = (b) => new TextDecoder().decode(b)
const b64u = (b) => Buffer.from(b).toString("base64url")
const unb64u = (s) => new Uint8Array(Buffer.from(s, "base64url"))
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n))

async function hkdf(ikm, salt, info) {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc(info) }, base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"])
}
async function pbkdf2(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"])
}
const wrap = (uk, wk) => crypto.subtle.wrapKey("raw", uk, wk, "AES-KW")
const unwrap = (w, wk, extractable) => crypto.subtle.unwrapKey("raw", w, wk, "AES-KW", { name: "AES-GCM", length: 256 }, extractable, ["encrypt", "decrypt"])
async function encryptJson(uk, value, aad) {
  const iv = rnd(12)
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc(aad), tagLength: 128 }, uk, enc(JSON.stringify(value)))
  return `v1.${b64u(iv)}.${b64u(new Uint8Array(ct))}`
}
async function decryptJson(uk, envelope, aad) {
  const [v, iv, ct] = envelope.split(".")
  assert.equal(v, "v1")
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(iv), additionalData: enc(aad), tagLength: 128 }, uk, unb64u(ct))
  return JSON.parse(dec(new Uint8Array(pt)))
}

let pass = 0, fail = 0
async function test(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`) } catch (e) { fail++; console.log(`FAIL  ${name}  — ${e.message}`) }
}

const uk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
const member = "11111111-1111-1111-1111-111111111111"
const meetingA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const meetingB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const aad = (m) => `cupcake:update:v1:${member}:${m}`
const update = { qol: { physical_health: 7 }, business: { situation: "Sold the division." } }

await test("encrypt → decrypt round trip", async () => {
  const env = await encryptJson(uk, update, aad(meetingA))
  assert.match(env, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{24,}$/)
  assert.deepEqual(await decryptJson(uk, env, aad(meetingA)), update)
})
await test("ciphertext is bound to its row (AAD): fails under another meeting id", async () => {
  const env = await encryptJson(uk, update, aad(meetingA))
  await assert.rejects(() => decryptJson(uk, env, aad(meetingB)))
})
await test("ciphertext never contains the plaintext", async () => {
  const env = await encryptJson(uk, update, aad(meetingA))
  assert.ok(!env.includes("Sold"))
  assert.ok(!Buffer.from(env.split(".")[2], "base64url").toString("latin1").includes("Sold"))
})
await test("passphrase wrap → unwrap; wrong passphrase fails cleanly", async () => {
  const salt = rnd(16)
  const wk = await pbkdf2("correct horse battery staple", salt, 600_000)
  const wrapped = await wrap(uk, wk)
  assert.equal(new Uint8Array(wrapped).length, 40)
  const back = await unwrap(wrapped, wk, false)
  assert.equal(back.extractable, false)
  const env = await encryptJson(uk, update, aad(meetingA))
  assert.deepEqual(await decryptJson(back, env, aad(meetingA)), update)
  const wrong = await pbkdf2("correct horse battery stapler", salt, 600_000)
  await assert.rejects(() => unwrap(wrapped, wrong, false))
})
await test("passphrase is NFKC-normalised (composed vs decomposed é)", async () => {
  const salt = rnd(16)
  const a = await pbkdf2("café au lait 12345", salt, 1000)
  const b = await pbkdf2("café au lait 12345", salt, 1000)
  const w = await wrap(uk, a)
  await unwrap(w, b, false)
})
await test("recovery code (20 bytes, HKDF) wrap → unwrap", async () => {
  const code = rnd(20)
  const salt = rnd(32)
  const wk = await hkdf(code, salt, "cupcake:uk-wrap:recovery:v1")
  const wrapped = await wrap(uk, wk)
  const again = await hkdf(code, salt, "cupcake:uk-wrap:recovery:v1")
  await unwrap(wrapped, again, false)
  const other = await hkdf(rnd(20), salt, "cupcake:uk-wrap:recovery:v1")
  await assert.rejects(() => unwrap(wrapped, other, false))
})
await test("passkey PRF output (32 bytes, HKDF) wrap → unwrap; different salt fails", async () => {
  const prf = rnd(32)
  const salt = rnd(32)
  const wrapped = await wrap(uk, await hkdf(prf, salt, "cupcake:uk-wrap:passkey:v1"))
  await unwrap(wrapped, await hkdf(prf, salt, "cupcake:uk-wrap:passkey:v1"), false)
  const otherSalt = await hkdf(prf, rnd(32), "cupcake:uk-wrap:passkey:v1")
  await assert.rejects(() => unwrap(wrapped, otherSalt, false))
})
await test("Crockford base32 recovery code: 32 chars, round trip, tolerant parse", async () => {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const encode = (bytes) => { let bits = 0, value = 0, out = ""; for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 } } if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]; return out }
  const decode = (s) => { const out = new Uint8Array(Math.floor((s.length * 5) / 8)); let bits = 0, value = 0, i = 0; for (const ch of s) { value = (value << 5) | ALPHABET.indexOf(ch); bits += 5; if (bits >= 8) { out[i++] = (value >>> (bits - 8)) & 255; bits -= 8 } } return out }
  const bytes = rnd(20)
  const raw = encode(bytes)
  assert.equal(raw.length, 32)
  const display = raw.match(/.{1,4}/g).join("-")
  const cleaned = display.toLowerCase().replace(/[\s-]/g, "").toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0")
  assert.deepEqual(decode(cleaned), bytes)
})
await test("envelope with a tampered tag is rejected", async () => {
  const env = await encryptJson(uk, update, aad(meetingA))
  const [v, iv, ct] = env.split(".")
  const bytes = unb64u(ct); bytes[bytes.length - 1] ^= 1
  await assert.rejects(() => decryptJson(uk, `${v}.${iv}.${b64u(bytes)}`, aad(meetingA)))
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

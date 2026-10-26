# End-to-end encrypted member updates — design

**Date:** 2026-10-25 · **Status:** approved in conversation, pending written review · **Scope:** members' private monthly updates (and the AI pattern cards derived from them). Forum-shared content is out of scope.

## 1. Goal and decisions

A member's monthly update (the 5% Reflection) must be unreadable to everyone but that member — including the forum's admins and moderator, the platform operator, Supabase, and anyone holding a copy of the database — in the way a password manager's vault is unreadable to the password-manager company. Decisions taken with the owner:

| Decision | Choice |
|---|---|
| Scope | Private updates and AI pattern cards only. Forum-shared content (parking lot, commitments, photos, charter, meetings, roster) keeps today's RLS protections. |
| Unlock method | Device passkey (Face ID / fingerprint / Windows Hello) via the WebAuthn PRF extension, with a passphrase fallback where PRF is unavailable or declined. Every member also gets a one-time recovery code. |
| Rollout | Mandatory for every member of every forum. One code path. |
| QoL scores | The four Quality-of-Life integers stay readable (own columns), because `forum_qol_history()` legitimately shows them to three roles. |
| AI features | Keep working. The device decrypts and sends the text with each AI request; the server forwards it to Anthropic and stores nothing. |
| Email-my-update | Removed (it would carry plaintext through Resend). Replaced by two device-side buttons: **Print** and **Save as PDF** (immediate download of a real PDF). |
| Sign-in | Unchanged (email code). Passkeys are registered with their public key kept, so they can become the sign-in factor when Supabase supports first-factor passkeys, without redoing this work. |

## 2. Threat model

**Protected (stored data is zero-knowledge):** anyone with read access to the database or storage — admins, moderators, the platform operator, Supabase staff, a database breach, a subpoena for the database — sees only ciphertext for updates and pattern cards. The server never receives a member's update key, passphrase or recovery code.

**Not protected, stated plainly:**
- A member's unlocked device or open browser session (same as any password manager's unlocked state).
- A tampered build of the web app (XSS or supply chain) running while a member is unlocked — the shared limitation of every browser-delivered end-to-end encrypted service, including 1Password's web app.
- The AI pass-through: while a member actively uses brain-dump, Interview Me or pattern cards, their text passes through the Next.js server to Anthropic in the clear and is not stored. The AI screens say so.
- Metadata: email, name, which meetings have an update, started/finalized/ready status and timestamps, token counts, the four QoL scores, and everything a member chooses to publish (parking-lot topic, commitment).
- Members who never return after the switchover keep readable rows until they do (§11).

## 3. Member experience

**One-time setup.** The first time a member opens the update builder or past updates after the switchover (new members: the first time they start an update), a screen explains: "Protect your updates. From now on only you can read them — not the moderator, not the people who run Cupcake." Primary button **Use Face ID / fingerprint** (label adapts: Touch ID, Windows Hello, "Use this device's screen lock"); secondary **Use a passphrase instead** (minimum 12 characters, shown-once strength hint). Then the **recovery code** is shown once with Copy and Save-as-file buttons and a required checkbox "I've saved this somewhere safe". Existing members' past updates are then encrypted on the device with a progress note ("Protecting 14 updates…").

**Day to day.** On an unlocked device nothing changes. A device stays unlocked until the member signs out, taps **Lock now**, or 30 days pass; then one passkey tap or the passphrase. Never a prompt on every visit.

**New device.** Email-code sign-in as today. Synced passkeys (iCloud Keychain, Google Password Manager) work immediately. Otherwise: passphrase or recovery code, then an offer to add this device's passkey.

**Lost everything.** **Start fresh** under Me → Security: type RESET; deletes the member's encrypted updates, pattern cards and key copies; setup runs again. Copy says plainly nobody can recover them. Published topics, commitments and QoL scores are unaffected.

**Me → Security** section: change passphrase (or add one), registered devices with name and last-used date and Remove, generate a new recovery code (old one stops working), Lock now, Start fresh. Changing security settings requires a fresh unlock (passkey tap or passphrase) in that moment.

**Print / Save as PDF.** Two separate buttons on the update page and on each past update. Print opens the device-rendered print view and the browser print dialog. Save as PDF builds a real PDF on the device (selectable text, the print layout) and downloads it immediately as `YPO-Update-<forum>-<yyyy-mm-dd>.pdf`; on iOS this shows the Save-to-Files/share sheet. Nothing leaves the device.

## 4. Cryptography

All primitives are WebCrypto (`crypto.subtle`); no custom crypto, no new crypto dependencies.

- **Update key (UK):** per member, AES-GCM-256, generated on the device (`generateKey`, extractable only for the moment of wrapping). Never transmitted unwrapped.
- **Wrapping:** AES-KW (RFC 3394) with a 256-bit wrapping key derived per method:
  - *Passkey:* WebAuthn PRF output (32 bytes, per credential, evaluated with a per-credential random 32-byte salt stored in the clear) → HKDF-SHA256 (salt: the same stored salt, info `cupcake:uk-wrap:passkey:v1`) → AES-KW key.
  - *Passphrase:* NFKC-normalised passphrase → PBKDF2-HMAC-SHA256, 600,000 iterations, random 16-byte salt → AES-KW key.
  - *Recovery code:* 20 random bytes shown as 32 Crockford-base32 characters in 8 groups of 4; → HKDF-SHA256 (random 32-byte salt, info `cupcake:uk-wrap:recovery:v1`) → AES-KW key. High entropy, so no slow KDF is needed.
- **Content encryption:** AES-GCM-256 under UK, 12-byte random IV, 128-bit tag. Additional authenticated data binds the ciphertext to its row: `cupcake:update:v1:<member_id>:<meeting_id>` for updates, `cupcake:card:v1:<member_id>:<card_id>` for pattern cards (card ids are generated on the device before encryption). Envelope: `v1.<base64url iv>.<base64url ciphertext||tag>`. A ciphertext moved to another row fails to decrypt.
- **Unlocked-key cache (device):** after unwrapping, UK is imported a second time as a **non-extractable** CryptoKey and stored in IndexedDB (`cupcake-keys`, one record per member id) with `locked_after = now + 30 days`. Reads past that time delete the record. Lock now / sign out delete it. The extractable UK exists only transiently in memory during setup and when adding a wrap, each of which requires a fresh unlock.
- **Passkeys:** `navigator.credentials.create` with `rp.id = <host>`, `user.id = member uuid bytes`, `pubKeyCredParams` ES256 and RS256, `authenticatorSelection { residentKey: "preferred", userVerification: "required" }`, extension `prf { eval { first: salt } }`. Because some authenticators only evaluate PRF on `get`, registration is create → immediate `get` with `allowCredentials: [new id]` and the same salt; if `prf.results.first` is absent the credential is discarded and the UI offers the passphrase path. Unlock: `get` with all stored credential ids and `prf.evalByCredential`. The server never verifies assertions (passkeys are a key-derivation device here, not authentication); the public key and transports are stored for a future sign-in use. Passkeys are origin-bound: the test server (localhost:3001) and production each have their own.

## 5. Data model — migration `0024_e2e_updates.sql`

- `member_key_wraps` (`id uuid pk`, `member_id uuid not null references members(id) on delete cascade`, `kind text check (kind in ('passkey','passphrase','recovery'))`, `credential_id text unique` (passkey), `public_key text` (passkey, base64url COSE), `transports text[]`, `prf_salt bytea`, `kdf_salt bytea`, `kdf_iterations int`, `wrapped_key bytea not null`, `label text`, `created_at`, `last_used_at`). RLS: exactly one self-only `for all using (member_id = auth.uid()) with check (member_id = auth.uid())` policy, added to the suite's member-private list (§12.8). At most one `passphrase` and one `recovery` wrap per member (partial unique indexes).
- `updates`: add `content_enc text`, `qol_physical int`, `qol_mental int`, `qol_financial int`, `qol_friends int` (each `check (between 1 and 10)`), `key_version int not null default 1`; `content` becomes nullable; constraint `updates_plain_xor_enc check (content is null or content_enc is null)`. One-off backfill of the four QoL columns from `content -> 'qol'` for every existing row.
- `ai_pattern_cards`: add `payload_enc text`; `title`/`detail`/`topic_suggestion` nullable; constraint `cards_plain_xor_enc check (title is null or payload_enc is null)`. **All existing cards are deleted** by the migration (they were derived from, and are as sensitive as, plaintext updates; they regenerate on the device).
- `forum_qol_history()` rewritten to read the four columns (same signature, same role gate).
- RPCs (SECURITY DEFINER, `set search_path = public`, revoke public/anon, grant authenticated, `auth.uid()` guard):
  - `setup_member_keys(p_wraps jsonb) returns void` — refuses (`already_set_up`) if the member has wraps; validates each wrap's kind/fields; inserts all in one transaction. Requires at least one of passkey/passphrase plus exactly one recovery wrap.
  - `reset_member_encrypted_data() returns void` — deletes the caller's `updates` rows that have `content_enc` (and nulls any legacy `content` rows), their `ai_pattern_cards`, and their `member_key_wraps`, in one transaction.
  - Everything else (add/remove/replace a wrap, migrate rows, save drafts) goes through the existing self-only RLS from server actions.
- `member_keys_status()` view-like helper is unnecessary: "set up" = `exists (select 1 from member_key_wraps where member_id = auth.uid())`, read by the app under RLS.

## 6. Client architecture

- `src/lib/crypto/` (every file starts with `import "client-only"` so a server import fails the build): `keys.ts` (generate/wrap/unwrap, KDFs), `content.ts` (encrypt/decrypt envelopes with AAD), `passkey.ts` (WebAuthn create/get with PRF, base64url helpers), `cache.ts` (IndexedDB unlocked-key store, lock timer), `recovery.ts` (code generation/formatting/parsing).
- `src/components/app/security/`: `UnlockGate` (wraps any content that needs the key: shows Setup if no wraps, Unlock if locked, otherwise renders children with the key via context), `SetupFlow`, `UnlockDialog`, `SecuritySettings` (Me → Security), `RecoveryCodeCard`.
- Update builder, past updates list/detail, print view, PDF export, pattern cards: all become client-rendered under `UnlockGate`. Server components fetch rows (`content_enc`, status, dates) and pass them down; no server code decrypts.
- `src/components/app/update-builder/update-builder.tsx`: decrypts initial `content_enc`; before every autosave and finalize encrypts the validated `UpdateContent` and extracts the QoL integers.
- Print: `/print/update/[meetingId]` becomes a server shell + client body that decrypts and renders the existing layout; **Print** calls `window.print()`. **Save as PDF** lazy-loads `@react-pdf/renderer` (dynamic import on click), renders an `UpdatePdf` document mirroring the print layout, `pdf(...).toBlob()`, and triggers a download named `YPO-Update-<forum>-<yyyy-mm-dd>.pdf`.
- Dashboard pattern cards: a client component that, once unlocked, compares the finalized count with the newest card's `source_update_count`, and if different decrypts the last six finalized updates, POSTs them to `/api/patterns`, encrypts the returned cards and saves them via `savePatternCards`. Rendering of cards is device-side after decrypt. The dashboard no longer blocks on AI generation.

## 7. Server changes

- `src/lib/updates/actions.ts`: `saveUpdateDraft({ meetingId, contentEnc, qol })` and `finalizeUpdate({ meetingId, contentEnc, qol, ready, publishTopic?, commitment? })`. Server validates the envelope shape (`^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$`, size cap 256 KB), QoL ints 1–10, and the optional plaintext `publishTopic { text, context, urgency, tool_category, exploration_format }` / `commitment { text, horizon }` with the existing schemas; side effects unchanged. Never writes `content`.
- New actions: `migrateUpdates([{ meetingId, contentEnc, qol }])` (own rows: set `content_enc`, `content = null`), `setupMemberKeys`, `addPasskeyWrap`, `removeWrap`, `replacePassphraseWrap`, `replaceRecoveryWrap`, `resetEncryptedData`, `savePatternCards`. All return `{ok,error}`.
- Removed: `emailUpdateToSelf` and its UI.
- AI: `generateUpdateFromBrainDump({ brainDump, existing?, history: UpdateContent[] })` and the interview turn take the member's recent finalized updates from the client (≤3 / ≤2, validated with `updateContentSchema`) instead of reading the database. `/api/patterns` route handler (`maxDuration 120`) takes `{ updates: UpdateContent[] }` (≤6) and returns cards; fair-use caps and `ai_interactions` logging unchanged. No AI code path reads `updates` or `ai_pattern_cards` content.
- `src/lib/ai/patterns.ts` server-side generation during dashboard render is removed.
- A build-time guard: `client-only` on the crypto module; a suite check greps server files (`src/app/**/page.tsx` without `"use client"`, `src/lib/**/actions.ts`, `src/app/api/**`) for imports of `@/lib/crypto`.

## 8. AI features under encryption

Brain-dump / Refine / Interview Me: unchanged prompts; the context the server used to fetch itself is now supplied by the device, decrypted locally. Pattern cards: generated on demand from the device (§6). Listening mode and TTS: untouched. Each AI entry point carries one line: "What you type or say here is sent to the AI to do its job and isn't stored. Your saved update stays encrypted."

## 9. QoL scores and side effects

QoL integers are written in the clear by the device on every save; `forum_qol_history()` reads them. Publishing a topic / making a commitment: the device sends those two plaintext items only when the member opted in, exactly as they become shared today. The `attendees.ready` mirror is unchanged.

## 10. Recovery, reset, devices

As in §3. Implementation notes: changing or adding a wrap requires the extractable UK, so the UI performs a fresh unlock first and discards the extractable key immediately after wrapping. Generating a new recovery code replaces the single `recovery` wrap atomically (`replaceRecoveryWrap` deletes-then-inserts in one action; on failure the old code still works). Removing the last remaining passkey while no passphrase exists is refused in the UI ("add a passphrase first") and the action.

## 11. Rollout

1. Owner runs `0024`. 2. Code is pushed. 3. Every member sees setup on their next visit to the builder or history; their device migrates their rows (batched 10 at a time). 4. The Platform page gains a per-forum "updates protected: n of m members" figure (counts of members with wraps vs active members) so the operator can see the residual. Members who never return keep readable rows; there is no server-side way to encrypt them.

## 12. Verification

- **Unit tests** (`scripts/crypto-test.mjs`, Node WebCrypto): encrypt/decrypt round trip; AAD binding (row A's ciphertext fails on row B); wrong passphrase fails; recovery code round trip incl. formatting; envelope version check.
- **Isolation suite additions:** `member_key_wraps` in the self-only policy list; `updates_plain_xor_enc` and `cards_plain_xor_enc` constraints hold; a migrated row has `content is null`; `forum_qol_history()` returns scores from the columns; `setup_member_keys` refuses a second setup and a wrap set without a recovery wrap; `reset_member_encrypted_data` removes exactly the caller's rows; a service-role read of a migrated update shows only the envelope; grep guard for server imports of `@/lib/crypto`.
- **Browser run (test project, passphrase path):** setup → existing updates migrate → lock → unlock → edit/autosave → finalize with a published topic → history → print → Save as PDF downloads a file → Start fresh. Passkey path verified manually on an iPhone (iOS 18+) and a laptop by the owner, since WebAuthn can't be automated in the built-in browser.
- Adversarial review before shipping.

## 13. Non-goals

Encrypting forum-shared content; passkey sign-in (future, enabled by stored public keys); native apps; Argon2 (PBKDF2 at 600k rounds now; swappable per wrap via `kdf_iterations`/a future `kdf` field).

## 14. Owner steps

Run `0024` → say so → push → set up on your own phone (passkey) and laptop → tell members to expect the one-time setup screen and to save their recovery code.

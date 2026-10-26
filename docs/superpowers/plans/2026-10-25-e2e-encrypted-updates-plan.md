# End-to-end encrypted member updates — implementation plan

Spec: `docs/superpowers/specs/2026-10-25-e2e-encrypted-updates-design.md`. Ordering rule as always: the owner runs the migration BEFORE the code is pushed (the new code writes `content_enc` and reads the new QoL columns).

## Phase A — foundations (no UI yet)

- [ ] `0024_e2e_updates.sql`: `member_key_wraps` (+ self-only policy, partial unique indexes), `updates` columns/constraint/default drop + QoL backfill, `ai_pattern_cards` columns/constraint + delete existing cards, `forum_qol_history()` on columns, `setup_member_keys`, `reset_member_encrypted_data`, `platform_forum_stats()` + `protected_count`. Idempotent, re-runnable.
- [ ] `src/lib/crypto/` (`client-only`): `encoding.ts` (base64url, utf8), `keys.ts` (generate UK, derive wrapping keys: PRF→HKDF, PBKDF2, recovery→HKDF; AES-KW wrap/unwrap), `content.ts` (AES-GCM envelope with AAD), `recovery.ts` (code gen/format/parse), `passkey.ts` (WebAuthn create+get with PRF), `cache.ts` (IndexedDB non-extractable key + 30-day lock).
- [ ] `scripts/crypto-test.mjs` (Node WebCrypto): round trip, AAD binding, wrong passphrase, recovery round trip, envelope version. `npm run test:crypto`.
- [ ] Server: `src/lib/updates/actions.ts` new signatures (envelope + QoL validation; publishTopic/commitment plaintext); `migrateUpdates`; `src/lib/security/actions.ts` (setup/add/remove/replace wraps, reset); `savePatternCards`; remove `emailUpdateToSelf`; AI: history supplied by client (brain-dump, interview), `/api/patterns` route, `patterns.ts` server generation removed.
- [ ] `platform_forum_stats` consumer: `protected_count` on the Platform page.

## Phase B — device side

- [ ] `src/components/app/security/`: `UnlockProvider`/`UnlockGate`, `SetupFlow` (passkey → passphrase fallback → recovery code → migrate rows), `UnlockDialog`, `SecuritySettings` (Me → Security), `RecoveryCodeCard`.
- [ ] Update builder: decrypt initial content; encrypt on autosave/finalize; QoL extraction; send publishTopic/commitment only when opted in; brain-dump/interview send decrypted history.
- [ ] Past updates list/detail, print view (server shell + client body), **Print** + **Save as PDF** (`@react-pdf/renderer`, lazy) on update page and history detail.
- [ ] Dashboard pattern cards: device-driven generation + decrypt; remove server generation.
- [ ] Me → Security page + nav entry; AI disclosure line on brain-dump / interview.
- [ ] Email-my-update button removed.

## Phase C — verification and ship

- [ ] Isolation suite: `member_key_wraps` in §12.8; constraints; migrated row has no plaintext; QoL history from columns; `setup_member_keys` rules; reset scope; service-role sees only envelopes; server-import grep guard.
- [ ] Browser run on the test project (passphrase path end to end incl. PDF download); passkey path by the owner on iPhone + laptop after deploy.
- [ ] Adversarial review workflow; fix; commit; owner runs 0024; push.

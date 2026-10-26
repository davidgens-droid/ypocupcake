# End-to-end encrypted member updates — implementation plan

Spec: `docs/superpowers/specs/2026-10-25-e2e-encrypted-updates-design.md`. Ordering rule as always: the owner runs the migration BEFORE the code is pushed (the new code writes `content_enc` and reads the new QoL columns).

## Phase A — foundations — done

- [x] `0024_e2e_updates.sql`: `member_key_wraps` (+ self-only policy, partial unique indexes), `updates` columns/constraint/default drop + QoL backfill, `ai_pattern_cards` columns/constraint + delete existing cards, `forum_qol_history()` on columns, `setup_member_keys`, `replace_member_key_wrap`, `reset_member_encrypted_data`, `platform_forum_stats()` + `protected_count`. Idempotent, re-runnable (0022 amended to drop-before-create so it stays re-runnable after 0024).
- [x] `src/lib/crypto/` (`client-only`): `encoding`, `keys` (UK, PRF→HKDF, PBKDF2 600k, recovery→HKDF, AES-KW), `content` (AES-GCM envelope + AAD), `recovery` (Crockford base32), `passkey` (WebAuthn create→get with PRF), `cache` (IndexedDB non-extractable key, 30 days), `session` (tab store). The envelope FORMAT lives in `src/lib/updates/envelope.ts` so the server can validate shape without importing crypto.
- [x] `scripts/crypto-test.mjs` — 9 checks, `npm run test:crypto`.
- [x] Server: `src/lib/updates/actions.ts` (envelope + QoL validation; publishTopic/commitment plaintext by choice; `getMyLegacyUpdates`, `migrateUpdates`); `src/lib/security/actions.ts` + `status.ts`; `src/lib/ai/pattern-cards-actions.ts`; `src/lib/updates/export-meta.ts`; `emailUpdateToSelf` deleted; brain-dump / interview take `history` from the device; `/api/patterns` route + `patterns.ts` as a pure generator.
- [x] Platform page shows `n of m protected`.

## Phase B — device side — done

- [x] `src/components/app/security/`: `UnlockGate`, `UnlockPanel`, `SetupFlow` (passkey → passphrase fallback → recovery code → encrypt legacy rows), `SecuritySettings` (devices, passphrase, recovery code, lock, start fresh; fresh unlock for changes), `RecoveryCodeCard`, `unlock-core`.
- [x] Builder (`update-builder-gate` + `update-builder`): decrypt current + 3 recent, encrypt on autosave / finalize / clear, publish-by-choice, AI history passed through BrainDumpDialog and InterviewMode.
- [x] Past updates list (QoL from columns, no decrypt) and detail (`past-update-body`), print view (`print-update-client`), **Print** + **Save as PDF** (`@react-pdf/renderer`, lazy; `save-pdf.ts`) on the review step, the detail page and the print page.
- [x] Dashboard: protection nudge; `PatternCardsClient` (device-driven generation + decrypt).
- [x] Me sub-nav (This update · Past updates · Security) + `/me/security`; sign-out clears cached keys.

## Phase C — verification and ship

- [x] Isolation suite §12.16 + `member_key_wraps` in §12.8 + `protected_count` in §12.11.
- [x] Browser run on the test project (passphrase path): setup → legacy update encrypted (service role sees only the envelope) → builder autosave/finalize → history detail decrypts → print view → Save as PDF builds a 6 KB PDF on the device → lock → wrong passphrase refused → passphrase unlock → recovery-code unlock (sloppy input accepted) → Start fresh.
- [x] Adversarial review (find → two refuters per finding) and fixes: `key_id` per setup (cached-key validation, server refuses stale keys on every save); legacy sweep after every unlock, idempotent, no early exit, residual count + "Protect now" on Me → Security; sign-out forgets the in-memory key; Start fresh blanks content and keeps QoL rows / withdraws Ready; Security page re-reads wraps after setup; print view no longer squeezed by the gate wrapper; `already_set_up` during setup voids the shown recovery code and routes to unlock.
- [ ] Owner runs 0024; push; passkey path by the owner on iPhone + laptop after deploy.

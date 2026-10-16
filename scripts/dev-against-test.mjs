#!/usr/bin/env node
// Runs `next dev` against the TEST Supabase project (.env.test.local) on
// port 3001, so onboarding flows can be clicked through without touching
// production. Env vars set here win over .env.local (Next never overrides an
// existing variable). AI keys are left out on purpose: nothing here should
// spend them.
//
//   node scripts/dev-against-test.mjs
import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const envFile = path.join(ROOT, ".env.test.local")
if (!fs.existsSync(envFile)) {
  console.error("Missing .env.test.local — see scripts/isolation-test.mjs")
  process.exit(2)
}
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")] })
)
const prodEnv = fs.existsSync(path.join(ROOT, ".env.local")) ? fs.readFileSync(path.join(ROOT, ".env.local"), "utf8") : ""
if (!env.TEST_SUPABASE_URL || prodEnv.includes(new URL(env.TEST_SUPABASE_URL).host)) {
  console.error("TEST_SUPABASE_URL missing or matches production — refusing.")
  process.exit(2)
}

// Startup self-check: can a Node process launched from here reach the test
// project over TLS? The desktop app's preview runner sits behind a proxy
// whose certificate Node's bundled CA list doesn't know; Node 24 can trust
// the Windows store instead (--use-system-ca), so try that and pass it on.
import { spawnSync } from "node:child_process"
const probe = (opts) => spawnSync(process.execPath, [...opts, "-e",
  `fetch(${JSON.stringify(env.TEST_SUPABASE_URL + "/rest/v1/")},{headers:{apikey:${JSON.stringify(env.TEST_SUPABASE_ANON_KEY)}},signal:AbortSignal.timeout(10000)}).then(r=>{console.log("ok "+r.status)},e=>{console.log("fail "+(e?.cause?.code??e?.code??e?.message))})`,
], { encoding: "utf8" }).stdout.trim()
let nodeOptions = process.env.NODE_OPTIONS ?? ""
const plain = probe([])
if (plain.startsWith("ok")) {
  console.log(`[dev-against-test] TLS to test project: ${plain}`)
} else {
  const sys = probe(["--use-system-ca"])
  console.log(`[dev-against-test] TLS plain: ${plain}; with --use-system-ca: ${sys}`)
  if (sys.startsWith("ok")) nodeOptions = `${nodeOptions} --use-system-ca`.trim()
  else console.log("[dev-against-test] env of interest:", Object.keys(process.env).filter((k) => /PROXY|CERT|CA_|SSL|TLS|SANDBOX|NODE_OPTIONS/i.test(k)).map((k) => `${k}=${(process.env[k] ?? "").slice(0, 60)}`).join(" | ") || "(none)")
}

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "dev", "-p", "3001"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: env.TEST_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.TEST_SUPABASE_ANON_KEY,
    NODE_OPTIONS: nodeOptions,
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    RESEND_API_KEY: "",
  },
})
child.on("exit", (code) => process.exit(code ?? 0))

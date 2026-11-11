import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

// Cheap, deterministic guards for the follow-ups merged on 2026-11-09. The
// behavioural coverage lives in tests/owner-proof-hardening.test.mjs,
// tests/panel-recovery.test.mjs, tests/chat-panel-recovery.test.mjs and
// tests/voice.test.mjs; these checks fail fast when a file is dropped or a
// contract is quietly reverted.

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const rootFile = (path) => new URL(`../${path}`, import.meta.url);
const read = (path) => readFile(rootFile(path), "utf8");

test("every Supabase migration version is unique", async () => {
  const versions = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, 14));
  assert.equal(new Set(versions).size, versions.length, `duplicate migration version: ${versions.sort().join(", ")}`);
});

test("the owner-proof hardening migration stays conditional and client-revoking", async () => {
  const sql = await read("supabase/migrations/20261030125000_harden_owner_proof_rpc.sql");
  // Conditional: a fresh project never had the out-of-band function, so an
  // unconditional revoke would abort the migration run.
  assert.match(sql, /if to_regprocedure\('public\.tflash_verify_owner_proof\(text,text\)'\) is not null then/);
  assert.match(sql, /revoke all on function public\.tflash_verify_owner_proof\(text, text\)\s+from public, anon, authenticated;/);
  // The function must not be dropped; revocation is the reversible change.
  assert.doesNotMatch(sql, /drop\s+function/i);
  // No index may be dropped by a hardening migration.
  assert.doesNotMatch(sql, /drop\s+index/i);
});

test("README lists every committed migration exactly once, in version order", async () => {
  const readme = await read("README.md");
  const references = [...readme.matchAll(/`(supabase\/migrations\/[^`]+\.sql)`/g)].map((match) => match[1]);
  const migrations = (await readdir(migrationsUrl))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => `supabase/migrations/${name}`)
    .sort();
  assert.deepEqual(references, migrations);
});

test("workspace panels mount through the panel boundary, not a bare lazy/Suspense", async () => {
  const shell = await read("components/chat/agent-chat.tsx");
  assert.match(shell, /import \{ LazyPanel \} from "@\/components\/app\/lazy-panel";/);
  assert.match(shell, /load=\{loadCoderWorkspace\}/);
  assert.match(shell, /load=\{loadResearchWorkspace\}/);
  assert.match(shell, /failure=\{\(retry\) => <WorkspaceUnavailable label="Coder"/);
  // A rejected import is cached for the module's lifetime, so a bare lazy()
  // here would make the in-place retry a no-op.
  assert.doesNotMatch(shell, /lazy\(async \(\) =>/);
  assert.doesNotMatch(shell, /\bSuspense\b/);
  // The merged split-pane controls must survive the panel wrapper.
  assert.match(shell, /onToggleExpand=\{\(\) => setWorkspaceExpanded/);
  assert.match(shell, /expanded=\{workspaceExpanded\}/);
});

test("address-bar writes go through the guarded helper only", async () => {
  const shell = await read("components/chat/agent-chat.tsx");
  assert.match(shell, /function replaceRoute\(url: string\) \{/);
  assert.match(shell, /try \{\s+History\.prototype\.replaceState\.call/);
  const calls = [...shell.matchAll(/History\.prototype\.replaceState/g)];
  assert.equal(calls.length, 1, "the raw History write may only appear inside replaceRoute");
  assert.match(shell, /replaceRoute\(`\/s\/\$\{encodeURIComponent\(nextSessionId\)\}`\)/);
  assert.match(shell, /replaceRoute\(`\/\?mode=\$\{nextMode\}`\)/);
});

test("the route error screen retries once, logs the full error and offers a reload", async () => {
  const screen = await read("app/error.tsx");
  assert.match(screen, /autoRetried = useRef\(false\)/);
  assert.match(screen, /if \(autoRetried\.current\) return;/);
  assert.match(screen, /error\.name, error\.message, error\.stack/);
  assert.match(screen, /window\.location\.reload\(\)/);
});

test("dictation starts on the microphone tap and keeps the language choice", async () => {
  const voice = await read("components/chat/voice-input.tsx");
  // Opening the panel is what starts capture: `changeOpen(true)` calls start().
  const openBranch = voice.slice(voice.indexOf("function changeOpen(next: boolean)"), voice.indexOf("const working ="));
  assert.match(openBranch, /setOpen\(true\);[\s\S]*start\(nextLanguage\);/);
  // The language picker must remain reachable and restart capture when changed.
  assert.match(voice, /<VoiceLanguageSelect value=\{language\} onChange=\{changeLanguage\}/);
  assert.match(voice, /function changeLanguage\(next: Language\)[\s\S]*if \(active\.current\) start\(next\);/);
  // Still never sends a turn: dictation only edits the draft.
  assert.doesNotMatch(voice, /onSubmit|handleSubmit\(/);
});

test("the advisors document records the applied revoke instead of claiming it is pending", async () => {
  const doc = await read("docs/database-advisors-2026-10-30.md");
  // The revoke is applied on the live project; the doc must say so, and must not
  // still present the change as an unapplied to-do.
  assert.match(doc, /## Applied 2026-11-09/);
  assert.doesNotMatch(doc, /## Applying to production \(not done\)/);
  assert.match(doc, /authenticated_can_execute: false/);
  assert.match(doc, /postgres=X\/postgres/);
  // The remaining owner actions must stay visible.
  assert.match(doc, /password_hibp_enabled/);
});

test("the changelog marks the owner-proof change as applied, not repository-only", async () => {
  const changelog = await read("CHANGELOG.md");
  assert.match(changelog, /### Security \(applied to the hosted project\)/);
  assert.doesNotMatch(changelog, /### Security \(repository only, not applied\)/);
});

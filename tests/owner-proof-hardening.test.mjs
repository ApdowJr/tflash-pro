import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const hardeningMigration = "20261030120000_harden_owner_proof_rpc.sql";
const userA = "11111111-1111-4111-8111-111111111111";
const proof = "p".repeat(43);

async function bootstrap(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant usage on schema public to anon, authenticated;
  `);
}

async function asRole(db, role, userId, query, values = []) {
  await db.exec("RESET ROLE");
  if (userId) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  }
  await db.exec(`SET ROLE ${role}`);
  try {
    return await db.query(query, values);
  } finally {
    await db.exec("RESET ROLE");
  }
}

async function sourceFiles(rootUrl) {
  const entries = await readdir(rootUrl, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, rootUrl);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(child));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

test("owner-proof RPC hardening revokes client execution and keeps owner verification", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);

    const migrations = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrations) {
      await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    }

    // A fresh project never had the out-of-band RPC, so the hardening migration
    // must be a no-op rather than a failed migration.
    const absent = await db.query("select to_regprocedure($1) as fn", [
      "public.tflash_verify_owner_proof(text,text)",
    ]);
    assert.equal(absent.rows[0].fn, null);

    await db.query("insert into auth.users(id) values ($1)", [userA]);
    await asRole(
      db,
      "authenticated",
      userA,
      "insert into public.tflash_chats(session_id,user_id,owner_proof,title) values ($1,$2,$3,$4)",
      ["session-a", userA, proof, "A"],
    );

    // Simulate the production drift: same signature, SECURITY DEFINER, granted
    // to authenticated. This is the state the advisor reported.
    await db.exec(`
      create function public.tflash_verify_owner_proof(p_session_id text, p_proof text)
      returns boolean
      language sql
      stable
      security definer
      set search_path = pg_catalog, public
      as $$
        select exists (
          select 1
          from public.tflash_chats c
          where c.session_id = p_session_id
            and c.owner_proof = p_proof
        )
      $$;
      grant execute on function public.tflash_verify_owner_proof(text, text) to authenticated;
    `);

    const before = await asRole(
      db,
      "authenticated",
      userA,
      "select public.tflash_verify_owner_proof($1,$2) as ok",
      ["session-a", proof],
    );
    assert.equal(before.rows[0].ok, true);

    await db.exec(await readFile(new URL(hardeningMigration, migrationDirectory), "utf8"));

    const acl = await db.query(`
      select
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can,
        has_function_privilege('anon', p.oid, 'execute') as anon_can,
        has_function_privilege('postgres', p.oid, 'execute') as owner_can
      from pg_proc p
      where p.oid = to_regprocedure('public.tflash_verify_owner_proof(text,text)')
    `);
    assert.deepEqual(acl.rows[0], {
      authenticated_can: false,
      anon_can: false,
      owner_can: true,
    });

    // Revoking the RPC must not disturb normal RLS-protected reads.
    const readable = await asRole(
      db,
      "authenticated",
      userA,
      "select session_id from public.tflash_chats where session_id = $1",
      ["session-a"],
    );
    assert.deepEqual(readable.rows, [{ session_id: "session-a" }]);

    // The legitimate server-side HMAC check still works, and the database owner
    // can still inspect the row through the retained function.
    const owner = await db.query(
      "select public.tflash_verify_owner_proof($1,$2) as ok",
      ["session-a", proof],
    );
    assert.equal(owner.rows[0].ok, true);

    await assert.rejects(
      () => asRole(
        db,
        "authenticated",
        userA,
        "select public.tflash_verify_owner_proof($1,$2)",
        ["session-a", proof],
      ),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      () => asRole(
        db,
        "anon",
        null,
        "select public.tflash_verify_owner_proof($1,$2)",
        ["session-a", proof],
      ),
      (error) => error.code === "42501",
    );
  } finally {
    await db.close();
  }
});

test("runtime owner checks use the signed HMAC proof, not the database RPC", async () => {
  const files = [];
  for (const root of ["app", "agent", "components", "lib"]) {
    files.push(...await sourceFiles(new URL(`../${root}/`, import.meta.url)));
  }

  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("tflash_verify_owner_proof")) offenders.push(file.pathname);
  }
  assert.deepEqual(offenders, []);

  const ownedChat = await readFile(new URL("../lib/security/owned-chat.ts", import.meta.url), "utf8");
  const eveChannel = await readFile(new URL("../agent/channels/eve.ts", import.meta.url), "utf8");
  assert.match(ownedChat, /verifyChatOwnership/);
  assert.match(eveChannel, /verifyChatOwnership/);
});

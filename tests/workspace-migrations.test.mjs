import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const emptyWorkspace = {
  version: 1,
  memoryEnabled: false,
  projects: [],
  notes: [],
  maxSteps: 12,
};

async function asAuthenticatedUser(db, userId, query, values = []) {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("SET ROLE authenticated");
  try {
    return await db.query(query, values);
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("Supabase migrations apply in order with explicit grants, CAS-compatible RLS, and size constraints", async () => {
  const migrationNames = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(migrationNames.includes("20261028075927_create_tflash_chats.sql"));
  assert.ok(migrationNames.includes("20261029120000_create_tflash_workspace_sync.sql"));

  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant usage on schema public to anon, authenticated;
    `);

    for (const name of migrationNames) {
      if (name === "20261030130000_permission_grant_revisions.sql") {
        await db.exec(`insert into public.tflash_permission_grants (owner_kind,owner_id,session_id,origin,expires_at) values ('supabase','existing','session','https://existing.example','2030-01-01T00:00:00Z')`);
      }
      await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    }
    const backfill = await db.query(`select revision::text, expires_at::text from public.tflash_permission_grants where owner_id='existing'`);
    assert.match(backfill.rows[0].revision, /^[0-9a-f-]{36}$/);
    assert.match(backfill.rows[0].expires_at, /^2030-01-01/);

    const internal = await db.query(`select has_table_privilege('anon','public.tflash_permission_grants','select') as anon_grants, has_table_privilege('authenticated','public.tflash_permission_grants','select') as auth_grants, has_table_privilege('authenticated','public.tflash_tracked_tasks','select') as auth_tasks, has_table_privilege('service_role','public.tflash_permission_grants','select') as service_grants, has_table_privilege('service_role','public.tflash_tracked_tasks','update') as service_tasks`);
    assert.deepEqual(internal.rows[0], {anon_grants:false,auth_grants:false,auth_tasks:false,service_grants:true,service_tasks:true});
    const protectedTables = await db.query(`select relname,relrowsecurity from pg_class where relname in ('tflash_permission_grants','tflash_tracked_tasks') order by relname`);
    assert.deepEqual(protectedTables.rows,[{relname:'tflash_permission_grants',relrowsecurity:true},{relname:'tflash_tracked_tasks',relrowsecurity:true}]);

    const grant = await db.query(`insert into public.tflash_permission_grants (owner_kind,owner_id,session_id,origin,expires_at) values ('supabase','owner','session','https://example.com',now() + interval '1 hour') returning revision`);
    const grantRevision = grant.rows[0].revision;
    const revokedRevision = "44444444-4444-4444-8444-444444444444";
    const grantUpdate = `update public.tflash_permission_grants set revision=$1,expires_at=$2 where owner_kind='supabase' and owner_id='owner' and session_id='session' and origin='https://example.com' and revision=$3 returning revision`;
    assert.equal((await db.query(grantUpdate, [revokedRevision, "1970-01-01T00:00:00Z", grantRevision])).rows.length, 1);
    assert.equal((await db.query(grantUpdate, ["55555555-5555-4555-8555-555555555555", "2030-01-01T00:00:00Z", grantRevision])).rows.length, 0);
    await assert.rejects(() => db.query(`insert into public.tflash_permission_grants (owner_kind,owner_id,session_id,origin,expires_at) values ('supabase','owner','session','https://example.com',now())`), error => error.code === "23505");

    // Exercise the exact key/revision/state predicates on a real isolated SQL
    // engine, not only the mocked PostgREST lifecycle tests.
    const taskValues = ["supabase", "owner", "session", "11111111-1111-4111-8111-111111111111", "objective", "file", "a".repeat(64)];
    await db.query(`insert into public.tflash_tracked_tasks (owner_kind, owner_id, session_id, revision, objective, path, sha256, continuation_budget, state) values ($1,$2,$3,$4,$5,$6,$7,0,'awaiting_evidence')`, taskValues);
    await assert.rejects(() => db.query(`insert into public.tflash_tracked_tasks (owner_kind, owner_id, session_id, revision, objective, path, sha256, continuation_budget, state) values ($1,$2,$3,$4,$5,$6,$7,0,'awaiting_evidence')`, taskValues), error => error.code === "23505");
    const revisionUpdate = `update public.tflash_tracked_tasks set revision=$1, state=$2 where owner_kind=$3 and owner_id=$4 and session_id=$5 and revision=$6 and state in ('awaiting_evidence','criterion_matched') returning revision`;
    const replacementRevision = "22222222-2222-4222-8222-222222222222";
    assert.equal((await db.query(revisionUpdate, [replacementRevision, "criterion_matched", ...taskValues.slice(0,4)])).rows.length, 1);
    assert.equal((await db.query(revisionUpdate, ["33333333-3333-4333-8333-333333333333", "cancelled", ...taskValues.slice(0,4)])).rows.length, 0);

    const columns = await db.query(`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tflash_workspaces'
      order by ordinal_position
    `);
    assert.deepEqual(columns.rows, [
      { column_name: "user_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "workspace", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ]);

    const privileges = await db.query(`
      select
        has_table_privilege('authenticated', 'public.tflash_workspaces', 'select') as auth_select,
        has_table_privilege('authenticated', 'public.tflash_workspaces', 'insert') as auth_insert,
        has_table_privilege('authenticated', 'public.tflash_workspaces', 'update') as auth_update,
        has_table_privilege('authenticated', 'public.tflash_workspaces', 'delete') as auth_delete,
        has_table_privilege('anon', 'public.tflash_workspaces', 'select') as anon_select,
        has_table_privilege('anon', 'public.tflash_workspaces', 'insert') as anon_insert,
        has_table_privilege('anon', 'public.tflash_workspaces', 'update') as anon_update,
        has_table_privilege('anon', 'public.tflash_workspaces', 'delete') as anon_delete
    `);
    assert.deepEqual(privileges.rows[0], {
      auth_select: true,
      auth_insert: true,
      auth_update: true,
      auth_delete: true,
      anon_select: false,
      anon_insert: false,
      anon_update: false,
      anon_delete: false,
    });

    const rls = await db.query(`
      select relname, relrowsecurity
      from pg_class
      where relname in ('tflash_chats', 'tflash_workspaces')
      order by relname
    `);
    assert.deepEqual(rls.rows, [
      { relname: "tflash_chats", relrowsecurity: true },
      { relname: "tflash_workspaces", relrowsecurity: true },
    ]);

    await db.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);
    await asAuthenticatedUser(
      db,
      userA,
      "insert into public.tflash_workspaces (user_id, workspace) values ($1, $2::jsonb)",
      [userA, JSON.stringify(emptyWorkspace)],
    );

    const hiddenFromOtherUser = await asAuthenticatedUser(
      db,
      userB,
      "select user_id from public.tflash_workspaces",
    );
    assert.equal(hiddenFromOtherUser.rows.length, 0);

    const revisionResult = await asAuthenticatedUser(
      db,
      userA,
      "select updated_at::text as updated_at from public.tflash_workspaces where user_id = $1",
      [userA],
    );
    const expectedUpdatedAt = revisionResult.rows[0].updated_at;
    const nextUpdatedAt = new Date(Date.parse(expectedUpdatedAt) + 1).toISOString();
    const updatedWorkspace = { ...emptyWorkspace, maxSteps: 17 };
    const update = `
      update public.tflash_workspaces
      set workspace = $1::jsonb, updated_at = $2::timestamptz
      where user_id = $3::uuid and updated_at = $4::timestamptz
      returning updated_at
    `;
    const accepted = await asAuthenticatedUser(
      db,
      userA,
      update,
      [JSON.stringify(updatedWorkspace), nextUpdatedAt, userA, expectedUpdatedAt],
    );
    assert.equal(accepted.rows.length, 1);

    const stale = await asAuthenticatedUser(
      db,
      userA,
      update,
      [JSON.stringify(emptyWorkspace), new Date(Date.parse(nextUpdatedAt) + 1).toISOString(), userA, expectedUpdatedAt],
    );
    assert.equal(stale.rows.length, 0);

    await assert.rejects(
      () => asAuthenticatedUser(
        db,
        userA,
        "update public.tflash_workspaces set user_id = $1 where user_id = $2",
        [userB, userA],
      ),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      () => asAuthenticatedUser(
        db,
        userB,
        "insert into public.tflash_workspaces (user_id, workspace) values ($1, $2::jsonb)",
        [userA, JSON.stringify(emptyWorkspace)],
      ),
      (error) => error.code === "42501",
    );
    await assert.rejects(
      () => asAuthenticatedUser(
        db,
        userB,
        "insert into public.tflash_workspaces (user_id, workspace) values ($1, '[]'::jsonb)",
        [userB],
      ),
      (error) => error.code === "23514",
    );

    const oversizedWorkspace = JSON.stringify({ note: "x".repeat(250_001) });
    await assert.rejects(
      () => asAuthenticatedUser(
        db,
        userB,
        "insert into public.tflash_workspaces (user_id, workspace) values ($1, $2::jsonb)",
        [userB, oversizedWorkspace],
      ),
      (error) => error.code === "23514",
    );

    const token = (length) => randomBytes(Math.ceil(length * 3 / 4)).toString("base64url").slice(0, length);
    const nearLimitWorkspace = {
      version: 1,
      memoryEnabled: false,
      projects: Array.from({ length: 20 }, (_, index) => ({
        id: `p${index}`,
        name: token(80),
        instructions: token(4000),
        chatIds: Array.from({ length: 100 }, () => token(39)),
      })),
      notes: Array.from({ length: 30 }, (_, index) => ({
        id: `n${index}`,
        text: token(1000),
        enabled: true,
        projectId: null,
      })),
      maxSteps: 30,
    };
    const nearLimitBody = JSON.stringify(nearLimitWorkspace);
    assert.ok(nearLimitBody.length < 200_000);
    const jsonbSize = await db.query("select pg_column_size($1::jsonb) as bytes", [nearLimitBody]);
    assert.ok(
      Number(jsonbSize.rows[0].bytes) > 200_000,
      `Expected JSONB overhead to exceed the old 200 KB ceiling for a ${nearLimitBody.length}-character body.`,
    );
    assert.ok(
      Number(jsonbSize.rows[0].bytes) <= 250_000,
      `A ${nearLimitBody.length}-character workspace uses ${jsonbSize.rows[0].bytes} JSONB bytes.`,
    );
    const acceptedNearLimit = await asAuthenticatedUser(
      db,
      userB,
      "insert into public.tflash_workspaces (user_id, workspace) values ($1, $2::jsonb) returning pg_column_size(workspace) as bytes",
      [userB, nearLimitBody],
    );
    assert.equal(acceptedNearLimit.rows.length, 1);
    assert.equal(Number(acceptedNearLimit.rows[0].bytes), Number(jsonbSize.rows[0].bytes));

    await assert.rejects(
      () => db.exec("set role anon; select user_id from public.tflash_workspaces; reset role"),
      (error) => error.code === "42501",
    );

    const stored = await db.query("select user_id::text, workspace from public.tflash_workspaces where user_id = $1", [userA]);
    assert.deepEqual(stored.rows, [{ user_id: userA, workspace: updatedWorkspace }]);
  } finally {
    await db.close();
  }
});


test("the chat migration enforces owner-only reads, writes and deletes with real RLS", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      grant usage on schema public to anon, authenticated;
    `);
    await db.exec(await readFile(new URL("20261028075927_create_tflash_chats.sql", migrationDirectory), "utf8"));
    await db.query("insert into auth.users(id) values ($1), ($2)", [userA, userB]);
    const proof = "p".repeat(43);
    await asAuthenticatedUser(db, userA,
      "insert into public.tflash_chats(session_id,user_id,owner_proof,title) values ($1,$2,$3,$4)", ["session-a", userA, proof, "A"]);
    await assert.rejects(
      () => asAuthenticatedUser(db, userA, "insert into public.tflash_chats(session_id,user_id,owner_proof) values ($1,$2,$3)", ["forged", userB, proof]),
      (error) => error.code === "42501",
    );
    assert.deepEqual((await asAuthenticatedUser(db, userB, "select session_id from public.tflash_chats")).rows, []);
    assert.deepEqual((await asAuthenticatedUser(db, userB, "update public.tflash_chats set title = 'stolen' where session_id = 'session-a' returning session_id")).rows, []);
    assert.deepEqual((await asAuthenticatedUser(db, userB, "delete from public.tflash_chats where session_id = 'session-a' returning session_id")).rows, []);
    await asAuthenticatedUser(db, userB,
      "insert into public.tflash_chats(session_id,user_id,owner_proof,title) values ($1,$2,$3,$4)", ["session-b", userB, proof, "B"]);
    assert.deepEqual((await asAuthenticatedUser(db, userB, "select session_id from public.tflash_chats")).rows, [{ session_id: "session-b" }]);
    assert.deepEqual((await asAuthenticatedUser(db, userA, "select session_id,title from public.tflash_chats")).rows, [{ session_id: "session-a", title: "A" }]);
    assert.deepEqual((await asAuthenticatedUser(db, userA, "delete from public.tflash_chats where session_id = 'session-a' returning session_id")).rows, [{ session_id: "session-a" }]);
    await assert.rejects(
      () => db.exec("set role anon; select session_id from public.tflash_chats; reset role"),
      (error) => error.code === "42501",
    );
  } finally { await db.close(); }
});

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
      await db.exec(await readFile(new URL(name, migrationDirectory), "utf8"));
    }

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

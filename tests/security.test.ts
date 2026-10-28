// Row Level Security and data-ownership checks against a real PostgreSQL database.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql, withUser } from "@/lib/db";
import { createUser, resetDb } from "./helpers";

let alice: string;
let bob: string;
let aliceSubject: string;

beforeAll(async () => {
  await resetDb();
  alice = await createUser("Alice");
  bob = await createUser("Bob");
  const [s] = await withUser(alice, (tx) => tx`insert into subjects (user_id, display_name) values (${alice}, 'Alice private subject') returning id`);
  aliceSubject = s.id;
  await withUser(alice, (tx) => tx`insert into materials (user_id, subject_id, title, kind, origin) values (${alice}, ${aliceSubject}, 'Secret notes', 'text', 'note')`);
});
afterAll(async () => {
  await resetDb();
  await sql.end();
});

describe("row level security", () => {
  it("a user only sees their own rows", async () => {
    const mine = await withUser(alice, (tx) => tx`select id from subjects`);
    const theirs = await withUser(bob, (tx) => tx`select id from subjects`);
    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
    expect(await withUser(bob, (tx) => tx`select * from materials`)).toHaveLength(0);
  });
  it("a user cannot read another user's row even by id", async () => {
    const rows = await withUser(bob, (tx) => tx`select * from subjects where id = ${aliceSubject}`);
    expect(rows).toHaveLength(0);
  });
  it("a user cannot update or delete another user's rows", async () => {
    const upd = await withUser(bob, (tx) => tx`update subjects set display_name = 'hacked' where id = ${aliceSubject} returning id`);
    expect(upd).toHaveLength(0);
    const del = await withUser(bob, (tx) => tx`delete from subjects where id = ${aliceSubject} returning id`);
    expect(del).toHaveLength(0);
    const [s] = await withUser(alice, (tx) => tx`select display_name from subjects where id = ${aliceSubject}`);
    expect(s.display_name).toBe("Alice private subject");
  });
  it("a user cannot insert rows owned by someone else", async () => {
    await expect(
      withUser(bob, (tx) => tx`insert into subjects (user_id, display_name) values (${alice}, 'planted')`),
    ).rejects.toThrow(/row-level security/);
  });
  it("the app role cannot read sessions, login attempts, OAuth tokens, or OAuth states at all", async () => {
    for (const table of ["sessions", "login_attempts", "oauth_tokens", "oauth_states"]) {
      await expect(withUser(alice, (tx) => tx`select * from ${tx(table)}`)).rejects.toThrow(/permission denied/);
    }
  });
  it("without a user id set, the app role sees nothing", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role yaxha_app`;
      return tx`select * from subjects`;
    });
    expect(rows).toHaveLength(0);
  });
  it("users table exposes only your own account to the app role", async () => {
    const rows = await withUser(bob, (tx) => tx`select id from users`);
    expect(rows.map((r) => r.id)).toEqual([bob]);
  });
});

describe("subject identity", () => {
  it("prevents duplicate imported courses per user via the source id", async () => {
    await withUser(alice, (tx) => tx`insert into subjects (user_id, display_name, source_provider, source_course_id, source_course_name) values (${alice}, 'A', 'google_classroom', 'c-1', 'A')`);
    await expect(
      withUser(alice, (tx) => tx`insert into subjects (user_id, display_name, source_provider, source_course_id, source_course_name) values (${alice}, 'B', 'google_classroom', 'c-1', 'B')`),
    ).rejects.toThrow(/duplicate key/);
    // The same course id for a different user is fine.
    await withUser(bob, (tx) => tx`insert into subjects (user_id, display_name, source_provider, source_course_id, source_course_name) values (${bob}, 'A', 'google_classroom', 'c-1', 'A')`);
  });
  it("deleting an account removes all of its data (cascade)", async () => {
    const carol = await createUser("Carol");
    await withUser(carol, (tx) => tx`insert into subjects (user_id, display_name) values (${carol}, 'temp')`);
    await sql`delete from users where id = ${carol}`;
    const [{ n }] = await sql`select count(*)::int as n from subjects where user_id = ${carol}`;
    expect(n).toBe(0);
  });
});

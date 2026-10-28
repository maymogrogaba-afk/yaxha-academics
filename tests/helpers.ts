import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

export async function createUser(name = "Test") {
  const [u] = await sql`insert into users (email, password_hash) values (${`${randomUUID()}@test.local`}, 'scrypt$1$x$y') returning id`;
  await sql`insert into user_preferences (user_id) values (${u.id})`;
  await sql`insert into profiles (user_id, full_name) values (${u.id}, ${name})`;
  return u.id as string;
}

export async function resetDb() {
  await sql`truncate users cascade`;
}

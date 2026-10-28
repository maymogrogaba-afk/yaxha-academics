// Google Classroom sync against a fake Google API. These tests prove the import
// logic (stable ids, no duplicates, renames, removals, permissions); they do NOT
// prove that a real Google account was connected.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql, withUser } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { syncClassroom } from "@/lib/google/sync";
import { CLASSROOM_SCOPES, DRIVE_SCOPE, disconnectGoogle, getAccessToken, getIntegration } from "@/lib/google/oauth";
import { createUser, resetDb } from "./helpers";

const pdf = fs.readFileSync(path.join(__dirname, "fixtures", "engg-econ-lesson.pdf"));

type World = {
  courses: { id: string; name: string; courseState?: string; section?: string }[];
  materials: Record<string, unknown[]>;
  work: Record<string, unknown[]>;
  drive: Record<string, { meta?: { name: string; mimeType: string; modifiedTime?: string }; status?: number; body?: Uint8Array }>;
};

function fakeGoogle(world: World) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const p = url.pathname;
    if (p === "/v1/courses") return json({ courses: world.courses });
    let m = p.match(/^\/v1\/courses\/([^/]+)\/(topics|courseWork|courseWorkMaterials|announcements|teachers)$/);
    if (m) {
      const [, cid, what] = m;
      if (what === "topics") return json({ topic: [{ topicId: "t1", name: "Interest" }] });
      if (what === "courseWork") return json({ courseWork: world.work[cid] ?? [] });
      if (what === "courseWorkMaterials") return json({ courseWorkMaterial: world.materials[cid] ?? [] });
      if (what === "announcements") return json({ announcements: [] });
      if (what === "teachers") return json({ teachers: [{ profile: { name: { fullName: "Engr. Santos" } } }] });
    }
    if (/studentSubmissions/.test(p)) return json({ studentSubmissions: [] });
    m = p.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/);
    if (m) {
      const f = world.drive[m[1]];
      if (!f || f.status) return json({ error: { message: "The user does not have sufficient permissions for this file.", status: "PERMISSION_DENIED" } }, f?.status ?? 404);
      if (url.searchParams.get("alt") === "media" || m[2]) return new Response(f.body as BodyInit, { status: 200 });
      return json({ id: m[1], ...f.meta });
    }
    return json({ error: { message: `unexpected ${p}` } }, 500);
  }) as typeof fetch;
  return { impl, calls };
}

async function connect(userId: string, scopes = [...CLASSROOM_SCOPES, DRIVE_SCOPE]) {
  const [i] = await withUser(userId, (tx) => tx`insert into integrations (user_id, provider, status, granted_scopes) values (${userId}, 'google_classroom', 'connected', ${scopes}) returning id`);
  return i.id as string;
}

const material = (id: string, title: string, fileId: string, fileTitle: string) => ({
  id, title, topicId: "t1", updateTime: "2026-10-01T00:00:00Z",
  materials: [{ driveFile: { driveFile: { id: fileId, title: fileTitle, alternateLink: `https://drive.google.com/file/d/${fileId}` } } }],
});

function baseWorld(): World {
  return {
    courses: [
      { id: "c1", name: "ENGG 404 Engineering Economics", section: "CE 3106" },
      { id: "c2", name: "MATH 404 Differential Equations", section: "CE 3106" },
    ],
    materials: {
      c1: [material("m1", "Module 2: Compound interest", "f-pdf", "Lesson.pdf"), material("m2", "Notes doc", "f-doc", "Notes")],
      c2: [{ id: "m3", title: "Reading: separable equations", materials: [{ link: { url: "https://example.edu/ode", title: "Separable ODEs" } }] }],
    },
    work: { c1: [{ id: "w1", title: "Problem Set 2", dueDate: { year: 2026, month: 11, day: 5 }, maxPoints: 100, materials: [] }] },
    drive: {
      "f-pdf": { meta: { name: "Lesson.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-01T00:00:00Z" }, body: new Uint8Array(pdf) },
      "f-doc": { meta: { name: "Notes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-01T00:00:00Z" }, body: new Uint8Array(pdf) },
    },
  };
}

beforeEach(resetDb);
afterAll(() => sql.end());

describe("Classroom sync (fake Google API)", () => {
  it("imports courses as subjects, materials, assignments, and Drive files", async () => {
    const u = await createUser();
    await connect(u);
    const g = fakeGoogle(baseWorld());
    const s = await syncClassroom(u, { fetchImpl: g.impl, token: "fake" });
    expect(s.status).toBe("succeeded");
    expect(s.coursesFound).toBe(2);
    expect(s.subjectsCreated).toBe(2);
    expect(s.filesDownloaded).toBe(2);
    const rows = await withUser(u, async (tx) => ({
      subjects: await tx`select display_name, source_course_name, source_teacher, source_section from subjects order by display_name`,
      materials: await tx`select title, kind, access_status, processing_status, mime_type from materials order by title`,
      assignments: await tx`select title, due_at from assignments`,
      contents: await tx`select page_count from material_contents`,
      integ: await tx`select status, last_sync_status from integrations`,
    }));
    expect(rows.subjects.map((r) => r.display_name)).toEqual(["ENGG 404 Engineering Economics", "MATH 404 Differential Equations"]);
    expect(rows.subjects[0].source_teacher).toBe("Engr. Santos");
    expect(rows.assignments[0].title).toBe("Problem Set 2");
    const lesson = rows.materials.find((m) => m.title === "Lesson.pdf")!;
    expect(lesson).toMatchObject({ kind: "pdf", access_status: "ok", processing_status: "ready" });
    // Google Doc exported to PDF, while keeping its Google Doc identity
    expect(rows.materials.find((m) => m.title === "Notes")).toMatchObject({ kind: "google_doc", access_status: "ok" });
    expect(g.calls.some((c) => c.includes("/f-doc/export?mimeType=application%2Fpdf"))).toBe(true);
    expect(rows.materials.find((m) => m.title === "Separable ODEs")).toMatchObject({ kind: "link" });
    expect(rows.contents.length).toBe(2);
    expect(rows.integ[0]).toMatchObject({ status: "synced", last_sync_status: "succeeded" });
  });

  it("re-syncing creates no duplicates, keeps custom names, and skips unchanged files", async () => {
    const u = await createUser();
    await connect(u);
    const world = baseWorld();
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    await withUser(u, (tx) => tx`update subjects set display_name = 'Eco', name_customized = true where source_course_id = 'c1'`);
    world.courses[0].name = "ENGG 404 Engineering Economy (renamed)";
    const g2 = fakeGoogle(world);
    const s2 = await syncClassroom(u, { fetchImpl: g2.impl, token: "fake" });
    expect(s2.subjectsCreated).toBe(0);
    expect(s2.itemsImported).toBe(0);
    expect(s2.filesDownloaded).toBe(0); // modifiedTime unchanged
    expect(g2.calls.some((c) => c.includes("alt=media"))).toBe(false);
    const subj = await withUser(u, (tx) => tx`select display_name, source_course_name from subjects where source_course_id = 'c1'`);
    expect(subj).toHaveLength(1);
    expect(subj[0]).toMatchObject({ display_name: "Eco", source_course_name: "ENGG 404 Engineering Economy (renamed)" });
    const [{ n }] = await withUser(u, (tx) => tx`select count(*)::int as n from materials`);
    expect(n).toBe(3);
  });

  it("re-downloads an edited Drive file and records a version", async () => {
    const u = await createUser();
    await connect(u);
    const world = baseWorld();
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    world.drive["f-pdf"].meta!.modifiedTime = "2026-10-20T00:00:00Z";
    world.drive["f-pdf"].body = new TextEncoder().encode("%PDF-1.4 broken edited file");
    const s = await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    // The edited file is corrupt: the failure is reported, not hidden.
    expect(s.filesDownloaded + s.issues.length).toBeGreaterThan(0);
    const [m] = await withUser(u, (tx) => tx`select source_revision from materials where drive_file_id = 'f-pdf'`);
    expect(m.source_revision).toBeTruthy();
  });

  it("marks removed courses unavailable and keeps their content", async () => {
    const u = await createUser();
    await connect(u);
    const world = baseWorld();
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    world.courses = world.courses.filter((c) => c.id !== "c2");
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    const rows = await withUser(u, (tx) => tx`select source_course_id, source_status from subjects order by source_course_id`);
    expect(rows.map((r) => r.source_status)).toEqual(["active", "unavailable"]);
    const [{ n }] = await withUser(u, (tx) => tx`select count(*)::int as n from materials m join subjects s on s.id = m.subject_id where s.source_course_id = 'c2'`);
    expect(n).toBe(1);
  });

  it("flags removed posts instead of deleting them", async () => {
    const u = await createUser();
    await connect(u);
    const world = baseWorld();
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    world.materials.c1 = world.materials.c1.slice(0, 1);
    await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    const rows = await withUser(u, (tx) => tx`select title, source_removed from materials where drive_file_id is not null order by title`);
    expect(rows).toEqual([
      { title: "Lesson.pdf", source_removed: false },
      { title: "Notes", source_removed: true },
    ]);
  });

  it("records permission errors on restricted Drive files without failing the sync", async () => {
    const u = await createUser();
    await connect(u);
    const world = baseWorld();
    world.drive["f-doc"] = { status: 403 };
    const s = await syncClassroom(u, { fetchImpl: fakeGoogle(world).impl, token: "fake" });
    expect(s.status).toBe("partial");
    expect(s.filesDownloaded).toBe(1);
    const [m] = await withUser(u, (tx) => tx`select access_status, processing_error from materials where drive_file_id = 'f-doc'`);
    expect(m.access_status).toBe("permission_required");
    expect(m.processing_error).toMatch(/permission/i);
  });

  it("does not read Drive files when Drive access was not granted", async () => {
    const u = await createUser();
    await connect(u, CLASSROOM_SCOPES);
    const g = fakeGoogle(baseWorld());
    const s = await syncClassroom(u, { fetchImpl: g.impl, token: "fake" });
    expect(g.calls.some((c) => c.startsWith("/drive/"))).toBe(false);
    expect(s.issues.some((i) => /Drive access was not granted/.test(i.message))).toBe(true);
    expect((await getIntegration(u)).status).toBe("permission_required");
  });

  it("an expired Google authorization marks the integration as needing re-authorization", async () => {
    const u = await createUser();
    await connect(u);
    const g = (async () => new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), { status: 401 })) as typeof fetch;
    const s = await syncClassroom(u, { fetchImpl: g, token: "fake" });
    expect(s.status).toBe("failed");
    expect((await getIntegration(u)).status).toBe("authorization_required");
  });
});

describe("OAuth token handling (fake Google token endpoint)", () => {
  async function storeToken(u: string, expiresInMs: number, refresh = "refresh-1") {
    const id = await connect(u);
    await sql`insert into oauth_tokens (integration_id, user_id, access_token_enc, refresh_token_enc, expires_at)
              values (${id}, ${u}, ${encrypt("access-1")}, ${refresh ? encrypt(refresh) : null}, ${new Date(Date.now() + expiresInMs)})`;
  }

  it("uses a valid token, refreshes an expired one, and stores tokens encrypted", async () => {
    const u = await createUser();
    await storeToken(u, 3_600_000);
    expect(await getAccessToken(u, (() => { throw new Error("should not call"); }) as unknown as typeof fetch)).toBe("access-1");
    await sql`update oauth_tokens set expires_at = now() - interval '1 minute'`;
    const refresh = (async () => new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600 }))) as typeof fetch;
    expect(await getAccessToken(u, refresh)).toBe("access-2");
    const [t] = await sql`select access_token_enc from oauth_tokens`;
    expect(String(t.access_token_enc)).not.toContain("access-2");
  });

  it("a revoked refresh token asks the user to reconnect", async () => {
    const u = await createUser();
    await storeToken(u, -60_000);
    const revoked = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as typeof fetch;
    await expect(getAccessToken(u, revoked)).rejects.toThrow(/revoked or expired/);
    expect((await getIntegration(u)).status).toBe("authorization_required");
  });

  it("disconnecting revokes and deletes tokens but keeps subjects and study content", async () => {
    const u = await createUser();
    await storeToken(u, 3_600_000);
    await syncClassroom(u, { fetchImpl: fakeGoogle(baseWorld()).impl, token: "fake" });
    const revokes: string[] = [];
    await disconnectGoogle(u, true, (async (url: string) => { revokes.push(String(url)); return new Response("{}"); }) as typeof fetch);
    expect(revokes[0]).toContain("oauth2.googleapis.com/revoke");
    expect(await sql`select 1 from oauth_tokens`).toHaveLength(0);
    const counts = await withUser(u, async (tx) => ({
      subjects: (await tx`select count(*)::int as n from subjects`)[0].n,
      materials: (await tx`select count(*)::int as n from materials`)[0].n,
    }));
    expect(counts).toEqual({ subjects: 2, materials: 0 });
    expect((await getIntegration(u)).status).toBe("not_connected");
  });
});

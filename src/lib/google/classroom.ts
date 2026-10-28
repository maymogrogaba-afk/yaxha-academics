import "server-only";
// Thin client for the Google Classroom and Drive REST APIs, with paging and retries.

export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
  }
}

const CLASSROOM = "https://classroom.googleapis.com/v1";
const DRIVE = "https://www.googleapis.com/drive/v3";

export type GFetch = typeof fetch;

export class GoogleClient {
  calls = 0;
  constructor(private token: string, private fetchImpl: GFetch = fetch) {}

  async request(url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
    this.calls++;
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    // Retry rate limits and temporary server errors with exponential backoff.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
      return this.request(url, init, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.status ?? body?.error?.errors?.[0]?.reason;
      throw new GoogleApiError(body?.error?.message ?? `Google API error ${res.status}`, res.status, reason);
    }
    return res;
  }

  async json<T>(url: string): Promise<T> {
    return (await this.request(url)).json() as Promise<T>;
  }

  /** Follows nextPageToken until all pages are read. */
  async listAll<T>(url: string, key: string, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    let token: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const u = new URL(url);
      u.searchParams.set("pageSize", u.searchParams.get("pageSize") ?? "100");
      if (token) u.searchParams.set("pageToken", token);
      const data = await this.json<Record<string, unknown>>(u.toString());
      out.push(...((data[key] as T[]) ?? []));
      token = data.nextPageToken as string | undefined;
      if (!token) break;
    }
    return out;
  }

  courses() {
    return this.listAll<GCourse>(`${CLASSROOM}/courses?courseStates=ACTIVE&courseStates=ARCHIVED`, "courses");
  }
  topics(courseId: string) {
    return this.listAll<GTopic>(`${CLASSROOM}/courses/${courseId}/topics`, "topic");
  }
  courseWork(courseId: string) {
    return this.listAll<GCourseWork>(`${CLASSROOM}/courses/${courseId}/courseWork`, "courseWork");
  }
  courseWorkMaterials(courseId: string) {
    return this.listAll<GCourseWorkMaterial>(`${CLASSROOM}/courses/${courseId}/courseWorkMaterials`, "courseWorkMaterial");
  }
  announcements(courseId: string) {
    return this.listAll<GAnnouncement>(`${CLASSROOM}/courses/${courseId}/announcements`, "announcements");
  }
  mySubmissions(courseId: string) {
    return this.listAll<GSubmission>(`${CLASSROOM}/courses/${courseId}/courseWork/-/studentSubmissions?userId=me`, "studentSubmissions");
  }
  teachers(courseId: string) {
    return this.listAll<{ profile?: { name?: { fullName?: string } } }>(`${CLASSROOM}/courses/${courseId}/teachers`, "teachers");
  }

  driveMeta(fileId: string) {
    return this.json<GDriveFile>(`${DRIVE}/files/${fileId}?fields=id,name,mimeType,modifiedTime,size,md5Checksum,webViewLink&supportsAllDrives=true`);
  }
  async driveDownload(fileId: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.request(`${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`);
    return readLimited(res, maxBytes);
  }
  async driveExport(fileId: string, mime: string, maxBytes: number): Promise<Uint8Array> {
    const res = await this.request(`${DRIVE}/files/${fileId}/export?mimeType=${encodeURIComponent(mime)}`);
    return readLimited(res, maxBytes);
  }
}

async function readLimited(res: Response, maxBytes: number) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new GoogleApiError(`File is larger than the ${Math.round(maxBytes / 1048576)} MB limit`, 413);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new GoogleApiError(`File is larger than the ${Math.round(maxBytes / 1048576)} MB limit`, 413);
  return buf;
}

// ---- Types for the parts of the API responses this app uses ----
export type GCourse = {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  description?: string;
  room?: string;
  courseState?: string;
  alternateLink?: string;
  updateTime?: string;
};
export type GTopic = { topicId: string; name: string; updateTime?: string };
export type GMaterial = {
  driveFile?: { driveFile: { id: string; title?: string; alternateLink?: string; thumbnailUrl?: string }; shareMode?: string };
  youtubeVideo?: { id: string; title?: string; alternateLink?: string };
  link?: { url: string; title?: string };
  form?: { formUrl: string; title?: string };
};
type GPost = {
  id: string;
  topicId?: string;
  state?: string;
  alternateLink?: string;
  creationTime?: string;
  updateTime?: string;
  materials?: GMaterial[];
};
export type GCourseWork = GPost & {
  title: string;
  description?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
  maxPoints?: number;
  workType?: string;
};
export type GCourseWorkMaterial = GPost & { title: string; description?: string };
export type GAnnouncement = GPost & { text?: string };
export type GSubmission = { courseWorkId: string; state?: string; late?: boolean };
export type GDriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; md5Checksum?: string; webViewLink?: string };

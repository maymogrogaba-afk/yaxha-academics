import "server-only";
// Google sign-in for Classroom access (OAuth 2.0 authorization code flow with PKCE).
// Yaxha never sees your Google password: Google shows its own consent screen.
import crypto from "node:crypto";
import { sql, withUser } from "../db";
import { env, googleConfigured } from "../env";
import { decrypt, encrypt, randomToken, sha256 } from "../crypto";

export const CLASSROOM_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.topics.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
];
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export const SCOPE_EXPLANATIONS: { scope: string; why: string }[] = [
  { scope: "classroom.courses.readonly", why: "See the list of your classes, to create your subjects." },
  { scope: "classroom.topics.readonly", why: "Keep each material under the topic your teacher used." },
  { scope: "classroom.coursework.me.readonly", why: "See assignments, due dates, and your own submission status." },
  { scope: "classroom.courseworkmaterials.readonly", why: "See the learning materials your teachers posted." },
  { scope: "classroom.announcements.readonly", why: "See announcements and the files attached to them." },
  { scope: "classroom.rosters.readonly", why: "Show the teacher's name on each subject." },
  { scope: "drive.readonly (optional)", why: "Open and read the attached Drive files (PDFs, Docs, Slides) so summaries and quizzes use their real content. Read-only." },
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export function redirectUri() {
  return `${env.appUrl}/api/google/callback`;
}

export class GoogleAuthError extends Error {
  constructor(message: string, readonly reauthorize = false) {
    super(message);
  }
}

async function ensureIntegration(userId: string) {
  const [row] = await withUser(userId, (tx) => tx`
    insert into integrations (user_id, provider) values (${userId}, 'google_classroom')
    on conflict (user_id, provider) do update set provider = excluded.provider
    returning id, status`);
  return row as { id: string; status: string };
}

export async function getIntegration(userId: string) {
  const [row] = await withUser(userId, (tx) => tx`select * from integrations where provider = 'google_classroom'`);
  return row ?? null;
}

export async function buildAuthUrl(userId: string, includeDrive: boolean) {
  if (!googleConfigured()) throw new GoogleAuthError("Google sign-in is not configured on this server yet.");
  await ensureIntegration(userId);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  await sql`delete from oauth_states where created_at < now() - interval '15 minutes'`;
  await sql`insert into oauth_states (state_hash, user_id, code_verifier_enc) values (${sha256(state)}, ${userId}, ${encrypt(verifier)})`;
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: [...CLASSROOM_SCOPES, ...(includeDrive ? [DRIVE_SCOPE] : [])].join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

export async function handleCallback(userId: string, code: string, state: string, fetchImpl: typeof fetch = fetch) {
  const [st] = await sql`delete from oauth_states where state_hash = ${sha256(state)} returning user_id, code_verifier_enc, created_at`;
  if (!st || st.user_id !== userId || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) {
    throw new GoogleAuthError("This sign-in link expired or was already used. Please try connecting again.");
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: decrypt(st.code_verifier_enc),
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) throw new GoogleAuthError(`Google did not complete the sign-in (${tok.error_description ?? tok.error ?? res.status}).`);

  let email: string | null = null;
  const info = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (info.ok) email = (await info.json()).email ?? null;

  const scopes = String(tok.scope ?? "").split(" ").filter(Boolean);
  const integration = await ensureIntegration(userId);
  const missing = CLASSROOM_SCOPES.filter((s) => s.startsWith("https://") && !scopes.includes(s) && !s.endsWith("rosters.readonly"));
  await sql`
    insert into oauth_tokens (integration_id, user_id, access_token_enc, refresh_token_enc, expires_at)
    values (${integration.id}, ${userId}, ${encrypt(tok.access_token)}, ${tok.refresh_token ? encrypt(tok.refresh_token) : null}, ${new Date(Date.now() + (tok.expires_in ?? 3600) * 1000)})
    on conflict (integration_id) do update set access_token_enc = excluded.access_token_enc,
      refresh_token_enc = coalesce(excluded.refresh_token_enc, oauth_tokens.refresh_token_enc),
      expires_at = excluded.expires_at, updated_at = now()`;
  await withUser(userId, (tx) => tx`
    update integrations set status = ${missing.length ? "permission_required" : "connected"}, account_email = ${email},
      granted_scopes = ${scopes}, last_error = ${missing.length ? `Some Classroom permissions were not granted: ${missing.map((s) => s.split("/").pop()).join(", ")}` : null}
    where id = ${integration.id}`);
  return { missing };
}

/** A valid access token, refreshed when needed. Marks the integration when re-authorization is required. */
export async function getAccessToken(userId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const integration = await getIntegration(userId);
  if (!integration) throw new GoogleAuthError("Google Classroom is not connected.", true);
  const [t] = await sql`select * from oauth_tokens where integration_id = ${integration.id}`;
  if (!t?.access_token_enc) throw new GoogleAuthError("Google Classroom is not connected.", true);
  if (t.expires_at && new Date(t.expires_at).getTime() - Date.now() > 60_000) return decrypt(t.access_token_enc);
  if (!t.refresh_token_enc) {
    await markReauth(userId, "Your Google sign-in expired. Please reconnect.");
    throw new GoogleAuthError("Your Google sign-in expired. Please reconnect.", true);
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.google.clientId,
      client_secret: env.google.clientSecret,
      refresh_token: decrypt(t.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    const revoked = tok.error === "invalid_grant";
    const msg = revoked
      ? "Google access was revoked or expired. Please reconnect Google Classroom."
      : `Could not refresh Google access (${tok.error ?? res.status}).`;
    if (revoked) await markReauth(userId, msg);
    throw new GoogleAuthError(msg, revoked);
  }
  await sql`update oauth_tokens set access_token_enc = ${encrypt(tok.access_token)},
            expires_at = ${new Date(Date.now() + (tok.expires_in ?? 3600) * 1000)}, updated_at = now()
            where integration_id = ${integration.id}`;
  return tok.access_token;
}

async function markReauth(userId: string, message: string) {
  await withUser(userId, (tx) => tx`update integrations set status = 'authorization_required', last_error = ${message} where provider = 'google_classroom'`);
}

/**
 * Disconnects Google. Your subjects, summaries, quizzes, flashcards, notes, and
 * exam plans are always kept. With `removeImported`, imported Classroom files are
 * removed from the library (your own uploads and study packs stay).
 */
export async function disconnectGoogle(userId: string, removeImported: boolean, fetchImpl: typeof fetch = fetch) {
  const integration = await getIntegration(userId);
  if (!integration) return;
  const [t] = await sql`select refresh_token_enc, access_token_enc from oauth_tokens where integration_id = ${integration.id}`;
  const token = t?.refresh_token_enc ?? t?.access_token_enc;
  if (token) {
    try {
      await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(decrypt(token))}`, { method: "POST" });
    } catch {
      // Revocation is best-effort; tokens are deleted locally either way.
    }
  }
  await sql`delete from oauth_tokens where integration_id = ${integration.id}`;
  await withUser(userId, async (tx) => {
    await tx`update integrations set status = 'not_connected', granted_scopes = '{}', last_error = null where id = ${integration.id}`;
    if (removeImported) {
      await tx`delete from materials where origin = 'imported'`;
    }
  });
}

export function hasDriveScope(scopes: string[] | null | undefined) {
  return (scopes ?? []).includes(DRIVE_SCOPE);
}

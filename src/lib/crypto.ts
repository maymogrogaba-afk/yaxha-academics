import "server-only";
import crypto from "node:crypto";
import { env } from "./env";

export function sha256(input: string | Buffer) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

// ---- Passwords (scrypt, a slow hash designed for passwords) ----
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (e, k) => (e ? rej(e) : res(k))),
  );
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await new Promise<Buffer>((res, rej) =>
    crypto.scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p }, (e, k) =>
      e ? rej(e) : res(k),
    ),
  );
  return crypto.timingSafeEqual(key, expected);
}

// ---- Encryption for OAuth tokens (AES-256-GCM) ----
function encryptionKey() {
  if (!/^[0-9a-f]{64}$/i.test(env.tokenEncryptionKey)) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters (run: openssl rand -hex 32)");
  }
  return Buffer.from(env.tokenEncryptionKey, "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown encryption format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

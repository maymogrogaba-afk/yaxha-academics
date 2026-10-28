import "server-only";

// All configuration comes from environment variables (see .env.example).
// Values here are read on the server only and never sent to the browser.
export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  ai: {
    provider: (process.env.AI_PROVIDER ?? "anthropic") as "anthropic" | "openai",
    apiKey: process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
    baseUrl: process.env.AI_BASE_URL ?? "",
    maxRequestsPerHour: Number(process.env.AI_MAX_REQUESTS_PER_HOUR ?? 30),
    maxSourceChars: Number(process.env.AI_MAX_SOURCE_CHARS ?? 60000),
  },
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 15),
  allowSignup: (process.env.ALLOW_SIGNUP ?? "true") !== "false",
};

export const isProduction = process.env.NODE_ENV === "production";

export function googleConfigured() {
  return Boolean(env.google.clientId && env.google.clientSecret && env.tokenEncryptionKey);
}

export function aiConfigured() {
  return Boolean(env.ai.apiKey);
}

// The Anthropic request shape, checked against a local stand-in server (no real API call).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let server: http.Server;
let lastBody: Record<string, unknown> = {};
let reply: Record<string, unknown> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      lastBody = JSON.parse(raw);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  vi.stubEnv("AI_API_KEY", "test-key");
  vi.stubEnv("AI_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
afterAll(() => {
  vi.unstubAllEnvs();
  server.close();
});

const message = (stop_reason: string, text = "Hello") => ({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason, stop_sequence: null,
  content: [{ type: "text", text }], usage: { input_tokens: 12, output_tokens: 3 },
});

describe("Anthropic provider", () => {
  it("sends the default model without sampling parameters and reads the reply", async () => {
    vi.resetModules();
    const { getProvider } = await import("@/lib/ai/provider");
    reply = message("end_turn");
    const res = await getProvider()({ system: "sys", maxTokens: 100, temperature: 0.4, messages: [{ role: "user", content: "Hi" }] });
    expect(lastBody.model).toBe("claude-opus-5-5");
    expect(lastBody).not.toHaveProperty("temperature");
    expect(lastBody.system).toBe("sys");
    expect(res).toMatchObject({ text: "Hello", inputTokens: 12, outputTokens: 3 });
  });

  it("reports a refusal instead of returning empty text", async () => {
    vi.resetModules();
    const { getProvider } = await import("@/lib/ai/provider");
    reply = message("refusal", "");
    await expect(getProvider()({ system: "s", maxTokens: 10, messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/declined/);
  });
});

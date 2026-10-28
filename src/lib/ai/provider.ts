import "server-only";
// The only place that talks to an AI company's API. To add another provider,
// add one function with the same shape as callAnthropic and pick it in getProvider().
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";

export type AiImage = { mime: string; base64: string };
export type AiMessage = { role: "user" | "assistant"; content: string; image?: AiImage };
export type AiRequest = { system: string; messages: AiMessage[]; maxTokens: number; temperature?: number };
export type AiResponse = { text: string; inputTokens: number; outputTokens: number; model: string; stopReason?: string };

export class AiError extends Error {
  constructor(message: string, readonly code: "not_configured" | "rate_limited" | "provider" | "timeout" | "bad_output") {
    super(message);
  }
}

const TIMEOUT_MS = 120_000;

export const DEFAULT_MODELS = { anthropic: "claude-opus-5-5", openai: "" };

export function currentModel() {
  return env.ai.model || DEFAULT_MODELS[env.ai.provider] || "";
}

// Models that accept server-side refusal fallbacks ("default" routing) on the Claude API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5", "claude-fable-5-1"]);

let anthropicClient: Anthropic | null = null;
function anthropic() {
  anthropicClient ??= new Anthropic({ apiKey: env.ai.apiKey, baseURL: env.ai.baseUrl || undefined, timeout: TIMEOUT_MS, maxRetries: 2 });
  return anthropicClient;
}

async function callAnthropic(req: AiRequest): Promise<AiResponse> {
  const model = currentModel();
  // Sampling parameters (temperature) are not sent: current Claude models reject them.
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.image
        ? [
            { type: "image", source: { type: "base64", media_type: m.image.mime as "image/png", data: m.image.base64 } },
            { type: "text", text: m.content || "Please look at this image." },
          ]
        : m.content,
    })),
  };
  // If a safety check declines a request, the API retries it on a suitable fallback model.
  if (!env.ai.baseUrl && FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  let data: Anthropic.Beta.BetaMessage;
  try {
    data = await anthropic().beta.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw providerError(e.status ?? 0, e.message);
    throw e;
  }
  if (data.stop_reason === "refusal") {
    throw new AiError("The AI declined this request. Try rephrasing it, or use a different source.", "bad_output");
  }
  const text = data.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  return { text, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, model: data.model, stopReason: data.stop_reason ?? undefined };
}

async function callOpenAiCompatible(req: AiRequest): Promise<AiResponse> {
  const model = currentModel();
  if (!model) throw new AiError("Set AI_MODEL when AI_PROVIDER=openai.", "not_configured");
  const res = await fetch((env.ai.baseUrl || "https://api.openai.com/v1") + "/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "content-type": "application/json", authorization: `Bearer ${env.ai.apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.3,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.image
            ? [
                { type: "image_url", image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } },
                { type: "text", text: m.content || "Please look at this image." },
              ]
            : m.content,
        })),
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw providerError(res.status, data?.error?.message);
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model,
    stopReason: data.choices?.[0]?.finish_reason,
  };
}

function providerError(status: number, message?: string) {
  if (status === 401 || status === 403) return new AiError("The AI provider rejected the API key. Check AI_API_KEY.", "not_configured");
  if (status === 429) return new AiError("The AI provider is rate limiting requests. Wait a minute and try again.", "rate_limited");
  return new AiError(`The AI provider returned an error (${status})${message ? ": " + message.slice(0, 200) : ""}.`, "provider");
}

export type Provider = (req: AiRequest) => Promise<AiResponse>;

// Tests can swap in a fake provider. Real requests never use it.
let override: Provider | null = null;
export function setProviderForTests(p: Provider | null) {
  override = p;
}

export function getProvider(): Provider {
  if (override) return override;
  if (!env.ai.apiKey) throw new AiError("AI is not configured yet. Add AI_API_KEY to the server environment (see README).", "not_configured");
  return env.ai.provider === "openai" ? callOpenAiCompatible : callAnthropic;
}

export function aiAvailable() {
  return Boolean(override || env.ai.apiKey);
}

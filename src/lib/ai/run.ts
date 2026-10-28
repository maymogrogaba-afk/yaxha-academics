import "server-only";
import { withUser } from "../db";
import { env } from "../env";
import { AiError, getProvider, type AiRequest, type AiResponse } from "./provider";

/**
 * Every AI request goes through here: rate limit check, timeout, usage logging.
 * Failures are logged too, and never leave half-written study records behind
 * (callers only write to the database after this returns successfully).
 */
export async function runAi(userId: string, feature: string, req: AiRequest): Promise<AiResponse> {
  const provider = getProvider();
  const [{ count }] = await withUser(userId, (tx) =>
    tx`select count(*)::int as count from ai_usage where user_id = ${userId} and created_at > now() - interval '1 hour'`,
  );
  if (count >= env.ai.maxRequestsPerHour) {
    throw new AiError(`You've reached the limit of ${env.ai.maxRequestsPerHour} AI requests per hour. This protects your API budget; try again later.`, "rate_limited");
  }
  try {
    const res = await provider(req);
    await withUser(userId, (tx) =>
      tx`insert into ai_usage (user_id, feature, model, input_tokens, output_tokens, ok) values (${userId}, ${feature}, ${res.model}, ${res.inputTokens}, ${res.outputTokens}, true)`,
    );
    return res;
  } catch (e) {
    await withUser(userId, (tx) => tx`insert into ai_usage (user_id, feature, ok) values (${userId}, ${feature}, false)`).catch(() => {});
    if (e instanceof AiError) throw e;
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new AiError("The AI took too long to respond. Try again, or use a smaller source.", "timeout");
    throw new AiError(`Could not reach the AI provider: ${(e as Error).message.slice(0, 160)}`, "provider");
  }
}

/** Finds and parses the JSON object in a model reply (models sometimes wrap it in ``` fences). */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new AiError("The AI reply was not in the expected format. Please try again.", "bad_output");
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    throw new AiError("The AI reply could not be read (invalid JSON). Please try again.", "bad_output");
  }
}

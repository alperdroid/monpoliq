// ─────────────────────────────────────────────────────────────────────────────
// Claude API helper for the forecasting / analysis functions (predictions, pivot probability,
// multi-horizon, market pricing). Not used for scoring communications: that is the frozen scorer.
// Needs the secret ANTHROPIC_API_KEY.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from "npm:@anthropic-ai/sdk@0";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** Thrown when Claude cannot be used right now (no key, rate limit, billing); the caller reports it, not a 500. */
export class ClaudeUnavailable extends Error {
  constructor(message: string, readonly rateLimited = false) { super(message); }
}

export interface ClaudeToolCall {
  system: string;
  user: string;
  /** The function Claude must answer through; its input is the structured result. */
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  /** Let Claude search the web (server-side) before answering, up to this many searches. */
  webSearches?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

export interface ClaudeResult<T> {
  input: T;
  /** URLs of the web results Claude read, when web search was enabled. */
  sources: { url: string; title: string }[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new ClaudeUnavailable("Claude API key (ANTHROPIC_API_KEY) is not configured");
  return client ??= new Anthropic({ apiKey });
}

/**
 * One structured answer from Claude: Claude answers by calling `tool`, whose input is returned.
 * Forced tool choice is not available on this model, so the prompt asks for the call and the loop
 * re-asks once if Claude answers in prose; pause_turn (long web searches) is resumed.
 */
export async function claudeToolCall<T>(req: ClaudeToolCall): Promise<ClaudeResult<T>> {
  const anthropic = getClient();
  const tools: any[] = [req.tool];
  if (req.webSearches) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: req.webSearches });

  const messages: any[] = [{
    role: "user",
    content: `${req.user}\n\nGive your answer by calling the ${req.tool.name} tool; do not answer in prose.`,
  }];
  const sources: { url: string; title: string }[] = [];

  for (let turn = 0; turn < 6; turn++) {
    let response: any;
    try {
      response = await anthropic.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        tools,
        tool_choice: { type: "auto" },
        output_config: { effort: req.effort ?? "medium" },
        messages,
        // on a safety decline, re-run on Anthropic's recommended fallback model
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as any);
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ClaudeUnavailable("AI service is busy, try again in a minute", true);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new ClaudeUnavailable("Claude API key was rejected");
      }
      if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(e.message)) {
        throw new ClaudeUnavailable("Claude API credits are used up");
      }
      if (e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
        throw new ClaudeUnavailable("AI service is unavailable, try again shortly", true);
      }
      throw e;
    }

    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) if (r.type === "web_search_result") sources.push({ url: r.url, title: r.title });
      }
    }
    const call = response.content.find((b: any) => b.type === "tool_use" && b.name === req.tool.name);
    if (call) return { input: call.input as T, sources };

    if (response.stop_reason === "refusal") throw new Error("Claude declined the request");
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;   // server-side search still running
    if (response.stop_reason === "max_tokens") throw new Error("Claude ran out of output tokens");
    messages.push({ role: "user", content: `Now call the ${req.tool.name} tool with your answer.` });
  }
  throw new Error(`Claude did not call ${req.tool.name}`);
}

/** Response body for a ClaudeUnavailable, in the shape the frontend already handles ({ unavailable: true }). */
export function unavailableBody(e: ClaudeUnavailable): string {
  return JSON.stringify({ error: e.message, unavailable: true, ...(e.rateLimited ? { rate_limited: true } : {}) });
}

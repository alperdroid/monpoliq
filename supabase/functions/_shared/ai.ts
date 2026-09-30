// ─────────────────────────────────────────────────────────────────────────────
// Gemini helper for the forecasting / analysis functions (predictions, pivot probability,
// multi-horizon, market pricing). Not used for scoring communications: that is the frozen scorer.
//
// Provider, in order:
//   1. Google's Gemini API directly, when the secret GEMINI_API_KEY is set (Google AI Studio key;
//      free tier). Model: secret GEMINI_MODEL, default gemini-3-flash-preview. Supports Google Search
//      grounding, so market pricing can be read from published sources.
//   2. Lovable's AI gateway (LOVABLE_API_KEY), which runs on Lovable credits. No search grounding.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const FALLBACK_GEMINI_MODEL = "gemini-2.5-flash";
const LOVABLE_MODEL = "google/gemini-2.5-flash";

/** Thrown when no AI provider can be used right now (no key, rate limit, credits); the caller reports it, not a 500. */
export class AIUnavailable extends Error {
  constructor(message: string, readonly rateLimited = false) { super(message); }
}

export interface AIToolCall {
  system: string;
  user: string;
  /** The structured answer: name/description for the prompt, input_schema (JSON Schema) for the JSON returned. */
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  /** Let the model search the web (Google Search grounding) before answering. Direct Gemini API only. */
  webSearch?: boolean;
}

export interface AIResult<T> {
  input: T;
  /** Pages the model read through Google Search grounding (empty when not grounded). */
  sources: { url: string; title: string }[];
  /** Whether the answer was grounded on a live web search. */
  grounded: boolean;
  provider: "gemini-api" | "lovable";
}

export async function aiToolCall<T>(req: AIToolCall): Promise<AIResult<T>> {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) return await geminiDirect<T>(req, geminiKey);
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) return await lovableGateway<T>(req, lovableKey);
  throw new AIUnavailable("No AI key configured (set GEMINI_API_KEY)");
}

function statusError(status: number, provider: string): Error {
  if (status === 429) return new AIUnavailable("AI service is busy (rate limit), try again in a minute", true);
  if (status === 402) return new AIUnavailable(`${provider} credits are used up`);
  if (status === 401 || status === 403) return new AIUnavailable(`${provider} key was rejected`);
  if (status >= 500) return new AIUnavailable(`${provider} is unavailable, try again shortly`, true);
  return new Error(`${provider} error ${status}`);
}

/** First JSON object in a model's text answer (tolerates ```json fences and surrounding prose). */
function parseJson<T>(text: string): T {
  const t = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(t) as T; } catch { /* fall through */ }
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1)) as T;
  throw new Error("AI returned no JSON");
}

// ── 1. Gemini API (generativelanguage.googleapis.com) ──
async function geminiDirect<T>(req: AIToolCall, key: string): Promise<AIResult<T>> {
  const prompt = `${req.user}\n\nAnswer with ONLY a JSON object for "${req.tool.name}" (${req.tool.description}), matching this JSON Schema:\n${JSON.stringify(req.tool.input_schema)}`;
  const call = async (model: string, withSchema: boolean) => {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: withSchema
        ? { responseMimeType: "application/json", responseJsonSchema: req.tool.input_schema }
        : {},
    };
    if (req.webSearch) body.tools = [{ google_search: {} }];
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  let resp = await call(model, true);
  // Schema-constrained output is not accepted by every model / tool combination: ask for JSON in the text instead.
  if (resp.status === 400) { console.log("Gemini API 400 with schema:", await resp.text()); resp = await call(model, false); }
  // Model id retired or not on this key's tier: try the long-lived fallback model.
  if (resp.status === 404 && model !== FALLBACK_GEMINI_MODEL) { console.log("Gemini model not found:", model); resp = await call(FALLBACK_GEMINI_MODEL, !req.webSearch); }
  if (!resp.ok) {
    console.error("Gemini API error:", resp.status, await resp.text());
    throw statusError(resp.status, "Gemini API");
  }

  const data = await resp.json();
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini returned no answer${data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ""}`);
  const text = (cand.content?.parts || []).filter((p: any) => typeof p.text === "string" && !p.thought).map((p: any) => p.text).join("");
  if (!text) throw new Error(`Gemini returned an empty answer (${cand.finishReason || "unknown reason"})`);

  const chunks = cand.groundingMetadata?.groundingChunks || [];
  const sources = chunks.filter((c: any) => c.web?.uri).map((c: any) => ({ url: c.web.uri, title: c.web.title || c.web.uri }));
  const searched = (cand.groundingMetadata?.webSearchQueries || []).length > 0 || sources.length > 0;
  return { input: parseJson<T>(text), sources, grounded: !!req.webSearch && searched, provider: "gemini-api" };
}

// ── 2. Lovable AI gateway (OpenAI-compatible; function calling for the structured answer) ──
async function lovableGateway<T>(req: AIToolCall, key: string): Promise<AIResult<T>> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LOVABLE_MODEL,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      tools: [{ type: "function", function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.input_schema } }],
      tool_choice: { type: "function", function: { name: req.tool.name } },
    }),
  });
  if (!resp.ok) {
    console.error("Lovable AI error:", resp.status, await resp.text());
    throw statusError(resp.status, "Lovable AI");
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  const input = args ? JSON.parse(args) as T : parseJson<T>(data.choices?.[0]?.message?.content || "");
  return { input, sources: [], grounded: false, provider: "lovable" };
}

/** Response body for an AIUnavailable, in the shape the frontend already handles ({ unavailable: true }). */
export function unavailableBody(e: AIUnavailable): string {
  return JSON.stringify({ error: e.message, unavailable: true, ...(e.rateLimited ? { rate_limited: true } : {}) });
}

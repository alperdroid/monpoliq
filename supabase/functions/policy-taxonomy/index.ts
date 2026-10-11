import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { load } from "npm:cheerio@1";
import { z } from "npm:zod@3";
import { createResponsesCall } from "./helpers/responses.ts";
import { getLovableAiGatewayResponseHeaders } from "./helpers/run-id.ts";
import { isOfficialMeetingStatement, hasTaxonomyDimensions, TAXONOMY_DIMENSIONS, taxonomyCacheKey } from "../_shared/policy-taxonomy.ts";

Deno.serve(async req => {
  const json = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), {
    status, headers: getLovableAiGatewayResponseHeaders(headers, { ...corsHeaders, "Content-Type": "application/json" }),
  });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !service || !anon) return json({ error: "Taxonomy configuration is unavailable" }, 503);
    const sb = createClient(url, service);
    const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(32), resume: z.boolean().optional() }).strict().safeParse(await req.json());
    if (!parsed.success) return json({ error: "Select valid meeting statements" }, 400);
    // Read-only requests remain public; creating new classifications requires a verified session.
    const { data: items, error } = await sb.from("sentiment_items").select("id,bank,item_date,title,source,url,is_statistical,policy_dimensions").in("id", parsed.data.ids).order("item_date", { ascending: false });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    const statements = (items || []).filter(item => item.item_date < today && isOfficialMeetingStatement(item));
    const { data: cache } = await sb.from("analysis_cache").select("data_hash,result").eq("analysis_type", "policy-taxonomy-statement");
    const pending = statements.filter(item => !cache?.some(row => row.data_hash === taxonomyCacheKey(item) && hasTaxonomyDimensions(row.result?.dimensions)));
    if (!pending.length) return json({ classified: 0, processed: 0 });
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Sign in to run statement analysis" }, 401);
    const userClient = createClient(url, anon);
    const { data: claims, error: authError } = await userClient.auth.getClaims(auth.slice(7));
    if (authError || !claims?.claims?.sub || claims.claims.role !== "authenticated") return json({ error: "Sign in to run statement analysis" }, 401);
    const { data: pause } = await sb.from("analysis_cache").select("result").eq("analysis_type", "policy-taxonomy-paused").eq("bank", "ALL").order("created_at", { ascending: false }).limit(1);
    if (pause?.[0] && (!parsed.data.resume || pause[0].result.provider_denied)) return json({ ...pause[0].result, unavailable: true });
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Statement analysis is not configured" }, 401);
    // One real statement per request, newest first, to avoid resource-limit failures.
    const item = pending[0];
    const sourceResponse = await fetch(item.url, { signal: req.signal });
    if (!sourceResponse.ok) return json({ error: "The official statement is temporarily unavailable" }, 503);
    const finalURL = new URL(sourceResponse.url);
    if (!["www.federalreserve.gov", "www.ecb.europa.eu"].includes(finalURL.hostname)) return json({ error: "Statement redirected outside its official publisher" }, 400);
    const $ = load(await sourceResponse.text());
    $("script,style,nav,header,footer").remove();
    const content = $(".ecb-pressContent, #article, .col-xs-12.col-sm-8.col-md-8").first();
    let text = (content.length ? content.text() : $("main").text()).replace(/\s+/g, " ").trim();
    // ECB opening statement only, not the subsequent journalist questions.
    const qa = text.search(/(?:Question and answer session|Questions and answers|\bQ&A\b)/i);
    if (qa > 500) text = text.slice(0, qa);
    if (text.length < 300) return json({ error: "The official statement text could not be extracted" }, 422);
    text = text.slice(0, 28000);
    const properties = Object.fromEntries(Object.entries(TAXONOMY_DIMENSIONS).map(([name, values]) => [name, { type: "string", enum: [...values] }]));
    const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
    let upstreamHeaders: HeadersInit | undefined;
    try {
      const call = createResponsesCall(req, { baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, model: "openai/gpt-6-astra" },
        [{ role: "user", content: `${item.bank} official statement, ${item.item_date}:\n${text}` }],
        "Classify only the supplied official monetary policy statement across the six schema dimensions. Do not infer from scores, titles, news or outside knowledge. Use neutral_framing, balanced, mixed or open_ended where appropriate; balance_sheet is not_discussed if absent. Return only the small schema object.", schema);
      const dimensions = await call.result.output;
      upstreamHeaders = (await call.result.response).headers;
      if (!hasTaxonomyDimensions(dimensions)) return json({ error: "No valid statement classification was returned" }, 422, upstreamHeaders);
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const textHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
      const { error: saveError } = await sb.from("analysis_cache").upsert({ analysis_type: "policy-taxonomy-statement", bank: item.bank, data_hash: taxonomyCacheKey(item), result: { dimensions, source_url: item.url, statement_date: item.item_date, text_hash: textHash, extractor: "official-statement-v1" }, created_at: new Date().toISOString() }, { onConflict: "analysis_type,bank,data_hash" });
      if (saveError) throw saveError;
      if (parsed.data.resume) await sb.from("analysis_cache").delete().eq("analysis_type", "policy-taxonomy-paused").eq("bank", "ALL");
      return json({ classified: 1, processed: 1, remaining: pending.length - 1 }, 200, upstreamHeaders);
    } catch (error) {
      const failure = error as { statusCode?: number; responseBody?: string; message?: string };
      const status = failure.statusCode;
      let safe = "Statement analysis is temporarily unavailable";
      try { safe = JSON.parse(failure.responseBody || "{}").message || safe; } catch { /* keep safe message */ }
      if (status === 402 || status === 403) {
        const result = { error: safe, upstream_status: status, unavailable: true, provider_denied: status === 403 && !/credit|limit|disabled|policy/i.test(safe) };
        await sb.from("analysis_cache").upsert({ analysis_type: "policy-taxonomy-paused", bank: "ALL", data_hash: "statement-v1", result, created_at: new Date().toISOString() }, { onConflict: "analysis_type,bank,data_hash" });
        return json(result, status === 403 ? 403 : 200);
      }
      if (status) return json({ error: safe, unavailable: true, upstream_status: status }, status === 429 || status >= 500 ? 200 : status);
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return json({ error: "Analysis stopped" }, 499);
    console.error("policy-taxonomy:", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Statement analysis is temporarily unavailable", unavailable: true }, 500);
  }
});

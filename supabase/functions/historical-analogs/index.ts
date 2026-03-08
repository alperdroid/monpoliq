import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { event_title, event_date, event_score, bank = "FED" } = await req.json();

    if (!event_title) {
      return new Response(JSON.stringify({ error: "event_title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all historical communications for the same bank
    const { data: items } = await sb
      .from("sentiment_items")
      .select("title, item_date, net_score, label, source, is_statistical, reasons")
      .eq("bank", bank)
      .eq("is_statistical", false)
      .order("item_date", { ascending: false })
      .limit(500);

    if (!items || items.length < 5) {
      return new Response(JSON.stringify({ analogs: [], message: "Insufficient historical data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash for caching
    const hashInput = `${event_title}:${bank}:${items.length}`;
    const hashBytes = new TextEncoder().encode(hashInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", hashBytes);
    const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    const { data: cached } = await sb
      .from("analysis_cache")
      .select("result")
      .eq("analysis_type", `historical_analogs_${bank}`)
      .eq("data_hash", dataHash)
      .limit(1)
      .maybeSingle();

    if (cached?.result) {
      return new Response(JSON.stringify(cached.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build event descriptions for AI matching
    const historicalSummary = items.slice(0, 100).map((i: any, idx: number) =>
      `[${idx}] ${i.item_date}: "${i.title}" score=${i.net_score} label=${i.label}`
    ).join("\n");

    const prompt = `Given this current event:
Title: "${event_title}"
Date: ${event_date || "recent"}
Score: ${event_score || "unknown"}
Bank: ${bank}

Find the 5 most similar historical events from the list below. For each analog, explain:
1. Why it's similar (shared themes, tone, context)
2. What happened AFTER that event (next policy decision, tone shift)
3. The likely market reaction pattern

Historical events:
${historicalSummary}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a monetary policy historian with deep knowledge of central bank communication patterns." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_analogs",
            description: "Report the 5 closest historical analogs with outcomes",
            parameters: {
              type: "object",
              properties: {
                analogs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      date: { type: "string" },
                      score: { type: "number" },
                      similarity_reason: { type: "string" },
                      what_happened_next: { type: "string" },
                      next_decision: { type: "string" },
                      tone_shift: { type: "string", enum: ["hawkish", "dovish", "stable"] },
                      market_reaction: { type: "string" },
                    },
                    required: ["title", "date", "similarity_reason", "what_happened_next", "next_decision", "tone_shift"],
                  },
                },
                pattern_summary: { type: "string", description: "Overall pattern from analogs" },
              },
              required: ["analogs", "pattern_summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_analogs" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call");

    const result = {
      ...JSON.parse(toolCall.function.arguments),
      source_event: { title: event_title, date: event_date, score: event_score, bank },
      generated_at: new Date().toISOString(),
    };

    await sb.from("analysis_cache").upsert({
      analysis_type: `historical_analogs_${bank}`,
      bank,
      data_hash: dataHash,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("historical-analogs error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

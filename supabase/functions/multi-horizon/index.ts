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

    // Fetch 90 days of data
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data: items } = await sb
      .from("sentiment_items")
      .select("bank, title, item_date, net_score, label, is_statistical, policy_dimensions, reasons, topics, stat_metric, stat_value")
      .gte("item_date", cutoffStr)
      .order("item_date", { ascending: false });

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash for caching
    const hashInput = items.map((i: any) => `${i.bank}:${i.item_date}:${i.net_score}`).join("|");
    const hashBytes = new TextEncoder().encode(hashInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", hashBytes);
    const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    // Check cache
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("result")
      .eq("analysis_type", "multi_horizon")
      .eq("data_hash", dataHash)
      .limit(1)
      .maybeSingle();

    if (cached?.result) {
      return new Response(JSON.stringify(cached.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build summaries per bank per window
    const summarize = (bank: string, days: number) => {
      const cut = new Date();
      cut.setDate(cut.getDate() - days);
      const cs = cut.toISOString().split("T")[0];
      const filtered = items.filter((i: any) => i.bank === bank && i.item_date >= cs);
      const comms = filtered.filter((i: any) => !i.is_statistical);
      const stats = filtered.filter((i: any) => i.is_statistical);
      const avg = (arr: any[]) => arr.length ? arr.reduce((s: number, i: any) => s + (i.net_score || 0), 0) / arr.length : 0;
      return {
        avg_score: Math.round(avg(filtered) * 1000) / 1000,
        comms_count: comms.length,
        stats_count: stats.length,
        hawk_ratio: comms.filter((i: any) => i.label?.includes("hawk")).length / Math.max(comms.length, 1),
        dove_ratio: comms.filter((i: any) => i.label?.includes("dov")).length / Math.max(comms.length, 1),
        top_titles: comms.slice(0, 5).map((i: any) => `${i.item_date}: "${i.title}" (${i.net_score})`),
        key_stats: stats.slice(0, 3).map((i: any) => `${i.stat_metric}: ${i.stat_value}`),
      };
    };

    const fed7 = summarize("FED", 7);
    const fed30 = summarize("FED", 30);
    const fed90 = summarize("FED", 90);
    const ecb7 = summarize("ECB", 7);
    const ecb30 = summarize("ECB", 30);
    const ecb90 = summarize("ECB", 90);

    const prompt = `You are a monetary policy forecaster. Based on the following data windows, produce multi-horizon forecasts for both FED and ECB.

FED 7-day: avg=${fed7.avg_score}, ${fed7.comms_count} comms, hawk_ratio=${fed7.hawk_ratio.toFixed(2)}
Recent: ${fed7.top_titles.join("; ")}

FED 30-day: avg=${fed30.avg_score}, ${fed30.comms_count} comms, hawk_ratio=${fed30.hawk_ratio.toFixed(2)}
Stats: ${fed30.key_stats.join("; ")}

FED 90-day: avg=${fed90.avg_score}, ${fed90.comms_count} comms

ECB 7-day: avg=${ecb7.avg_score}, ${ecb7.comms_count} comms, hawk_ratio=${ecb7.hawk_ratio.toFixed(2)}
Recent: ${ecb7.top_titles.join("; ")}

ECB 30-day: avg=${ecb30.avg_score}, ${ecb30.comms_count} comms
Stats: ${ecb30.key_stats.join("; ")}

ECB 90-day: avg=${ecb90.avg_score}, ${ecb90.comms_count} comms

For each bank, produce three horizon forecasts:
1. Near-term (1-7 days): direction of tone/market sentiment
2. Meeting outcome: next meeting decision probabilities
3. Policy path (1-3 months): bias direction`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a quantitative monetary policy forecaster." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "multi_horizon_forecast",
            description: "Return multi-horizon forecasts for FED and ECB",
            parameters: {
              type: "object",
              properties: {
                fed: {
                  type: "object",
                  properties: {
                    near_term: {
                      type: "object",
                      properties: {
                        direction: { type: "string", enum: ["hawkish", "dovish", "neutral"] },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["direction", "confidence", "summary"],
                    },
                    meeting: {
                      type: "object",
                      properties: {
                        hike_prob: { type: "number" },
                        hold_prob: { type: "number" },
                        cut_prob: { type: "number" },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["hike_prob", "hold_prob", "cut_prob", "confidence", "summary"],
                    },
                    policy_path: {
                      type: "object",
                      properties: {
                        bias: { type: "string", enum: ["tightening", "easing", "neutral"] },
                        magnitude: { type: "string", enum: ["strong", "moderate", "mild"] },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["bias", "magnitude", "confidence", "summary"],
                    },
                  },
                  required: ["near_term", "meeting", "policy_path"],
                },
                ecb: {
                  type: "object",
                  properties: {
                    near_term: {
                      type: "object",
                      properties: {
                        direction: { type: "string", enum: ["hawkish", "dovish", "neutral"] },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["direction", "confidence", "summary"],
                    },
                    meeting: {
                      type: "object",
                      properties: {
                        hike_prob: { type: "number" },
                        hold_prob: { type: "number" },
                        cut_prob: { type: "number" },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["hike_prob", "hold_prob", "cut_prob", "confidence", "summary"],
                    },
                    policy_path: {
                      type: "object",
                      properties: {
                        bias: { type: "string", enum: ["tightening", "easing", "neutral"] },
                        magnitude: { type: "string", enum: ["strong", "moderate", "mild"] },
                        confidence: { type: "number" },
                        summary: { type: "string" },
                      },
                      required: ["bias", "magnitude", "confidence", "summary"],
                    },
                  },
                  required: ["near_term", "meeting", "policy_path"],
                },
              },
              required: ["fed", "ecb"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "multi_horizon_forecast" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const forecast = JSON.parse(toolCall.function.arguments);
    const result = {
      ...forecast,
      data_windows: { fed: { d7: fed7, d30: fed30, d90: fed90 }, ecb: { d7: ecb7, d30: ecb30, d90: ecb90 } },
      generated_at: new Date().toISOString(),
    };

    // Cache
    await sb.from("analysis_cache").upsert({
      analysis_type: "multi_horizon",
      bank: "ALL",
      data_hash: dataHash,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("multi-horizon error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

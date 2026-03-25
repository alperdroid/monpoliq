import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Check cache (6h TTL for market data)
    const cacheType = "ois-overlay";
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("*")
      .eq("analysis_type", cacheType)
      .eq("bank", "ALL")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 6 * 60 * 60 * 1000) {
        return new Response(JSON.stringify(cached.result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Get model predictions for comparison
    const { data: predCache } = await sb
      .from("prediction_cache")
      .select("predictions")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const modelPreds = predCache?.predictions as any || {};

    // Get latest sentiment context
    const { data: recentItems } = await sb
      .from("sentiment_items")
      .select("bank, title, net_score, item_date, is_statistical, stat_metric, stat_value")
      .order("item_date", { ascending: false })
      .limit(30);

    const contextSummary = (recentItems || []).map(i =>
      `${i.bank} [${i.item_date}]: ${i.title} (score: ${i.net_score}${i.stat_metric ? `, ${i.stat_metric}: ${i.stat_value}` : ''})`
    ).join('\n');

    const modelContext = modelPreds ? `
Model predictions context:
- Fed: ${modelPreds.fed?.next_decision || 'N/A'} (hike: ${modelPreds.fed?.hike_probability || 0}%, hold: ${modelPreds.fed?.hold_probability || 0}%, cut: ${modelPreds.fed?.cut_probability || 0}%)
- ECB: ${modelPreds.ecb?.next_decision || 'N/A'} (hike: ${modelPreds.ecb?.hike_probability || 0}%, hold: ${modelPreds.ecb?.hold_probability || 0}%, cut: ${modelPreds.ecb?.cut_probability || 0}%)` : '';

    const prompt = `You are a fixed-income market data specialist. Provide the CURRENT real OIS (Overnight Index Swap) market-implied forward rates as of today, ${new Date().toISOString().split('T')[0]}.

For both the Federal Reserve (Fed Funds Rate) and ECB (Deposit Facility Rate), provide the current OIS-implied rates at the following horizons:
- Spot (current effective rate)
- 3-month forward
- 6-month forward
- 1-year forward
- 2-year forward

These should be REAL market rates from OIS swap markets, not synthetic or made up values. Use the latest available data.

Current context:
${contextSummary}
${modelContext}

For the "model_rate" at each horizon, use a simple linear interpolation from the model's predicted policy path. If the model expects cuts, interpolate down; if holds, keep flat; if hikes, interpolate up.

IMPORTANT: Return REAL OIS market rates. These are widely published by Bloomberg, ICE, CME, and central bank research.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a fixed-income market data specialist. Always return real, current market data." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "ois_rates",
            description: "Return current OIS-implied forward rates for Fed and ECB at multiple horizons",
            parameters: {
              type: "object",
              properties: {
                fed: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      horizon: { type: "string", enum: ["Spot", "3M", "6M", "1Y", "2Y"] },
                      ois_rate: { type: "number", description: "Market OIS-implied rate in percent" },
                      model_rate: { type: "number", description: "Model fundamental implied rate in percent" },
                    },
                    required: ["horizon", "ois_rate", "model_rate"],
                  },
                },
                ecb: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      horizon: { type: "string", enum: ["Spot", "3M", "6M", "1Y", "2Y"] },
                      ois_rate: { type: "number" },
                      model_rate: { type: "number" },
                    },
                    required: ["horizon", "ois_rate", "model_rate"],
                  },
                },
                market_date: { type: "string", description: "Date of the market data" },
                notes: { type: "string", description: "Brief note on key divergences between market and model" },
              },
              required: ["fed", "ecb", "market_date", "notes"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "ois_rates" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      throw new Error(`AI gateway error: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in AI response");

    const parsed = JSON.parse(toolCall.function.arguments);

    const result = {
      fed: parsed.fed,
      ecb: parsed.ecb,
      market_date: parsed.market_date,
      notes: parsed.notes,
      generated_at: new Date().toISOString(),
    };

    // Cache
    await sb.from("analysis_cache").upsert({
      analysis_type: cacheType,
      bank: "ALL",
      data_hash: `ois-${parsed.market_date}`,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" }).select();

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ois-curve error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

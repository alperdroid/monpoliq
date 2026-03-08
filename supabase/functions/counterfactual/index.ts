import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { bank, scenario, custom_text } = await req.json();
    if (!bank || !scenario) throw new Error("Missing bank or scenario");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch current state for context
    const [scoresRes, itemsRes, predRes] = await Promise.all([
      sb.from("sentiment_scores").select("*").order("fetched_at", { ascending: false }).limit(2),
      sb.from("sentiment_items")
        .select("bank, title, item_date, net_score, label")
        .eq("bank", bank)
        .eq("is_statistical", false)
        .order("item_date", { ascending: false })
        .limit(10),
      sb.from("prediction_cache").select("predictions").order("created_at", { ascending: false }).limit(1),
    ]);

    const scores = scoresRes.data || [];
    const recentItems = itemsRes.data || [];
    const currentPred = predRes.data?.[0]?.predictions;
    const bankScore = scores.find((s: any) => s.bank === bank);

    const scenarioDescriptions: Record<string, string> = {
      more_restrictive: "The next official statement adopts significantly more hawkish language, emphasizing persistent inflation risks, willingness to raise rates further, and removing any forward guidance about pausing.",
      data_dependent: "The next statement shifts to purely data-dependent language, removing directional bias, emphasizing uncertainty, and signaling equal probability of tightening or easing.",
      cuts_possible: "The next statement introduces explicit dovish language: 'the committee is prepared to adjust policy to support the economy', downside risks to growth mentioned, inflation expectations well-anchored.",
      emergency_easing: "An inter-meeting statement signals urgent concern: financial stability risks, credit tightening, sharp growth deterioration. Emergency rate cut of 50bps or more implied.",
      custom: custom_text || "Custom scenario text not provided.",
    };

    const scenarioText = scenarioDescriptions[scenario] || scenario;

    const systemPrompt = `You are a senior monetary policy strategist. Given the current policy stance and recent communications for ${bank}, analyze the impact of a hypothetical scenario on:
1. The implied policy path (next 3 meetings)
2. EUR/USD directional bias
3. US 10Y Treasury yield bias
4. Confidence level and comparable historical analogs

Current context:
- ${bank} current score: ${bankScore ? `avg=${bankScore.score_2_avg}, label=${bankScore.score_2_label}` : 'N/A'}
- Recent communications: ${recentItems.map((i: any) => `"${i.title}" (${i.net_score})`).join(', ')}
${currentPred ? `- Current prediction: ${bank === 'FED' ? JSON.stringify(currentPred.fed) : JSON.stringify(currentPred.ecb)}` : ''}

You MUST respond with ONLY valid JSON (no markdown):
{
  "scenario_name": "brief name",
  "scenario_impact": "2-3 sentence summary of what changes",
  "policy_path": [
    { "meeting": "next", "action": "hold|cut|hike", "probability": 0.0-1.0, "shift_from_baseline": "string" },
    { "meeting": "next+1", "action": "hold|cut|hike", "probability": 0.0-1.0, "shift_from_baseline": "string" },
    { "meeting": "next+2", "action": "hold|cut|hike", "probability": 0.0-1.0, "shift_from_baseline": "string" }
  ],
  "eurusd_impact": {
    "direction": "bullish|bearish|neutral",
    "magnitude": "strong|moderate|mild",
    "reasoning": "1-2 sentences"
  },
  "us10y_impact": {
    "direction": "higher|lower|stable",
    "magnitude": "strong|moderate|mild",
    "reasoning": "1-2 sentences"
  },
  "historical_analogs": [
    { "date": "YYYY-MM", "event": "brief description", "market_reaction": "what happened" }
  ],
  "confidence": 0.0-1.0,
  "risk_factors": ["factor1", "factor2"]
}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `SCENARIO: ${scenarioText}\n\nAnalyze the counterfactual impact for ${bank}.` },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status} ${errText}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      throw new Error("AI returned invalid JSON");
    }

    result.bank = bank;
    result.scenario_input = scenario;
    result.generated_at = new Date().toISOString();

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("counterfactual error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

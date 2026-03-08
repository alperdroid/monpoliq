import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const { bank = "FED", hawkish = 0.5, uncertainty = 0.5, inflation_focus = 0.5, financial_stability = 0.3 } = await req.json();

    const prompt = `Generate a realistic central bank policy statement for the ${bank === "FED" ? "Federal Reserve" : "European Central Bank"} with these characteristics:
- Hawkishness: ${(hawkish * 100).toFixed(0)}% (0=very dovish, 100=very hawkish)
- Uncertainty: ${(uncertainty * 100).toFixed(0)}% (0=very confident, 100=very uncertain)
- Inflation focus: ${(inflation_focus * 100).toFixed(0)}% (0=growth-focused, 100=inflation-focused)
- Financial stability emphasis: ${(financial_stability * 100).toFixed(0)}%

Also predict the policy implications of such a statement.`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a central bank communications expert who writes realistic policy statements." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "generate_statement",
            description: "Generate a synthetic policy statement and predict its effects",
            parameters: {
              type: "object",
              properties: {
                statement_text: { type: "string", description: "The full synthetic statement (2-3 paragraphs)" },
                key_phrases: { type: "array", items: { type: "string" }, description: "Notable phrases that drive tone" },
                predicted_stance_score: { type: "number", description: "-1 (dovish) to 1 (hawkish)" },
                predicted_decision_shift: {
                  type: "object",
                  properties: {
                    hike_delta: { type: "number" },
                    hold_delta: { type: "number" },
                    cut_delta: { type: "number" },
                  },
                  required: ["hike_delta", "hold_delta", "cut_delta"],
                },
                market_impact: {
                  type: "object",
                  properties: {
                    fx_direction: { type: "string", enum: ["usd_bullish", "usd_bearish", "neutral"] },
                    yield_direction: { type: "string", enum: ["higher", "lower", "stable"] },
                    equity_direction: { type: "string", enum: ["positive", "negative", "mixed"] },
                  },
                  required: ["fx_direction", "yield_direction", "equity_direction"],
                },
              },
              required: ["statement_text", "key_phrases", "predicted_stance_score", "predicted_decision_shift", "market_impact"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "generate_statement" } },
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
      parameters: { bank, hawkish, uncertainty, inflation_focus, financial_stability },
      generated_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("statement-generator error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

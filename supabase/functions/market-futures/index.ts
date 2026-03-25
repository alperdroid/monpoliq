import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split('T')[0];
    
    const prompt = `You are a financial data analyst. Today is ${today}. Provide ACCURATE current market data using the latest available pricing. Be very precise with prices — use realistic values consistent with current market conditions.

CRITICAL MARKET CONTEXT (March 2026):
- The Fed has held rates steady at 4.25-4.50% since December 2024. Markets currently price NO rate cuts for the remainder of 2026 due to sticky inflation (CPI ~2.8% YoY), tariff uncertainty, and resilient labor markets.
- The ECB cut rates to 2.50% in March 2025 and markets price 1-2 additional 25bp cuts by year-end as euro area inflation moderates near target.
- Fed Funds futures should reflect hold expectations (prices near 95.55-95.60 implying ~4.40% effective rate, with very high hold probabilities ~80-95%).
- Euribor futures should reflect gradual ECB easing expectations.

**RATE FUTURES** (category: "rate_futures"):
1. Fed Funds futures (ZQ) for next 2-3 upcoming FOMC meetings — price = 100 minus implied rate. Since markets expect NO cuts, prices should be near 95.55-95.60 with hold_prob ~0.85-0.95 and cut_prob ~0.05-0.15.
2. Euribor futures (ER) for next 2-3 upcoming ECB meetings — price = 100 minus implied Euribor rate. ECB deposit rate is 2.50%, markets price gradual easing so forward rates slightly below spot.
- Include: price (must be consistent with rate expectations), market-implied hike/hold/cut probabilities, fundamental-assessed probabilities, 24h change
- IMPORTANT: Probabilities must sum to exactly 1.0 for each instrument

**TREASURY & SOVEREIGN BONDS** (category: "bonds"):
1. US 10-Year Treasury Note futures (ZN) — current ~110-112 range, yield ~4.2-4.4%
2. US 2-Year Treasury Note futures (ZT) — current ~103-104 range, yield ~3.9-4.1%
3. German 10-Year Bund futures (FGBL) — current ~130-133 range, yield ~2.6-2.8%
4. US 10Y-2Y yield curve spread — currently ~30-50 bps
- Include: price/yield, 24h change, direction (bullish/bearish/neutral), ai_direction

**CURRENCY FORWARDS** (category: "currency"):
1. EUR/USD 3-month forward — currently around 1.08-1.10
2. GBP/USD 3-month forward — currently around 1.29-1.31
3. USD/JPY 3-month forward — currently around 148-152
- Include: price (forward rate to 4 decimal places), 24h change, direction, ai_direction

Use the most accurate and up-to-date pricing you have. Do NOT use placeholder or round numbers. For the "ai_" fields, use "fundamental" analysis-based assessment that may differ from market pricing.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a financial data expert. Provide accurate, up-to-date market information." },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Return current multi-asset market data",
              parameters: {
                type: "object",
                properties: {
                  instruments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        category: { type: "string", enum: ["rate_futures", "bonds", "currency"] },
                        bank: { type: "string", enum: ["FED", "ECB", "BOJ", "BOE", "MULTI"] },
                        reference_date: { type: "string", description: "Meeting date for rate futures, maturity for bonds, or settlement for FX" },
                        price: { type: "number" },
                        change_24h: { type: "number" },
                        yield_value: { type: "number", description: "Yield for bonds, null for others" },
                        spread_bps: { type: "number", description: "Spread in basis points for curve trades, null for others" },
                        market_hike_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        market_hold_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        market_cut_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        ai_hike_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        ai_hold_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        ai_cut_prob: { type: "number", description: "For rate_futures only, 0 otherwise" },
                        direction: { type: "string", enum: ["bullish", "bearish", "neutral"], description: "Market direction for bonds/currency" },
                        ai_direction: { type: "string", enum: ["bullish", "bearish", "neutral"], description: "AI-assessed direction for bonds/currency" }
                      },
                      required: ["id", "name", "category", "bank", "reference_date", "price", "change_24h"]
                    }
                  }
                },
                required: ["instruments"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "provide_market_data" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errorText = await response.text();
      console.error("API error:", response.status, errorText);
      throw new Error(`API call failed: ${errorText}`);
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "provide_market_data") {
      throw new Error("Invalid response format");
    }

    const result = JSON.parse(toolCall.function.arguments);
    
    return new Response(JSON.stringify(result.instruments), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Market data error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

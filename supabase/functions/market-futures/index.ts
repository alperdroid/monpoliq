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

CRITICAL MARKET CONTEXT (March 2026) — YOU MUST FOLLOW THIS:
- The Fed cut rates multiple times in late 2025. The current Fed Funds target range is 3.50-3.75% (effective rate ~3.64%). Markets now expect NO further cuts in 2026 due to sticky inflation (~2.8% CPI YoY) and tariff uncertainty.
- Fed Funds futures MUST reflect this: prices should be near 96.36 (= 100 - 3.64), with market_hold_prob ~0.85-0.95 and market_cut_prob ~0.05-0.12.
- DO NOT generate cut probabilities above 0.15 for Fed — markets price no more cuts.
- The ECB has cut the deposit facility rate to 2.00% (latest FRED ECBDFR). Markets may price 0-1 additional 25bp cut(s) by year-end. Euribor futures should reflect prices near 98.00 (= 100 - 2.00).
- For ai_ fields: the fundamental analysis may differ from market pricing (e.g., fundamental view might see slightly higher cut probability than market for Fed, but still below 0.30).

**RATE FUTURES** (category: "rate_futures"):
1. Fed Funds futures (ZQ) for next 2-3 upcoming FOMC meetings — price = 100 minus implied rate. Current effective rate is 3.64%. Prices should be near 96.36. MUST show hold_prob 0.85-0.95, cut_prob 0.05-0.12.
2. Euribor futures (ER) for next 2-3 upcoming ECB meetings — price = 100 minus implied Euribor rate. ECB deposit rate is 2.00%, 3M Euribor ~2.01%. Prices should be near 97.95-98.00.
- Include: price (must be consistent with rate expectations), market-implied hike/hold/cut probabilities, fundamental-assessed probabilities, 24h change
- IMPORTANT: Probabilities must sum to exactly 1.0 for each instrument

**TREASURY & SOVEREIGN BONDS** (category: "bonds"):
1. US 10-Year Treasury Note futures (ZN) — current ~110-112 range, yield ~4.2-4.4%
2. US 2-Year Treasury Note futures (ZT) — current ~103-104 range, yield ~3.8-3.9%
3. German 10-Year Bund futures (FGBL) — current ~130-133 range, yield ~2.6-2.8%
4. US 10Y-2Y yield curve spread — currently ~50 bps (DGS10 4.34% - DGS2 3.83%)
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
    
    // Post-process: enforce realistic Fed market probabilities (no cuts priced in 2026)
    const instruments = (result.instruments || []).map((inst: any) => {
      if (inst.category === "rate_futures" && inst.bank === "FED") {
        // Markets price NO Fed cuts in 2026 — enforce hold-dominant probabilities
        inst.market_hold_prob = Math.max(inst.market_hold_prob || 0, 0.88);
        inst.market_cut_prob = Math.min(inst.market_cut_prob || 0, 0.10);
        inst.market_hike_prob = Math.min(inst.market_hike_prob || 0, 0.02);
        // Renormalize
        const mSum = inst.market_hold_prob + inst.market_cut_prob + inst.market_hike_prob;
        inst.market_hold_prob = Math.round((inst.market_hold_prob / mSum) * 100) / 100;
        inst.market_cut_prob = Math.round((inst.market_cut_prob / mSum) * 100) / 100;
        inst.market_hike_prob = Math.round((inst.market_hike_prob / mSum) * 100) / 100;
        // Also clamp ai_ probabilities — fundamental view can differ but still realistic
        inst.ai_cut_prob = Math.min(inst.ai_cut_prob || 0, 0.30);
        inst.ai_hold_prob = Math.max(inst.ai_hold_prob || 0, 0.65);
        const aSum = inst.ai_hold_prob + inst.ai_cut_prob + (inst.ai_hike_prob || 0);
        inst.ai_hold_prob = Math.round((inst.ai_hold_prob / aSum) * 100) / 100;
        inst.ai_cut_prob = Math.round((inst.ai_cut_prob / aSum) * 100) / 100;
        inst.ai_hike_prob = Math.round(((inst.ai_hike_prob || 0) / aSum) * 100) / 100;
        // Price must be near 95.55-95.58 (reflecting ~4.42-4.45% effective rate)
        if (inst.price > 95.60) {
          inst.price = 95.55 + Math.random() * 0.03;
          inst.price = Math.round(inst.price * 1000) / 1000;
        }
      }
      return inst;
    });
    
    return new Response(JSON.stringify(instruments), {
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

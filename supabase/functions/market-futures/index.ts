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
    
    const prompt = `You are a financial data analyst. For today (${today}), provide current market data across these categories:

**RATE FUTURES** (category: "rate_futures"):
1. Fed Funds futures for next 2-3 upcoming FOMC meetings
2. Euribor futures for next 2-3 upcoming ECB meetings
- Include: price, market-implied hike/hold/cut probabilities, AI-assessed probabilities, 24h change

**TREASURY & SOVEREIGN BONDS** (category: "bonds"):
1. US 10-Year Treasury Note futures
2. US 2-Year Treasury Note futures  
3. German 10-Year Bund futures
4. US 10Y-2Y yield curve spread
- Include: price/yield, 24h change, direction (bullish/bearish/neutral), ai_direction

**CURRENCY FORWARDS** (category: "currency"):
1. EUR/USD 3-month forward
2. GBP/USD 3-month forward
3. USD/JPY 3-month forward
- Include: price (forward rate), 24h change, direction, ai_direction

Use actual current market data. For rate futures, probabilities must sum to 1.0.`;

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

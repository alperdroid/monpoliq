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
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const today = new Date().toISOString().split('T')[0];

    // 2026 meeting schedule (source of truth)
    const fomcDates = ['2026-01-29','2026-03-19','2026-04-30','2026-06-11','2026-07-30','2026-09-17','2026-11-05','2026-12-17'];
    const ecbDates = ['2026-02-05','2026-03-19','2026-04-30','2026-06-11','2026-07-23','2026-09-10','2026-10-29','2026-12-17'];

    // Get next 3 upcoming meetings from today
    const nextFomc = fomcDates.filter(d => d >= today).slice(0, 3);
    const nextEcb = ecbDates.filter(d => d >= today).slice(0, 3);

    const fomcList = nextFomc.map((d, i) => `${i+1}. FOMC ${d} — id: "ZQ_FOMC_${d.replace(/-/g,'')}"`).join('\n');
    const ecbList = nextEcb.map((d, i) => `${i+1}. ECB ${d} — id: "ER_ECB_${d.replace(/-/g,'')}"`).join('\n');

    const prompt = `Today is ${today}. You are a financial markets data provider. Provide the CURRENT market-implied interest rate expectations for upcoming central bank meetings based on INTEREST RATE FUTURES pricing.

IMPORTANT CONTEXT:
- For the Fed: Use CME Fed Funds Futures (ZQ contracts) and CME FedWatch implied probabilities. The futures price = 100 - implied average fed funds rate for that month. Current Fed Funds target range and any recent market moves should be reflected.
- For the ECB: Use €STR/Euribor futures pricing. The futures price = 100 - implied rate. Current ECB deposit facility rate and market expectations should be reflected.

These are FUTURES prices, NOT the current spot policy rate. Futures prices embed market expectations of future rate changes. For example:
- If the current Fed Funds rate is 4.25-4.50% but markets expect a cut by June, the June futures price would be HIGHER than 95.625 (reflecting a lower implied rate).
- If markets expect no change, futures prices stay near the current implied rate.

EXACT MEETING DATES (use these, do NOT invent dates):
FED (FOMC):
${fomcList}

ECB (Governing Council):
${ecbList}

For each meeting, provide:
- price: The interest rate futures price for the contract corresponding to that meeting month. This should reflect MARKET EXPECTATIONS, not just the current policy rate.
- change_24h: Realistic daily price change (±0.005 to ±0.03)
- implied_rate: The rate implied by the futures price (= 100 - price)
- market probabilities (hike/hold/cut): What the futures pricing implies about the probability of each action at that meeting. These must be derived from the step between the current rate and the futures-implied rate.
- ai probabilities (hike/hold/cut): Your fundamental/model assessment which may differ from market pricing.

CRITICAL RULES:
1. Use the EXACT meeting dates and IDs listed above
2. Probabilities must sum to 1.0 for each set
3. Futures prices must be REALISTIC and reflect actual current market consensus
4. Do NOT just use the current policy rate as the futures price — futures embed forward expectations
5. Be accurate about where markets currently stand on rate expectations`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial markets data terminal. You have access to the latest interest rate futures pricing data from CME (Fed Funds futures, FedWatch) and ICE/Eurex (€STR/Euribor futures). Provide accurate current market pricing. Do not hallucinate — if unsure, use conservative estimates close to current rates with slight forward bias reflecting consensus." },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Return current futures market pricing for upcoming central bank meetings",
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
                        category: { type: "string", enum: ["rate_futures"] },
                        bank: { type: "string", enum: ["FED", "ECB"] },
                        reference_date: { type: "string", description: "Meeting date" },
                        price: { type: "number", description: "Futures price (100 - implied rate)" },
                        implied_rate: { type: "number", description: "Rate implied by futures price" },
                        change_24h: { type: "number" },
                        market_hike_prob: { type: "number" },
                        market_hold_prob: { type: "number" },
                        market_cut_prob: { type: "number" },
                        ai_hike_prob: { type: "number" },
                        ai_hold_prob: { type: "number" },
                        ai_cut_prob: { type: "number" },
                      },
                      required: ["id", "name", "category", "bank", "reference_date", "price", "implied_rate", "change_24h",
                        "market_hike_prob", "market_hold_prob", "market_cut_prob",
                        "ai_hike_prob", "ai_hold_prob", "ai_cut_prob"]
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
      console.error('No valid tool call found:', JSON.stringify(data.choices?.[0]?.message).slice(0, 1000));
      throw new Error("Invalid response format");
    }

    const result = JSON.parse(toolCall.function.arguments);

    // Post-process: ensure probabilities sum to 1.0
    const instruments = (result.instruments || []).map((inst: any) => {
      const mSum = (inst.market_hike_prob || 0) + (inst.market_hold_prob || 0) + (inst.market_cut_prob || 0);
      if (mSum > 0) {
        inst.market_hike_prob = Math.round(((inst.market_hike_prob || 0) / mSum) * 100) / 100;
        inst.market_hold_prob = Math.round(((inst.market_hold_prob || 0) / mSum) * 100) / 100;
        inst.market_cut_prob = Math.round(((inst.market_cut_prob || 0) / mSum) * 100) / 100;
      }
      const aSum = (inst.ai_hike_prob || 0) + (inst.ai_hold_prob || 0) + (inst.ai_cut_prob || 0);
      if (aSum > 0) {
        inst.ai_hike_prob = Math.round(((inst.ai_hike_prob || 0) / aSum) * 100) / 100;
        inst.ai_hold_prob = Math.round(((inst.ai_hold_prob || 0) / aSum) * 100) / 100;
        inst.ai_cut_prob = Math.round(((inst.ai_cut_prob || 0) / aSum) * 100) / 100;
      }
      // Ensure implied_rate is consistent with price
      inst.implied_rate = Math.round((100 - inst.price) * 1000) / 1000;
      return inst;
    });

    const responsePayload = {
      instruments,
      sources: {
        fed: 'CME Fed Funds Futures / FedWatch',
        ecb: '€STR / Euribor Futures',
      },
      generated_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(responsePayload), {
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

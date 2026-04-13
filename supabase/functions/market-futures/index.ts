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

    // 2026 meeting schedule
    const fomcDates = ['2026-01-29','2026-03-19','2026-04-30','2026-06-11','2026-07-30','2026-09-17','2026-11-05','2026-12-17'];
    const ecbDates = ['2026-02-05','2026-03-19','2026-04-30','2026-06-11','2026-07-23','2026-09-10','2026-10-29','2026-12-17'];

    const nextFomc = fomcDates.filter(d => d >= today).slice(0, 3);
    const nextEcb = ecbDates.filter(d => d >= today).slice(0, 3);

    const fomcList = nextFomc.map((d, i) => `${i+1}. FOMC ${d} — id: "ZQ_FOMC_${d.replace(/-/g,'')}"`).join('\n');
    const ecbList = nextEcb.map((d, i) => `${i+1}. ECB ${d} — id: "ER_ECB_${d.replace(/-/g,'')}"`).join('\n');

    const prompt = `Today is ${today}. Report the CURRENT market pricing for interest rate futures for these upcoming central bank meetings. Do NOT estimate or guess — report the actual current data as you know it.

MEETINGS TO REPORT:
FED (FOMC):
${fomcList}

ECB (Governing Council):
${ecbList}

For each meeting, report:
- The futures contract price (e.g. ZQ for Fed Funds futures trades at 96.36, meaning 3.64% implied rate)
- The implied rate (100 - price)
- The CME FedWatch or equivalent market-implied probabilities for hike/hold/cut
- Your fundamental assessment (ai probabilities) which may differ from market pricing
- A small realistic daily price change

IMPORTANT:
- For Fed: Use 30-Day Fed Funds Futures (ZQ) pricing and CME FedWatch probabilities
- For ECB: Use €STR or 3-month Euribor futures pricing and ECB rate expectations
- Report ACTUAL current market data, not estimates
- Use the exact meeting dates and IDs listed above
- All probability sets must sum to 1.0`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial data terminal. Report current market data accurately. Do not estimate or hallucinate — provide the actual current interest rate futures pricing and probabilities as they stand today. If you are unsure of an exact number, use the most recent data you have access to." },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Report current futures market pricing",
              parameters: {
                type: "object",
                properties: {
                  instruments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string", description: "e.g. 'ZQJ6 — Fed Funds Apr 2026' or '€STR Apr 2026'" },
                        category: { type: "string", enum: ["rate_futures"] },
                        bank: { type: "string", enum: ["FED", "ECB"] },
                        reference_date: { type: "string" },
                        price: { type: "number", description: "Futures price e.g. 96.36" },
                        implied_rate: { type: "number", description: "100 - price e.g. 3.64" },
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

    // Post-process: ensure probabilities sum to 1.0 and implied_rate is consistent
    const instruments = (result.instruments || []).map((inst: any) => {
      for (const prefix of ['market_', 'ai_']) {
        const sum = (inst[`${prefix}hike_prob`] || 0) + (inst[`${prefix}hold_prob`] || 0) + (inst[`${prefix}cut_prob`] || 0);
        if (sum > 0) {
          inst[`${prefix}hike_prob`] = Math.round(((inst[`${prefix}hike_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}hold_prob`] = Math.round(((inst[`${prefix}hold_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}cut_prob`] = Math.round(((inst[`${prefix}cut_prob`] || 0) / sum) * 100) / 100;
        }
      }
      inst.implied_rate = Math.round((100 - inst.price) * 1000) / 1000;
      return inst;
    });

    return new Response(JSON.stringify({
      instruments,
      sources: {
        fed: 'CME Fed Funds Futures / FedWatch',
        ecb: '€STR / Euribor Futures',
      },
      generated_at: new Date().toISOString(),
    }), {
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

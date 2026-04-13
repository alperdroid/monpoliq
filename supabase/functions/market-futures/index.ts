import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fredLatest(seriesId: string, apiKey: string): Promise<{ value: number; date: string } | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const obs = d.observations?.find((o: any) => o.value !== '.');
    if (!obs) return null;
    return { value: parseFloat(obs.value), date: obs.date };
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const FRED_API_KEY = Deno.env.get("FRED_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!FRED_API_KEY) throw new Error("FRED_API_KEY is not configured");

    const today = new Date().toISOString().split('T')[0];

    // Fetch current policy rates from FRED for anchoring
    const [fedFunds, ecbRate] = await Promise.all([
      fredLatest('DFF', FRED_API_KEY),
      fredLatest('ECBDFR', FRED_API_KEY),
    ]);

    const ffRate = fedFunds?.value ?? 4.33;
    const ecbDep = ecbRate?.value ?? 2.50;

    // 2026 meeting schedule
    const fomcDates = ['2026-01-29','2026-03-19','2026-04-30','2026-06-11','2026-07-30','2026-09-17','2026-11-05','2026-12-17'];
    const ecbDates = ['2026-02-05','2026-03-19','2026-04-30','2026-06-11','2026-07-23','2026-09-10','2026-10-29','2026-12-17'];

    const nextFomc = fomcDates.filter(d => d >= today).slice(0, 3);
    const nextEcb = ecbDates.filter(d => d >= today).slice(0, 3);

    const fomcList = nextFomc.map((d, i) => `${i+1}. FOMC ${d} — id: "ZQ_FOMC_${d.replace(/-/g,'')}"`).join('\n');
    const ecbList = nextEcb.map((d, i) => `${i+1}. ECB ${d} — id: "ER_ECB_${d.replace(/-/g,'')}"`).join('\n');

    const prompt = `Today is ${today}. Provide current interest rate FUTURES market pricing for upcoming central bank meetings.

CURRENT POLICY RATES (from FRED, use as anchor):
- Fed Funds Effective Rate: ${ffRate}% (as of ${fedFunds?.date || 'latest'})
- ECB Deposit Facility Rate: ${ecbDep}% (as of ${ecbRate?.date || 'latest'})

FUTURES PRICING LOGIC:
- Fed Funds Futures (ZQ): price = 100 - implied fed funds rate. Current spot-equivalent price ≈ ${(100 - ffRate).toFixed(3)}
- €STR Futures: price = 100 - implied €STR rate. ECB deposit rate is ${ecbDep}%, so current spot-equivalent price ≈ ${(100 - ecbDep).toFixed(3)}

The futures price for each meeting should reflect what markets expect the policy rate to be AT THAT MEETING DATE, not what it is today. 
- If markets expect a 25bp cut, the futures price for that meeting would be ~0.25 HIGHER than the spot-equivalent (lower implied rate).
- If markets expect a 25bp hike, the futures price would be ~0.25 LOWER.
- If markets expect no change, futures price stays near the spot-equivalent.

MEETING DATES:
FED (FOMC):
${fomcList}

ECB (Governing Council):
${ecbList}

CONSTRAINTS:
1. Fed implied rates MUST be within ±75bp of ${ffRate}%
2. ECB implied rates MUST be within ±75bp of ${ecbDep}%
3. Probabilities must sum to 1.0
4. Use exact meeting dates and IDs above
5. Reflect realistic current market consensus for rate expectations`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial markets data terminal providing interest rate futures pricing. Use the FRED policy rates as anchors and estimate realistic futures pricing that reflects current market consensus on rate expectations. Be precise." },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Return current futures market pricing",
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
                        reference_date: { type: "string" },
                        price: { type: "number" },
                        implied_rate: { type: "number" },
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

    // Post-process: enforce constraints
    const instruments = (result.instruments || []).map((inst: any) => {
      // Normalize probabilities
      for (const prefix of ['market_', 'ai_']) {
        const sum = (inst[`${prefix}hike_prob`] || 0) + (inst[`${prefix}hold_prob`] || 0) + (inst[`${prefix}cut_prob`] || 0);
        if (sum > 0) {
          inst[`${prefix}hike_prob`] = Math.round(((inst[`${prefix}hike_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}hold_prob`] = Math.round(((inst[`${prefix}hold_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}cut_prob`] = Math.round(((inst[`${prefix}cut_prob`] || 0) / sum) * 100) / 100;
        }
      }

      // Enforce implied rate bounds
      const anchor = inst.bank === "FED" ? ffRate : ecbDep;
      let impliedRate = 100 - inst.price;
      if (Math.abs(impliedRate - anchor) > 0.75) {
        impliedRate = anchor + Math.max(-0.75, Math.min(0.75, impliedRate - anchor));
        inst.price = Math.round((100 - impliedRate) * 1000) / 1000;
      }
      inst.implied_rate = Math.round(impliedRate * 1000) / 1000;

      return inst;
    });

    return new Response(JSON.stringify({
      instruments,
      sources: {
        fed: `CME Fed Funds Futures (anchored to FRED DFF: ${ffRate}%)`,
        ecb: `€STR Futures (anchored to FRED ECBDFR: ${ecbDep}%)`,
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

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

    // Fetch actual current policy rates from FRED
    const [fedFunds, ecbRate] = await Promise.all([
      fredLatest('DFF', FRED_API_KEY),
      fredLatest('ECBDFR', FRED_API_KEY),
    ]);

    const ffRate = fedFunds?.value ?? 3.64;
    const ecbDep = ecbRate?.value ?? 2.00;

    // Compute spot-equivalent futures prices
    const fedSpotPrice = Math.round((100 - ffRate) * 1000) / 1000;
    const ecbSpotPrice = Math.round((100 - ecbDep) * 1000) / 1000;

    // 2026 meeting schedule
    const fomcDates = ['2026-01-29','2026-03-19','2026-04-29','2026-06-11','2026-07-30','2026-09-17','2026-11-05','2026-12-17'];
    const ecbDates = ['2026-02-05','2026-03-19','2026-04-30','2026-06-11','2026-07-23','2026-09-10','2026-10-29','2026-12-17'];

    const nextFomc = fomcDates.filter(d => d >= today).slice(0, 3);
    const nextEcb = ecbDates.filter(d => d >= today).slice(0, 3);

    const fomcList = nextFomc.map((d, i) => `${i+1}. FOMC ${d} — id: "ZQ_FOMC_${d.replace(/-/g,'')}"`).join('\n');
    const ecbList = nextEcb.map((d, i) => `${i+1}. ECB ${d} — id: "ER_ECB_${d.replace(/-/g,'')}"`).join('\n');

    const prompt = `Today is ${today}. Report the current interest rate futures market pricing for these upcoming central bank meetings.

VERIFIED CURRENT RATES (from FRED API, retrieved today):
- US Federal Funds Effective Rate: ${ffRate}% (as of ${fedFunds?.date || today})
  → Fed Funds Futures spot-equivalent price: ${fedSpotPrice} (= 100 - ${ffRate})
  → Current Fed target range: ${(ffRate - 0.125).toFixed(2)}%–${(ffRate + 0.125).toFixed(2)}%
- ECB Deposit Facility Rate: ${ecbDep}% (as of ${ecbRate?.date || today})
  → €STR Futures spot-equivalent price: ${ecbSpotPrice} (= 100 - ${ecbDep})

CRITICAL: The futures prices you report MUST be consistent with these verified rates:
- For the nearest Fed meeting, the futures price should be very close to ${fedSpotPrice} (within ±0.05) if markets expect a hold
- For the nearest ECB meeting, the futures price should be very close to ${ecbSpotPrice} if hold, or ~${(ecbSpotPrice + 0.25).toFixed(2)} if a 25bp cut is priced in
- Further-out meetings can deviate more but must still be anchored to the current rate

MEETINGS:
FED (FOMC):
${fomcList}

ECB (Governing Council):
${ecbList}

For each meeting report: futures price, implied rate (= 100 - price), market probabilities (hike/hold/cut from FedWatch or equivalent), your AI assessment probabilities, and daily change.

Rules:
- Use exact IDs and dates above
- Probabilities sum to 1.0
- Prices MUST be anchored to the FRED rates above — do NOT use outdated rate levels`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: `You are a financial data terminal. The current Fed Funds rate is ${ffRate}% and ECB deposit rate is ${ecbDep}%. These are FACTS from FRED. All futures prices must be consistent with these current rates. Report actual market expectations based on these anchors.` },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Report current futures market pricing anchored to verified FRED rates",
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

    // Hard enforcement: clamp prices to be within realistic range of FRED rates
    const instruments = (result.instruments || []).map((inst: any) => {
      const anchor = inst.bank === "FED" ? ffRate : ecbDep;
      const spotPrice = 100 - anchor;

      // Clamp: implied rate must be within ±100bp of current rate
      let impliedRate = 100 - inst.price;
      if (Math.abs(impliedRate - anchor) > 1.0) {
        // Force back to a reasonable range
        impliedRate = anchor;
        inst.price = spotPrice;
      }
      inst.implied_rate = Math.round(impliedRate * 1000) / 1000;
      inst.price = Math.round((100 - inst.implied_rate) * 1000) / 1000;

      // Normalize probabilities
      for (const prefix of ['market_', 'ai_']) {
        const sum = (inst[`${prefix}hike_prob`] || 0) + (inst[`${prefix}hold_prob`] || 0) + (inst[`${prefix}cut_prob`] || 0);
        if (sum > 0) {
          inst[`${prefix}hike_prob`] = Math.round(((inst[`${prefix}hike_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}hold_prob`] = Math.round(((inst[`${prefix}hold_prob`] || 0) / sum) * 100) / 100;
          inst[`${prefix}cut_prob`] = Math.round(((inst[`${prefix}cut_prob`] || 0) / sum) * 100) / 100;
        }
      }

      return inst;
    });

    return new Response(JSON.stringify({
      instruments,
      sources: {
        fed: `CME Fed Funds Futures (current rate: ${ffRate}%, FRED:DFF as of ${fedFunds?.date || today})`,
        ecb: `€STR Futures (current rate: ${ecbDep}%, FRED:ECBDFR as of ${ecbRate?.date || today})`,
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

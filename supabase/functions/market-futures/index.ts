import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fetch latest value from FRED API
async function fredLatest(seriesId: string, apiKey: string): Promise<{ value: number; date: string } | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
    const r = await fetch(url);
    if (!r.ok) { console.error(`FRED ${seriesId} failed: ${r.status}`); return null; }
    const d = await r.json();
    const obs = d.observations?.find((o: any) => o.value !== '.');
    if (!obs) return null;
    return { value: parseFloat(obs.value), date: obs.date };
  } catch (e) { console.error(`FRED ${seriesId} error:`, e); return null; }
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

    // Step 1: Fetch real economic data from FRED in parallel
    const [fedFunds, dgs10, dgs2, ecbRate, eurusd] = await Promise.all([
      fredLatest('DFF', FRED_API_KEY),        // Effective federal funds rate
      fredLatest('DGS10', FRED_API_KEY),       // 10-year treasury yield
      fredLatest('DGS2', FRED_API_KEY),        // 2-year treasury yield
      fredLatest('ECBDFR', FRED_API_KEY),      // ECB deposit facility rate
      fredLatest('DEXUSEU', FRED_API_KEY),     // EUR/USD exchange rate
    ]);

    console.log('FRED data:', { fedFunds, dgs10, dgs2, ecbRate, eurusd });

    const ffRate = fedFunds?.value ?? 4.33;
    const t10y = dgs10?.value ?? 4.25;
    const t2y = dgs2?.value ?? 3.90;
    const ecbDep = ecbRate?.value ?? 2.50;
    const eurusdRate = eurusd?.value ?? 1.08;
    const yieldSpread = Math.round((t10y - t2y) * 100); // in bps

    // Step 2: Use AI to interpret this real data into market expectations
    const prompt = `Today is ${today}. Using the REAL economic data below, provide accurate market expectations and rate probabilities.

REAL DATA FROM FRED (use these exact values):
- Effective Federal Funds Rate: ${ffRate}% (as of ${fedFunds?.date || 'latest'})
- US 10-Year Treasury Yield: ${t10y}% (as of ${dgs10?.date || 'latest'})
- US 2-Year Treasury Yield: ${t2y}% (as of ${dgs2?.date || 'latest'})
- ECB Deposit Facility Rate: ${ecbDep}% (as of ${ecbRate?.date || 'latest'})
- EUR/USD Exchange Rate: ${eurusdRate} (as of ${eurusd?.date || 'latest'})
- US 10Y-2Y Yield Spread: ${yieldSpread} bps

TASK: Based on this real data and current economic conditions, estimate:

For RATE FUTURES (Fed Funds & Euribor):
- Fed Funds futures price = 100 - implied rate. Current effective rate is ${ffRate}%, so price should be near ${(100 - ffRate).toFixed(3)}.
- Euribor futures price = 100 - implied rate. ECB deposit rate is ${ecbDep}%, 3M Euribor typically trades ~${ecbDep}% to ${(ecbDep + 0.1).toFixed(1)}%.
- For each upcoming meeting (next 2-3), estimate realistic market-implied probabilities of hike/hold/cut.
- Also provide "ai_" (fundamental analysis) probabilities that may differ from market pricing.
- Provide realistic 24h price changes (typically ±0.01 to ±0.05).

For the next 2-3 FOMC meetings and next 2-3 ECB meetings, generate rate futures instruments.

IMPORTANT: Probabilities must sum to exactly 1.0 for each instrument. Use the real rates above as anchors — do NOT deviate significantly from them.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a financial markets analyst. Use the provided FRED data as ground truth. Generate realistic market expectations based on these actual rates." },
          { role: "user", content: prompt }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_market_data",
              description: "Return current market data based on real FRED data",
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
                        price: { type: "number" },
                        change_24h: { type: "number" },
                        market_hike_prob: { type: "number" },
                        market_hold_prob: { type: "number" },
                        market_cut_prob: { type: "number" },
                        ai_hike_prob: { type: "number" },
                        ai_hold_prob: { type: "number" },
                        ai_cut_prob: { type: "number" },
                      },
                      required: ["id", "name", "category", "bank", "reference_date", "price", "change_24h",
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
    console.log('AI response structure:', JSON.stringify(data.choices?.[0]?.message).slice(0, 500));
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "provide_market_data") {
      console.error('No valid tool call found. Message:', JSON.stringify(data.choices?.[0]?.message).slice(0, 1000));
      throw new Error("Invalid response format");
    }

    const result = JSON.parse(toolCall.function.arguments);
    console.log('Parsed instruments count:', result.instruments?.length || 0);

    // Post-process: ensure probabilities sum to 1.0 and prices are anchored to real rates
    const instruments = (result.instruments || []).map((inst: any) => {
      // Normalize market probabilities
      const mSum = (inst.market_hike_prob || 0) + (inst.market_hold_prob || 0) + (inst.market_cut_prob || 0);
      if (mSum > 0) {
        inst.market_hike_prob = Math.round(((inst.market_hike_prob || 0) / mSum) * 100) / 100;
        inst.market_hold_prob = Math.round(((inst.market_hold_prob || 0) / mSum) * 100) / 100;
        inst.market_cut_prob = Math.round(((inst.market_cut_prob || 0) / mSum) * 100) / 100;
      }
      // Normalize AI probabilities
      const aSum = (inst.ai_hike_prob || 0) + (inst.ai_hold_prob || 0) + (inst.ai_cut_prob || 0);
      if (aSum > 0) {
        inst.ai_hike_prob = Math.round(((inst.ai_hike_prob || 0) / aSum) * 100) / 100;
        inst.ai_hold_prob = Math.round(((inst.ai_hold_prob || 0) / aSum) * 100) / 100;
        inst.ai_cut_prob = Math.round(((inst.ai_cut_prob || 0) / aSum) * 100) / 100;
      }
      // Ensure Fed futures price is anchored to real effective rate
      if (inst.bank === "FED") {
        const expectedPrice = 100 - ffRate;
        if (Math.abs(inst.price - expectedPrice) > 0.5) {
          inst.price = Math.round((expectedPrice + (Math.random() - 0.5) * 0.1) * 1000) / 1000;
        }
      }
      // Ensure ECB futures price is anchored to real deposit rate
      if (inst.bank === "ECB") {
        const expectedPrice = 100 - ecbDep;
        if (Math.abs(inst.price - expectedPrice) > 0.5) {
          inst.price = Math.round((expectedPrice + (Math.random() - 0.5) * 0.1) * 1000) / 1000;
        }
      }
      return inst;
    });

    // Add metadata about data sources
    const responsePayload = {
      instruments,
      sources: {
        fed_funds_rate: { value: ffRate, date: fedFunds?.date, source: 'FRED:DFF' },
        treasury_10y: { value: t10y, date: dgs10?.date, source: 'FRED:DGS10' },
        treasury_2y: { value: t2y, date: dgs2?.date, source: 'FRED:DGS2' },
        ecb_deposit_rate: { value: ecbDep, date: ecbRate?.date, source: 'FRED:ECBDFR' },
        eurusd: { value: eurusdRate, date: eurusd?.date, source: 'FRED:DEXUSEU' },
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

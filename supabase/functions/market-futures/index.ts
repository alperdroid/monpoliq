import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEETINGS_2026 } from "../_shared/scoring-weights.ts";
import { claudeToolCall, ClaudeUnavailable, unavailableBody } from "../_shared/claude.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CACHE_HOURS = 4;   // each refresh spends web searches; market pricing is quoted a few times a day

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

const prob = { type: ["number", "null"] };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const FRED_API_KEY = Deno.env.get("FRED_API_KEY");
    if (!FRED_API_KEY) throw new Error("FRED_API_KEY is not configured");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cacheKey = `${today}:${Math.floor(now.getUTCHours() / CACHE_HOURS)}`;
    const force = (() => { try { return new URL(req.url).searchParams.get("force") === "1"; } catch { return false; } })();
    if (!force) {
      const { data: hit } = await sb.from("analysis_cache").select("result")
        .eq("analysis_type", "market-futures").eq("bank", "ALL").eq("data_hash", cacheKey).maybeSingle();
      if (hit?.result) return new Response(JSON.stringify(hit.result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Current policy rates from FRED
    const [fedFunds, ecbRate] = await Promise.all([
      fredLatest('DFF', FRED_API_KEY),
      fredLatest('ECBDFR', FRED_API_KEY),
    ]);
    if (!fedFunds || !ecbRate) throw new Error("FRED policy rates unavailable");
    const ffRate = fedFunds.value;
    const ecbDep = ecbRate.value;

    // Next meetings from the verified decision calendar (_shared/scoring-weights.ts)
    const nextFomc = (MEETINGS_2026.FED || []).filter(d => d >= today).slice(0, 3);
    const nextEcb = (MEETINGS_2026.ECB || []).filter(d => d >= today).slice(0, 3);
    const fomcList = nextFomc.map((d, i) => `${i + 1}. FOMC ${d} — id: "ZQ_FOMC_${d.replace(/-/g, '')}"`).join('\n');
    const ecbList = nextEcb.map((d, i) => `${i + 1}. ECB ${d} — id: "ER_ECB_${d.replace(/-/g, '')}"`).join('\n');

    const prompt = `Today is ${today}. Find the CURRENT market pricing of these upcoming central bank decisions.

Current policy rates (FRED, verified):
- Fed funds effective rate ${ffRate}% (as of ${fedFunds.date})
- ECB deposit facility rate ${ecbDep}% (as of ${ecbRate.date})

MEETINGS:
FED (FOMC):
${fomcList || "(none scheduled)"}

ECB (Governing Council):
${ecbList || "(none scheduled)"}

Use web search to find published market-implied probabilities from the last few days: CME FedWatch for the Fed;
€STR / ECB OIS pricing as reported by Reuters, Bloomberg, the FT or bank research for the ECB.

For each meeting report:
- market_hike_prob / market_hold_prob / market_cut_prob: ONLY figures you found in a source dated within the last 7 days.
  If you cannot find one for a meeting, use null for all three. Never estimate or recall them from memory.
- implied_rate: the market-implied policy rate after that meeting if published; otherwise the current rate.
- change_24h: change in the implied rate over the last day if published, otherwise null.
- ai_hike_prob / ai_hold_prob / ai_cut_prob: your own assessment (always filled).
- source_note: where the market figures come from (publisher and date), or "not found".
Probabilities are 0-1 and each set of three sums to 1. Use the exact ids and dates above.`;

    const { input, sources } = await claudeToolCall<{ instruments: any[] }>({
      system: "You are a rates-market analyst. You report market pricing only from sources you have read; when a figure is not published, you say so (null) instead of estimating it.",
      user: prompt,
      webSearches: 6,
      tool: {
        name: "provide_market_data",
        description: "Report market pricing of the upcoming Fed and ECB decisions, with nulls where no published figure was found",
        input_schema: {
          type: "object",
          properties: {
            instruments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  bank: { type: "string", enum: ["FED", "ECB"] },
                  reference_date: { type: "string" },
                  implied_rate: { type: "number" },
                  change_24h: prob,
                  market_hike_prob: prob,
                  market_hold_prob: prob,
                  market_cut_prob: prob,
                  ai_hike_prob: { type: "number" },
                  ai_hold_prob: { type: "number" },
                  ai_cut_prob: { type: "number" },
                  source_note: { type: "string" },
                },
                required: ["id", "name", "bank", "reference_date", "implied_rate", "change_24h",
                  "market_hike_prob", "market_hold_prob", "market_cut_prob",
                  "ai_hike_prob", "ai_hold_prob", "ai_cut_prob", "source_note"],
                additionalProperties: false,
              },
            },
          },
          required: ["instruments"],
          additionalProperties: false,
        },
      },
    });

    const instruments = (input.instruments || []).map((inst: any) => {
      const anchor = inst.bank === "FED" ? ffRate : ecbDep;
      // implied rate within ±100bp of the current rate; otherwise fall back to the current rate
      let implied = Number(inst.implied_rate);
      if (!Number.isFinite(implied) || Math.abs(implied - anchor) > 1.0) implied = anchor;
      inst.category = "rate_futures";
      inst.implied_rate = Math.round(implied * 1000) / 1000;
      inst.price = Math.round((100 - inst.implied_rate) * 1000) / 1000;

      for (const prefix of ['market_', 'ai_']) {
        const keys = ['hike', 'hold', 'cut'].map(k => `${prefix}${k}_prob`);
        if (keys.some(k => inst[k] == null)) { if (prefix === 'market_') for (const k of keys) inst[k] = null; continue; }
        const sum = keys.reduce((s, k) => s + (Number(inst[k]) || 0), 0);
        if (sum > 0) for (const k of keys) inst[k] = Math.round(((Number(inst[k]) || 0) / sum) * 100) / 100;
      }
      return inst;
    });

    const result = {
      instruments,
      sources: {
        fed: `Fed funds rate ${ffRate}% (FRED:DFF, ${fedFunds.date}); market probabilities from published pricing (see links)`,
        ecb: `ECB deposit rate ${ecbDep}% (FRED:ECBDFR, ${ecbRate.date}); market probabilities from published pricing (see links)`,
      },
      web_sources: sources.filter((s, i, a) => a.findIndex(x => x.url === s.url) === i),
      generated_at: new Date().toISOString(),
    };

    await sb.from("analysis_cache").upsert({
      analysis_type: "market-futures", bank: "ALL", data_hash: cacheKey, result,
    }, { onConflict: "analysis_type,bank,data_hash" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    if (error instanceof ClaudeUnavailable) {
      return new Response(unavailableBody(error), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.error("Market data error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

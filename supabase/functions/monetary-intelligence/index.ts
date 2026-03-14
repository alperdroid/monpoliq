import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // ── 1. Gather sentiment data from DB ──
    const cutoff90 = new Date();
    cutoff90.setDate(cutoff90.getDate() - 90);
    const cutoff30 = new Date();
    cutoff30.setDate(cutoff30.getDate() - 30);

    const [commsRes, statsRes, scoresRes] = await Promise.all([
      sb.from("sentiment_items")
        .select("bank, source, title, item_date, net_score, label, reasons, hawk_pts, dove_pts")
        .eq("is_statistical", false)
        .gte("item_date", cutoff90.toISOString().split("T")[0])
        .order("item_date", { ascending: false })
        .limit(200),
      sb.from("sentiment_items")
        .select("bank, source, title, item_date, net_score, label, stat_metric, stat_value, stat_weight")
        .eq("is_statistical", true)
        .gte("item_date", cutoff90.toISOString().split("T")[0])
        .order("item_date", { ascending: false })
        .limit(200),
      sb.from("sentiment_scores")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(2),
    ]);

    const comms = (commsRes.data || []).filter((i: any) => Math.abs(i.net_score) > 0.001);
    const stats = statsRes.data || [];
    const scores = scoresRes.data || [];

    // ── 2. Compute data hash for caching ──
    // Hash = count of items + latest item date + scores + geopolitical date suffix for daily updates
    const latestCommDate = comms.length ? comms[0].item_date : "none";
    const latestStatDate = stats.length ? stats[0].item_date : "none";
    const scoreHash = scores.map((s: any) => `${s.bank}:${s.score_1_avg}:${s.score_2_avg}`).join("|");
    const geoPoliticalSuffix = `geo:${new Date().toISOString().split("T")[0]}`;
    const dataHash = `${comms.length}|${stats.length}|${latestCommDate}|${latestStatDate}|${scoreHash}|${geoPoliticalSuffix}`;

    // Check cache: return if same data hash AND less than 12h old (reduced for geopolitical events)
    const { data: cached } = await sb.from("prediction_cache")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (cached && cached.length > 0) {
      const cacheAge = Date.now() - new Date(cached[0].created_at).getTime();
      const TWELVE_HOURS = 12 * 60 * 60 * 1000; // Reduced from 24h for faster geopolitical updates
      if (cached[0].data_hash === dataHash && cacheAge < TWELVE_HOURS) {
        console.log("Returning cached prediction (same data, < 12h old)");
        return new Response(JSON.stringify(cached[0].predictions), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Separate by bank
    const fedComms = comms.filter((i: any) => i.bank === "FED");
    const ecbComms = comms.filter((i: any) => i.bank === "ECB");
    const fedStats = stats.filter((i: any) => i.bank === "FED");
    const ecbStats = stats.filter((i: any) => i.bank === "ECB");

    // 30-day averages
    const c30 = cutoff30.toISOString().split("T")[0];
    const avg = (arr: any[]) => {
      const f = arr.filter((i: any) => i.item_date >= c30 && Math.abs(i.net_score) > 0.001);
      if (!f.length) return null;
      return Math.round((f.reduce((s: number, i: any) => s + i.net_score, 0) / f.length) * 1000) / 1000;
    };

    const fedScore = scores.find((s: any) => s.bank === "FED");
    const ecbScore = scores.find((s: any) => s.bank === "ECB");

    // ── 3. Build AI prompt ──
    const summarizeItems = (items: any[], limit = 15) =>
      items.slice(0, limit).map((i: any) =>
        `- [${i.item_date}] "${i.title}" → score: ${i.net_score}, label: ${i.label}${i.stat_metric ? `, metric: ${i.stat_metric}=${i.stat_value}` : ""}`
      ).join("\n");

    const systemPrompt = `You are a senior monetary policy analyst. You analyze central bank communications, economic statistics, market expectations, and geopolitical risks to predict the next policy decision. Do not mention any AI model names in your reasoning.

CRITICAL EUR/USD LOGIC — you MUST follow this:
- EUR/USD = how many USD per 1 EUR
- Compare ACTUAL SENTIMENT SCORES, not just decisions
- If Fed sentiment score is MORE NEGATIVE (more dovish) than ECB → USD weakens → EUR/USD is BULLISH
- If ECB sentiment score is MORE NEGATIVE (more dovish) than Fed → EUR weakens → EUR/USD is BEARISH
- The direction MUST be consistent with the sentiment differential. More dovish = currency weakens.
- "Bullish EUR/USD" means EUR strengthening vs USD. "Bearish EUR/USD" means EUR weakening vs USD.

MARKET EXPECTATIONS & GEOPOLITICAL RISKS:
- Consider current market pricing and positioning when making predictions
- If significant geopolitical tensions emerge (wars, trade conflicts, sanctions, Middle East instability) that cannot be captured by historical data, adjust predictions accordingly and mention this risk explicitly
- For abrupt geopolitical changes, override data-based predictions if the external shock is material
- ALWAYS mention Middle East tensions alongside other geopolitical factors when discussing geopolitical risks
- For Fed and ECB decisions: include ONE sentence about relevant geopolitical factors affecting policy
- For EUR/USD: include ONE sentence about geopolitical effects on the currency pair
- For US 10Y Treasury: include ONE sentence about either geopolitical risk or fiscal policy effects

PREDICTION STABILITY:
- Only generate new predictions if data has changed or significant external events warrant it
- Maintain consistency with underlying sentiment scores unless external shocks override

You MUST respond with ONLY a valid JSON object (no markdown, no explanation) matching this exact schema:
{
  "fed": {
    "next_decision": "hike" | "hold" | "cut",
    "hike_probability": 0.0-1.0,
    "hold_probability": 0.0-1.0,
    "cut_probability": 0.0-1.0,
    "confidence": 0.0-1.0,
    "reasoning": "2-3 sentences including one on geopolitical factors"
  },
  "ecb": {
    "next_decision": "hike" | "hold" | "cut",
    "hike_probability": 0.0-1.0,
    "hold_probability": 0.0-1.0,
    "cut_probability": 0.0-1.0,
    "confidence": 0.0-1.0,
    "reasoning": "2-3 sentences including one on geopolitical factors"
  },
  "eurusd": {
    "direction": "bullish" | "bearish" | "neutral",
    "signal_strength": 0.0-1.0,
    "confidence": 0.0-1.0,
    "reasoning": "2-3 sentences. MUST be logically consistent with sentiment scores. Include one sentence on geopolitical effects."
  },
  "us10y": {
    "direction": "bullish" | "bearish" | "neutral",
    "yield_bias": "higher" | "lower" | "stable",
    "signal_strength": 0.0-1.0,
    "confidence": 0.0-1.0,
    "reasoning": "2-3 sentences on monetary policy outlook and inflation expectations. Include one sentence on geopolitical risk OR fiscal policy impact."
  }
}

Probabilities for each bank MUST sum to 1.0. Base your analysis on:
1. Communication sentiment scores (negative = dovish, positive = hawkish)
2. Statistical/economic data trends
3. Sentiment score differential logic for EUR/USD (more dovish sentiment = currency weakens)
4. Market expectations and positioning
5. Geopolitical risk assessment`;

    const userPrompt = `Analyze the following data and predict the next Fed and ECB decisions:

## FED SENTIMENT (30-day avg: ${avg(fedComms) ?? "N/A"})
### Recent Communications (${fedComms.length} items, 90d):
${summarizeItems(fedComms)}

### Recent Economic Data:
${summarizeItems(fedStats)}

${fedScore ? `### Algorithm Scores: Score2 avg=${fedScore.score_2_avg}, label=${fedScore.score_2_label}, count=${fedScore.score_2_count}` : ""}

## ECB SENTIMENT (30-day avg: ${avg(ecbComms) ?? "N/A"})
### Recent Communications (${ecbComms.length} items, 90d):
${summarizeItems(ecbComms)}

### Recent Economic Data:
${summarizeItems(ecbStats)}

${ecbScore ? `### Algorithm Scores: Score2 avg=${ecbScore.score_2_avg}, label=${ecbScore.score_2_label}, count=${ecbScore.score_2_count}` : ""}

## CRITICAL SENTIMENT COMPARISON FOR EUR/USD LOGIC:
Fed 30-day sentiment: ${avg(fedComms) ?? "N/A"}
ECB 30-day sentiment: ${avg(ecbComms) ?? "N/A"}

MANDATORY CONSISTENCY RULE:
- Fed sentiment (${avg(fedComms) ?? "N/A"}) vs ECB sentiment (${avg(ecbComms) ?? "N/A"})
- MORE NEGATIVE score = MORE DOVISH = currency WEAKENS
- If Fed more dovish (more negative) → USD weakens → EUR/USD direction MUST be "bullish"
- If ECB more dovish (more negative) → EUR weakens → EUR/USD direction MUST be "bearish"
- The EUR/USD direction MUST be mathematically consistent with the sentiment differential above.

Current date: ${new Date().toISOString().split("T")[0]}
Consider current market expectations, geopolitical tensions, and any emerging risks that may override historical data patterns.`;

    // ── 4. Call Lovable AI (Gemini) ──
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error:", aiResp.status, errText);
      // On error, return cached prediction if available
      if (cached && cached.length > 0) {
        console.log("AI error, returning stale cached prediction");
        return new Response(JSON.stringify(cached[0].predictions), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    let content = aiData.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    let prediction;
    try {
      prediction = JSON.parse(content);
    } catch {
      console.error("Failed to parse AI response:", content);
      // Return cached on parse error
      if (cached && cached.length > 0) {
        return new Response(JSON.stringify(cached[0].predictions), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI returned invalid JSON");
    }

    // Validate and normalize probabilities
    for (const bank of ["fed", "ecb"]) {
      const p = prediction[bank];
      if (!p) throw new Error(`Missing ${bank} prediction`);
      const sum = (p.hike_probability || 0) + (p.hold_probability || 0) + (p.cut_probability || 0);
      if (sum > 0 && Math.abs(sum - 1) > 0.05) {
        p.hike_probability = (p.hike_probability || 0) / sum;
        p.hold_probability = (p.hold_probability || 0) / sum;
        p.cut_probability = (p.cut_probability || 0) / sum;
      }
    }

    // ── 5. Post-hoc consistency check for EUR/USD based on sentiment scores ──
    const fedSentiment = avg(fedComms) ?? 0;
    const ecbSentiment = avg(ecbComms) ?? 0;
    
    // More negative = more dovish = currency weakens
    if (fedSentiment < ecbSentiment) {
      // Fed more dovish → USD weakens → EUR/USD must be bullish
      if (prediction.eurusd?.direction === "bearish") {
        console.log(`Correcting EUR/USD: Fed more dovish (${fedSentiment}) than ECB (${ecbSentiment}) → forcing bullish`);
        prediction.eurusd.direction = "bullish";
        prediction.eurusd.reasoning = `Fed sentiment significantly more dovish (${fedSentiment}) than ECB (${ecbSentiment}), indicating USD weakness relative to EUR. ${prediction.eurusd.reasoning.split('. ').slice(1).join('. ')}`;
      }
    } else if (ecbSentiment < fedSentiment) {
      // ECB more dovish → EUR weakens → EUR/USD must be bearish
      if (prediction.eurusd?.direction === "bullish") {
        console.log(`Correcting EUR/USD: ECB more dovish (${ecbSentiment}) than Fed (${fedSentiment}) → forcing bearish`);
        prediction.eurusd.direction = "bearish";
        prediction.eurusd.reasoning = `ECB sentiment more dovish (${ecbSentiment}) than Fed (${fedSentiment}), indicating EUR weakness relative to USD. ${prediction.eurusd.reasoning.split('. ').slice(1).join('. ')}`;
      }
    }

    // Add metadata
    prediction.generated_at = new Date().toISOString();
    prediction.data_summary = {
      fed_comms_count: fedComms.length,
      ecb_comms_count: ecbComms.length,
      fed_stats_count: fedStats.length,
      ecb_stats_count: ecbStats.length,
      fed_30d_avg: avg(fedComms),
      ecb_30d_avg: avg(ecbComms),
    };

    // ── 6. Cache the prediction ──
    await sb.from("prediction_cache").insert({
      predictions: prediction,
      data_hash: dataHash,
    });
    console.log("Prediction cached with hash:", dataHash);

    return new Response(JSON.stringify(prediction), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("monetary-intelligence error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

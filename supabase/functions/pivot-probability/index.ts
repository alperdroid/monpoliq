import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Fetch recent comms (90 days) for both banks
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data: items } = await sb
      .from("sentiment_items")
      .select("bank, title, item_date, net_score, label, is_statistical, policy_dimensions, reasons")
      .gte("item_date", cutoffStr)
      .eq("is_statistical", false)
      .order("item_date", { ascending: false });

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: "No data" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compute data hash for caching
    const hashInput = items.map(i => `${i.bank}:${i.item_date}:${i.net_score}`).join("|");
    const hashBytes = new TextEncoder().encode(hashInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", hashBytes);
    const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    // Check cache
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("result")
      .eq("analysis_type", "pivot_probability")
      .eq("data_hash", dataHash)
      .limit(1)
      .maybeSingle();

    if (cached?.result) {
      return new Response(JSON.stringify(cached.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compute features per bank
    const computeFeatures = (bank: string) => {
      const bankItems = items.filter((i: any) => i.bank === bank);
      const recent30 = bankItems.filter((i: any) => {
        const d = new Date(); d.setDate(d.getDate() - 30);
        return i.item_date >= d.toISOString().split("T")[0];
      });
      const recent60 = bankItems.filter((i: any) => {
        const d = new Date(); d.setDate(d.getDate() - 60);
        return i.item_date >= d.toISOString().split("T")[0];
      });
      const older = recent60.filter((i: any) => !recent30.some((r: any) => r.item_date === i.item_date && r.title === i.title));

      const avg = (arr: any[]) => arr.length ? arr.reduce((s: number, i: any) => s + (i.net_score || 0), 0) / arr.length : 0;
      const avg30 = avg(recent30);
      const avgOlder = avg(older);

      // Drift slope: tone trend into meeting
      const driftSlope = avg30 - avgOlder;

      // Dispersion: standard deviation of scores
      const scores30 = recent30.map((i: any) => i.net_score || 0);
      const mean30 = avg30;
      const variance = scores30.length > 1
        ? scores30.reduce((s: number, v: number) => s + (v - mean30) ** 2, 0) / (scores30.length - 1)
        : 0;
      const dispersion = Math.sqrt(variance);

      // Guidance softening: check policy_dimensions for conditional/open-ended guidance
      let guidanceSoftening = 0;
      const withDims = recent30.filter((i: any) => i.policy_dimensions);
      for (const item of withDims) {
        const dims = item.policy_dimensions as any;
        if (dims?.forward_guidance === "conditional" || dims?.forward_guidance === "open-ended") {
          guidanceSoftening += 1;
        }
      }
      const guidanceSofteningRate = withDims.length > 0 ? guidanceSoftening / withDims.length : 0;

      // Uncertainty language: check reasons for uncertainty keywords
      let uncertaintySignals = 0;
      for (const item of recent30) {
        const reasons = (item.reasons || []) as string[];
        const text = reasons.join(" ").toLowerCase();
        if (text.includes("uncertain") || text.includes("data dependent") || text.includes("balanced risk")) {
          uncertaintySignals++;
        }
      }
      const uncertaintyRate = recent30.length > 0 ? uncertaintySignals / recent30.length : 0;

      // Label distribution shift
      const labels30 = recent30.map((i: any) => i.label);
      const hawkCount = labels30.filter((l: string) => l?.includes("hawk")).length;
      const doveCount = labels30.filter((l: string) => l?.includes("dov")).length;
      const neutralCount = labels30.filter((l: string) => l === "neutral").length;

      return {
        bank,
        avg30: Math.round(avg30 * 1000) / 1000,
        driftSlope: Math.round(driftSlope * 1000) / 1000,
        dispersion: Math.round(dispersion * 1000) / 1000,
        guidanceSofteningRate: Math.round(guidanceSofteningRate * 100) / 100,
        uncertaintyRate: Math.round(uncertaintyRate * 100) / 100,
        commsCount: recent30.length,
        labelDist: { hawk: hawkCount, dove: doveCount, neutral: neutralCount },
        recentTitles: recent30.slice(0, 8).map((i: any) => ({ title: i.title, date: i.item_date, score: i.net_score })),
      };
    };

    const fedFeatures = computeFeatures("FED");
    const ecbFeatures = computeFeatures("ECB");

    // Call AI for pivot probability assessment
    const prompt = `You are a monetary policy analyst. Given the following communication features for FED and ECB, estimate the probability of a policy PIVOT at the next meeting for each bank.

A "pivot" means: the committee changes the direction of policy (e.g., switches from cutting to holding, or from holding to hiking, or signals a significant shift in forward guidance).

FED Features:
- 30-day avg tone: ${fedFeatures.avg30} (positive = hawkish, negative = dovish)
- Drift slope (30d vs prior 30d): ${fedFeatures.driftSlope}
- Score dispersion: ${fedFeatures.dispersion}
- Guidance softening rate: ${fedFeatures.guidanceSofteningRate}
- Uncertainty language rate: ${fedFeatures.uncertaintyRate}
- Label distribution: ${JSON.stringify(fedFeatures.labelDist)}
- Recent titles: ${fedFeatures.recentTitles.map((t: any) => `${t.date}: "${t.title}" (${t.score})`).join("\n")}

ECB Features:
- 30-day avg tone: ${ecbFeatures.avg30}
- Drift slope: ${ecbFeatures.driftSlope}
- Score dispersion: ${ecbFeatures.dispersion}
- Guidance softening rate: ${ecbFeatures.guidanceSofteningRate}
- Uncertainty language rate: ${ecbFeatures.uncertaintyRate}
- Label distribution: ${JSON.stringify(ecbFeatures.labelDist)}
- Recent titles: ${ecbFeatures.recentTitles.map((t: any) => `${t.date}: "${t.title}" (${t.score})`).join("\n")}`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a quantitative monetary policy analyst." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "pivot_assessment",
            description: "Return pivot probability assessment for FED and ECB",
            parameters: {
              type: "object",
              properties: {
                fed: {
                  type: "object",
                  properties: {
                    pivot_probability: { type: "number", description: "0 to 1 probability of pivot" },
                    direction: { type: "string", enum: ["hawkish_shift", "dovish_shift", "no_change"] },
                    confidence: { type: "number", description: "0 to 1 confidence" },
                    top_drivers: { type: "array", items: { type: "string" }, description: "Top 3 drivers" },
                    summary: { type: "string", description: "One-paragraph analysis" },
                  },
                  required: ["pivot_probability", "direction", "confidence", "top_drivers", "summary"],
                },
                ecb: {
                  type: "object",
                  properties: {
                    pivot_probability: { type: "number" },
                    direction: { type: "string", enum: ["hawkish_shift", "dovish_shift", "no_change"] },
                    confidence: { type: "number" },
                    top_drivers: { type: "array", items: { type: "string" } },
                    summary: { type: "string" },
                  },
                  required: ["pivot_probability", "direction", "confidence", "top_drivers", "summary"],
                },
              },
              required: ["fed", "ecb"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "pivot_assessment" } },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status}`);
    }

    const aiData = await aiResp.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No tool call in response");

    const assessment = JSON.parse(toolCall.function.arguments);

    const result = {
      fed: { ...assessment.fed, features: fedFeatures },
      ecb: { ...assessment.ecb, features: ecbFeatures },
      generated_at: new Date().toISOString(),
    };

    // Cache result
    await sb.from("analysis_cache").upsert({
      analysis_type: "pivot_probability",
      bank: "ALL",
      data_hash: dataHash,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pivot-probability error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

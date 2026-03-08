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

    const { bank = "FED" } = await req.json().catch(() => ({}));

    // Fetch 90 days of comms
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data: items } = await sb
      .from("sentiment_items")
      .select("title, item_date, net_score, label, reasons, bank")
      .eq("bank", bank)
      .eq("is_statistical", false)
      .gte("item_date", cutoffStr)
      .order("item_date", { ascending: false })
      .limit(100);

    if (!items || items.length < 3) {
      return new Response(JSON.stringify({ contradictions: [], message: "Insufficient data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash for caching
    const hashInput = items.map((i: any) => `${i.item_date}:${i.net_score}:${i.title.slice(0, 20)}`).join("|");
    const hashBytes = new TextEncoder().encode(hashInput);
    const hashBuffer = await crypto.subtle.digest("SHA-256", hashBytes);
    const dataHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    const cacheKey = `contradiction_${bank}`;
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("result")
      .eq("analysis_type", cacheKey)
      .eq("data_hash", dataHash)
      .limit(1)
      .maybeSingle();

    if (cached?.result) {
      return new Response(JSON.stringify(cached.result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by speaker (extract from title)
    const speakerPatterns = [
      "powell", "waller", "bowman", "williams", "cook", "kugler", "jefferson",
      "lagarde", "schnabel", "cipollone", "lane", "guindos", "elderson",
    ];

    const bySpeaker: Record<string, any[]> = {};
    for (const item of items) {
      const tl = item.title.toLowerCase();
      const speaker = speakerPatterns.find(p => tl.includes(p)) || "official";
      if (!bySpeaker[speaker]) bySpeaker[speaker] = [];
      bySpeaker[speaker].push(item);
    }

    // Build prompt with speaker communication sequences
    const speakerSummaries = Object.entries(bySpeaker)
      .filter(([_, comms]) => comms.length >= 2)
      .map(([speaker, comms]) => {
        const sorted = comms.sort((a: any, b: any) => a.item_date.localeCompare(b.item_date));
        return `Speaker: ${speaker}\n${sorted.map((c: any) =>
          `  ${c.item_date}: "${c.title}" score=${c.net_score} label=${c.label} reasons=[${(c.reasons || []).slice(0, 3).join("; ")}]`
        ).join("\n")}`;
      }).join("\n\n");

    // Also get official stance (latest official decision)
    const officialItems = items.filter((i: any) => {
      const tl = i.title.toLowerCase();
      return tl.includes("decision") || tl.includes("statement") || tl.includes("minutes") || tl.includes("press conference");
    });
    const officialSummary = officialItems.slice(0, 3).map((i: any) =>
      `${i.item_date}: "${i.title}" score=${i.net_score} label=${i.label}`
    ).join("\n");

    const prompt = `Analyze the following ${bank} communications for contradictions. Look for:
1. SELF-CONTRADICTIONS: A speaker whose recent tone/stance contradicts their own earlier statements
2. OFFICIAL CONTRADICTIONS: A speaker whose tone contradicts the official committee stance
3. SOFT CONTRADICTIONS: Subtle tone shifts without explicit reversal

Official stance:
${officialSummary || "No official items found"}

Speaker communications:
${speakerSummaries}

Identify the most significant contradictions (up to 5).`;

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a monetary policy contradiction analyst." },
          { role: "user", content: prompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "report_contradictions",
            description: "Report detected contradictions",
            parameters: {
              type: "object",
              properties: {
                contradictions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      speaker: { type: "string" },
                      type: { type: "string", enum: ["self_contradiction", "official_contradiction", "soft_contradiction"] },
                      severity: { type: "string", enum: ["high", "medium", "low"] },
                      earlier_statement: { type: "string", description: "Brief description of earlier position" },
                      later_statement: { type: "string", description: "Brief description of contradicting position" },
                      earlier_date: { type: "string" },
                      later_date: { type: "string" },
                      explanation: { type: "string" },
                    },
                    required: ["speaker", "type", "severity", "earlier_statement", "later_statement", "explanation"],
                  },
                },
                summary: { type: "string", description: "Overall coherence assessment" },
              },
              required: ["contradictions", "summary"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "report_contradictions" } },
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

    const result = {
      ...JSON.parse(toolCall.function.arguments),
      bank,
      generated_at: new Date().toISOString(),
    };

    // Cache
    await sb.from("analysis_cache").upsert({
      analysis_type: cacheKey,
      bank,
      data_hash: dataHash,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("contradiction-detector error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

    const { messages } = await req.json();
    if (!messages?.length) {
      return new Response(JSON.stringify({ error: "No messages" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch recent data for RAG context
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const [commsRes, scoresRes] = await Promise.all([
      sb.from("sentiment_items")
        .select("bank, title, item_date, net_score, label, reasons, source, is_statistical, stat_metric, stat_value")
        .gte("item_date", cutoffStr)
        .order("item_date", { ascending: false })
        .limit(200),
      sb.from("sentiment_scores")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(2),
    ]);

    const items = commsRes.data || [];
    const scores = scoresRes.data || [];

    // Build RAG context with citations
    const commsByBank: Record<string, any[]> = { FED: [], ECB: [] };
    for (const item of items) {
      if (commsByBank[item.bank]) commsByBank[item.bank].push(item);
    }

    const buildContext = (bank: string) => {
      const bankItems = commsByBank[bank] || [];
      const comms = bankItems.filter((i: any) => !i.is_statistical).slice(0, 30);
      const stats = bankItems.filter((i: any) => i.is_statistical).slice(0, 15);
      
      const commsText = comms.map((i: any, idx: number) =>
        `[C${idx + 1}] ${i.item_date} | ${i.source} | "${i.title}" | score=${i.net_score} | label=${i.label}${i.reasons?.length ? ` | reasons: ${i.reasons.slice(0, 3).join("; ")}` : ""}`
      ).join("\n");

      const statsText = stats.map((i: any, idx: number) =>
        `[S${idx + 1}] ${i.item_date} | ${i.stat_metric}: ${i.stat_value} | weight=${i.net_score}`
      ).join("\n");

      const score = scores.find((s: any) => s.bank === bank);
      const scoreText = score
        ? `Aggregate score: ${score.score_1_avg} (${score.score_1_label}), count=${score.score_1_count}`
        : "No aggregate score available";

      return `=== ${bank} DATA ===\n${scoreText}\n\nCommunications (most recent first):\n${commsText}\n\nStatistical data:\n${statsText}`;
    };

    const ragContext = `${buildContext("FED")}\n\n${buildContext("ECB")}`;

    const systemPrompt = `You are a senior monetary policy analyst at a research institution. You have access to a database of central bank communications and economic data.

CRITICAL RULE: When referencing specific data, ALWAYS cite using the [C#] or [S#] reference numbers from the context below. This builds trust.

When answering questions:
1. Be precise and analytical — use numbers, dates, scores
2. Reference specific communications by their citation IDs
3. Compare current vs. historical patterns
4. Note uncertainty and caveats
5. Structure your response with clear sections
6. If the user asks "why" a score changed, trace it to specific communications

DATA CONTEXT (cite these):
${ragContext}`;

    // Stream the response
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI error:", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI error: ${aiResp.status}`);
    }

    return new Response(aiResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("policy-copilot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

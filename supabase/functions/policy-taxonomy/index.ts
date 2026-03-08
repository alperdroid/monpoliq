import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DIMENSIONS = {
  reaction_function: ["inflation_priority", "growth_priority", "financial_stability_priority"],
  forward_guidance: ["firm", "conditional", "open_ended"],
  risk_balance: ["upside_inflation", "downside_growth", "balanced"],
  terminal_rate: ["restrictive_enough", "more_to_do", "neutral_framing"],
  time_horizon: ["near_term", "medium_term", "mixed"],
  balance_sheet: ["qt_continuing", "qt_slowing", "reinvestment_change", "not_discussed"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch non-statistical comms that haven't been taxonomy-classified yet
    const { data: items, error } = await sb
      .from("sentiment_items")
      .select("id, bank, title, source, reasons, label, net_score")
      .eq("is_statistical", false)
      .is("policy_dimensions", null)
      .order("item_date", { ascending: false })
      .limit(150);

    if (error) throw new Error(error.message);
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ classified: 0, message: "No unclassified items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const BATCH_SIZE = 8;
    let totalClassified = 0;

    const dimensionSpec = Object.entries(DIMENSIONS)
      .map(([dim, vals]) => `- ${dim}: ${vals.join(" | ")}`)
      .join("\n");

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      const itemList = batch.map((item: any, idx: number) =>
        `${idx + 1}. [${item.bank}] "${item.title}" (score: ${item.net_score}, label: ${item.label})${item.reasons?.length ? ` — reasons: ${item.reasons.slice(0, 4).join('; ')}` : ''}`
      ).join("\n");

      const systemPrompt = `You are a monetary policy communication classifier. For each item, classify it along these 6 orthogonal policy dimensions:

${dimensionSpec}

Rules:
- Pick exactly ONE value per dimension for each item
- For items that are purely administrative/ceremonial with no policy content, use: reaction_function=null, forward_guidance=null, risk_balance=null, terminal_rate=null, time_horizon=null, balance_sheet=null
- Use "not_discussed" for balance_sheet when the item doesn't mention QE/QT/balance sheet
- Base classification on the REASONS and TITLE — these reflect the actual policy content
- Respond with ONLY a JSON array of objects, one per item, each with keys matching dimension names`;

      const userPrompt = `Classify these ${batch.length} monetary policy communications:\n\n${itemList}`;

      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!aiResp.ok) {
        console.error("AI error:", aiResp.status, await aiResp.text());
        if (aiResp.status === 429) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        continue;
      }

      const aiData = await aiResp.json();
      let content = aiData.choices?.[0]?.message?.content || "";
      content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

      let classifications: any[];
      try {
        classifications = JSON.parse(content);
      } catch {
        console.error("Failed to parse taxonomy:", content);
        continue;
      }

      for (let j = 0; j < Math.min(batch.length, classifications.length); j++) {
        const dims = classifications[j] || {};

        // Validate each dimension value
        const validated: Record<string, string | null> = {};
        for (const [dim, allowedVals] of Object.entries(DIMENSIONS)) {
          const val = dims[dim];
          if (val === null || val === "null") {
            validated[dim] = null;
          } else if ((allowedVals as string[]).includes(val)) {
            validated[dim] = val;
          } else {
            validated[dim] = null;
          }
        }

        const { error: updateErr } = await sb
          .from("sentiment_items")
          .update({ policy_dimensions: validated })
          .eq("id", batch[j].id);

        if (updateErr) {
          console.error("Update error:", updateErr.message);
        } else {
          totalClassified++;
        }
      }

      if (i + BATCH_SIZE < items.length) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    return new Response(JSON.stringify({ classified: totalClassified, processed: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("policy-taxonomy error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

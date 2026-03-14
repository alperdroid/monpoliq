import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TOPIC_TAGS = [
  "inflation_dynamics",
  "wages_labor",
  "credit_conditions",
  "housing",
  "energy_supply",
  "fiscal_geo_risk",
  "financial_stability",
  "growth_outlook",
  "qe_qt",
  "forward_guidance",
];

/** Detect if item is a major policy document */
function isPolicyDocument(item: any): boolean {
  const src = (item.source || '').toLowerCase();
  const title = (item.title || '').toLowerCase();
  const keywords = [
    'press conf', 'minutes', 'statement', 'meeting of', 'accounts of',
    'monetary policy', 'fomc', 'ecb monetary',
  ];
  return keywords.some(k => src.includes(k) || title.includes(k));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch items where topics IS NULL (not yet processed)
    const { data: items, error } = await sb
      .from("sentiment_items")
      .select("id, bank, title, source, reasons, label, net_score, word_count, policy_dimensions")
      .eq("is_statistical", false)
      .is("topics", null)
      .order("item_date", { ascending: false })
      .limit(200);

    if (error) throw new Error(error.message);
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ tagged: 0, message: "No untagged items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const BATCH_SIZE = 8;
    let totalTagged = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);

      const itemList = batch.map((item: any, idx: number) => {
        const isPolicy = isPolicyDocument(item);
        const wordInfo = item.word_count ? ` [${item.word_count} words]` : '';
        const policyFlag = isPolicy ? ' [POLICY DOCUMENT]' : '';
        
        // Build richer context for the classifier
        let context = `${idx + 1}. [${item.bank}] "${item.title}" (score: ${item.net_score}, label: ${item.label})${wordInfo}${policyFlag}`;
        
        // Add full reasoning text
        if (item.reasons?.length) {
          context += `\n   Reasoning: ${item.reasons.join('; ')}`;
        }
        
        // Add policy dimensions if available (provides richer thematic signal)
        if (item.policy_dimensions && typeof item.policy_dimensions === 'object') {
          const dims = Object.entries(item.policy_dimensions)
            .filter(([_, v]) => v !== null && v !== undefined && v !== 0)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          if (dims) context += `\n   Policy dimensions: ${dims}`;
        }
        
        return context;
      }).join("\n\n");

      const systemPrompt = `You are a monetary policy topic classifier specializing in central bank communications analysis.

For each item, assign 1-3 topic tags from this EXACT list:
${TOPIC_TAGS.map(t => `- ${t}`).join("\n")}

CRITICAL RULES:
- Only use tags from the list above
- Assign 1-3 tags per item based on the dominant themes
- If the item is purely administrative/ceremonial (school openings, digital euro architecture, counterfeit notes), assign an empty array

IMPORTANT — POLICY DOCUMENTS:
- Items marked [POLICY DOCUMENT] are official central bank policy texts (press conferences, minutes, meeting accounts, statements)
- These ALWAYS discuss monetary policy topics — they should NEVER get an empty array
- For policy documents, assign AT LEAST 2 topics based on what central banks typically discuss:
  * Rate decisions & forward guidance → forward_guidance
  * Inflation outlook, price stability → inflation_dynamics
  * Employment, wages, labor market → wages_labor
  * GDP, economic activity, growth → growth_outlook
  * Trade policy, geopolitical risks, fiscal → fiscal_geo_risk
  * Financial conditions, credit → credit_conditions
  * Balance sheet, QE/QT → qe_qt
  * Energy, commodity prices → energy_supply
  * Housing market → housing
  * Banking stability → financial_stability
- ECB meeting accounts ("Meeting of...") and press conferences discuss multiple themes — be thorough
- FOMC minutes and press conferences similarly cover multiple topics — be thorough

Respond with ONLY a JSON array of arrays, one inner array per item, in order.`;

      const userPrompt = `Classify these ${batch.length} items:\n\n${itemList}`;

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

      let tagArrays: string[][];
      try {
        tagArrays = JSON.parse(content);
      } catch {
        console.error("Failed to parse topic tags:", content);
        continue;
      }

      // Update each item
      for (let j = 0; j < Math.min(batch.length, tagArrays.length); j++) {
        let tags = (tagArrays[j] || []).filter((t: string) => TOPIC_TAGS.includes(t));

        // Safety net: policy documents should never have empty topics
        if (tags.length === 0 && isPolicyDocument(batch[j])) {
          console.log(`Policy doc "${batch[j].title}" got empty tags — assigning defaults`);
          tags = batch[j].bank === 'ECB' 
            ? ['inflation_dynamics', 'growth_outlook']
            : ['inflation_dynamics', 'forward_guidance'];
        }

        const { error: updateErr } = await sb
          .from("sentiment_items")
          .update({ topics: tags })
          .eq("id", batch[j].id);

        if (updateErr) {
          console.error("Update error:", updateErr.message);
        } else if (tags.length > 0) {
          totalTagged++;
        }
      }

      // Rate limit between batches
      if (i + BATCH_SIZE < items.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    return new Response(JSON.stringify({ tagged: totalTagged, processed: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("topic-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { aiToolCall, AIUnavailable, unavailableBody } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { bank = "FED" } = await req.json().catch(() => ({ bank: "FED" }));

    // Find minutes/accounts items
    const titlePattern = bank === "FED" ? "%Minutes%" : "%Account%";
    const { data: minutesItems } = await sb
      .from("sentiment_items")
      .select("title, item_date, source, reasons, net_score")
      .eq("bank", bank)
      .eq("is_statistical", false)
      .ilike("title", titlePattern)
      .order("item_date", { ascending: false })
      .limit(10);

    if (!minutesItems || minutesItems.length < 2) {
      const fallback = { bank, error: "Not enough minutes/accounts found", current: null, previous: null, added: [], removed: [] };
      return new Response(JSON.stringify(fallback), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const current = minutesItems[0];
    const previous = minutesItems[1];
    const cacheType = `minutes-diff-${bank}`;
    const dataHash = `${bank}-${current.item_date}-${previous.item_date}`;

    // Use cache only when it matches the latest available minutes/accounts pair.
    const { data: cached } = await sb
      .from("analysis_cache")
      .select("*")
      .eq("analysis_type", cacheType)
      .eq("bank", bank)
      .eq("data_hash", dataHash)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      const cacheAge = Date.now() - new Date(cached.created_at).getTime();
      if (cacheAge < 24 * 60 * 60 * 1000) {
        return new Response(JSON.stringify(cached.result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Get all comms around each meeting for context
    const { data: contextItems } = await sb
      .from("sentiment_items")
      .select("title, item_date, source, reasons, net_score, topics")
      .eq("bank", bank)
      .eq("is_statistical", false)
      .gte("item_date", previous.item_date)
      .lte("item_date", current.item_date)
      .order("item_date", { ascending: false })
      .limit(50);

    const contextText = (contextItems || []).map(i =>
      `[${i.item_date}] ${i.title} (score: ${i.net_score}, topics: ${(i.topics || []).join(', ')}, reasons: ${(i.reasons || []).join('; ')})`
    ).join('\n');

    const prompt = `You are a central bank communications analyst. Analyze the evolution of policy language between two consecutive ${bank === 'FED' ? 'FOMC Minutes' : 'ECB Monetary Policy Accounts'}.

PREVIOUS (${previous.item_date}): "${previous.title}"
Score: ${previous.net_score}, Key themes: ${(previous.reasons || []).join('; ')}

CURRENT (${current.item_date}): "${current.title}"
Score: ${current.net_score}, Key themes: ${(current.reasons || []).join('; ')}

Context — all communications between these two meetings:
${contextText}

Based on this data, extract the top 30 most policy-relevant phrases/terms for EACH meeting's communication cycle, weighted by importance.
Then identify which phrases are NEW (appeared in current but not previous cycle) and which were REMOVED (appeared in previous but not current cycle).

Return a JSON object with this exact structure using the tool provided.`;

    const phraseSchema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          weight: { type: "number", description: "Importance weight 1-10" },
          category: { type: "string", enum: ["inflation", "growth", "employment", "financial_conditions", "forward_guidance", "risks", "other"] },
        },
        required: ["text", "weight", "category"],
      },
    };
    const diffSchema = {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, significance: { type: "string" } }, required: ["text", "significance"] },
    };
    let parsed: any;
    try {
      const r = await aiToolCall<any>({
        system: "You are a monetary policy language analyst specializing in central bank communications.",
        user: prompt,
        tool: {
          name: "minutes_diff",
          description: "Return minutes diff analysis with phrases for current and previous meetings, plus added/removed phrases",
          input_schema: {
            type: "object",
            properties: {
              current_phrases: phraseSchema,
              previous_phrases: phraseSchema,
              added: diffSchema,
              removed: diffSchema,
              summary: { type: "string", description: "2-3 sentence summary of the key language shifts" },
            },
            required: ["current_phrases", "previous_phrases", "added", "removed", "summary"],
          },
        },
      });
      parsed = r.input;
    } catch (e) {
      if (e instanceof AIUnavailable) {
        return new Response(unavailableBody(e), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw e;
    }

    const result = {
      bank,
      current: { date: current.item_date, title: current.title, score: current.net_score, phrases: parsed.current_phrases },
      previous: { date: previous.item_date, title: previous.title, score: previous.net_score, phrases: parsed.previous_phrases },
      added: parsed.added,
      removed: parsed.removed,
      summary: parsed.summary,
      generated_at: new Date().toISOString(),
    };

    // Cache
    await sb.from("analysis_cache").upsert({
      analysis_type: cacheType,
      bank,
      data_hash: dataHash,
      result,
    }, { onConflict: "analysis_type,bank,data_hash" }).select();

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("minutes-diff error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

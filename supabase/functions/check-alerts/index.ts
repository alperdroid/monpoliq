import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    // Get all active alert rules
    const { data: rules, error: rulesError } = await sb
      .from("alert_rules")
      .select("*")
      .eq("is_active", true);

    if (rulesError) throw rulesError;
    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ checked: 0, triggered: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get current metric values
    const { data: scores } = await sb.from("sentiment_scores").select("*");
    const { data: recentItems } = await sb
      .from("sentiment_items")
      .select("*")
      .order("item_date", { ascending: false })
      .limit(100);

    // Compute metrics
    const fedScore = scores?.find(s => s.bank === "FED");
    const ecbScore = scores?.find(s => s.bank === "ECB");

    const fed30Items = (recentItems || []).filter(i => i.bank === "FED" && !i.is_statistical);
    const ecb30Items = (recentItems || []).filter(i => i.bank === "ECB" && !i.is_statistical);

    const fedAvg = fed30Items.length > 0
      ? fed30Items.reduce((s, i) => s + (i.net_score || 0), 0) / fed30Items.length
      : 0;
    const ecbAvg = ecb30Items.length > 0
      ? ecb30Items.reduce((s, i) => s + (i.net_score || 0), 0) / ecb30Items.length
      : 0;

    const metrics: Record<string, number> = {
      "fed_score": fedAvg,
      "ecb_score": ecbAvg,
      "fed_ecb_spread": fedAvg - ecbAvg,
      "fed_comms_count": fed30Items.length,
      "ecb_comms_count": ecb30Items.length,
    };

    let triggered = 0;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    for (const rule of rules) {
      // Skip if triggered within last hour
      if (rule.last_triggered_at && rule.last_triggered_at > oneHourAgo) continue;

      const metricKey = rule.metric || `${rule.bank?.toLowerCase()}_score`;
      const currentValue = metrics[metricKey];
      if (currentValue === undefined) continue;

      let isTriggered = false;
      const threshold = rule.threshold || 0;

      switch (rule.operator) {
        case "gt": isTriggered = currentValue > threshold; break;
        case "lt": isTriggered = currentValue < threshold; break;
        case "eq": isTriggered = Math.abs(currentValue - threshold) < 0.01; break;
        case "gte": isTriggered = currentValue >= threshold; break;
        case "lte": isTriggered = currentValue <= threshold; break;
      }

      if (isTriggered) {
        const message = `Alert: ${rule.name || rule.metric} — Current value ${currentValue.toFixed(3)} ${rule.operator} ${threshold}`;

        // Insert alert history
        await sb.from("alert_history").insert({
          rule_id: rule.id,
          user_id: rule.user_id,
          current_value: currentValue,
          message,
        });

        // Update last triggered
        await sb.from("alert_rules").update({ last_triggered_at: new Date().toISOString() }).eq("id", rule.id);

        triggered++;
      }
    }

    return new Response(JSON.stringify({ checked: rules.length, triggered }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-alerts error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

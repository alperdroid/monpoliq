// Retired. This function scored Powell/Lagarde speeches with Gemini and wrote them to
// sentiment_items without an admin check. Historical speeches are now imported by the
// sentiment-analysis admin mode "backfill-history" (part "speeches"), scored by the frozen
// scorer like every other communication. Kept as a stub so a deployed copy stops writing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return new Response(
    JSON.stringify({ error: "speaker-scraper is retired: use sentiment-analysis mode backfill-history (part speeches)" }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

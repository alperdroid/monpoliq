// ── Sentiment Analysis Orchestrator ──
// Calls fed-sentiment and ecb-sentiment functions, combines results

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const bank = url.searchParams.get('bank') || 'both';
    const days = url.searchParams.get('days') || '60';
    const fetchText = url.searchParams.get('fetch_text') || 'true';
    const baseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const result: Record<string, any> = {};
    const headers = { 'Authorization': 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
    const params = '?days=' + days + '&fetch_text=' + fetchText;

    const calls: Promise<any>[] = [];
    if (bank === 'both' || bank === 'FED') {
      calls.push(
        fetch(baseUrl + '/functions/v1/fed-sentiment' + params, { headers })
          .then(r => r.json()).then(d => { result.fed = d.fed; }).catch(e => { console.error('Fed call failed:', e); })
      );
    }
    if (bank === 'both' || bank === 'ECB') {
      calls.push(
        fetch(baseUrl + '/functions/v1/ecb-sentiment' + params, { headers })
          .then(r => r.json()).then(d => { result.ecb = d.ecb; }).catch(e => { console.error('ECB call failed:', e); })
      );
    }
    await Promise.allSettled(calls);
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch(error) {
    console.error('Orchestrator error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

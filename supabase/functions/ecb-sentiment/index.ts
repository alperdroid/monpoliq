Deno.serve((_req) => {
  return new Response(JSON.stringify({ status: "placeholder", message: "Use sentiment-analysis orchestrator directly" }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});

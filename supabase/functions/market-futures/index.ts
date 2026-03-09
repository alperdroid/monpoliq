import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MarketInstrument {
  id: string;
  name: string;
  type: 'futures' | 'bonds' | 'swaps';
  bank: 'FED' | 'ECB';
  meeting_date: string;
  market_hike_prob: number;
  market_hold_prob: number;
  market_cut_prob: number;
  ai_hike_prob: number;
  ai_hold_prob: number;
  ai_cut_prob: number;
  price: number;
  change_24h: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split('T')[0];
    
    const prompt = `You are a financial data analyst. Provide current futures market data for Federal Reserve and ECB interest rate expectations.

For today (${today}), return data for these key instruments:
1. Fed Funds futures for next 2-3 upcoming FOMC meetings
2. Euribor futures for next 2-3 upcoming ECB meetings

For each instrument, provide:
- Current futures price
- Market-implied probabilities for hike/hold/cut
- Your AI assessment of probabilities based on recent central bank communications
- 24-hour price change

Format as JSON array with this structure:
{
  "id": "fed-funds-mar24",
  "name": "Fed Funds Mar 24", 
  "type": "futures",
  "bank": "FED",
  "meeting_date": "2024-03-20",
  "market_hike_prob": 0.05,
  "market_hold_prob": 0.82,
  "market_cut_prob": 0.13,
  "ai_hike_prob": 0.02,
  "ai_hold_prob": 0.75,
  "ai_cut_prob": 0.23,
  "price": 94.87,
  "change_24h": -0.02
}

Use actual market data and current meeting schedules. Ensure probabilities sum to 1.0 for both market and AI assessments.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: "You are a financial data expert with access to current futures market data. Provide accurate, up-to-date information."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "provide_futures_data",
              description: "Return current futures market data and rate expectations",
              parameters: {
                type: "object",
                properties: {
                  instruments: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        type: { type: "string", enum: ["futures", "bonds", "swaps"] },
                        bank: { type: "string", enum: ["FED", "ECB"] },
                        meeting_date: { type: "string" },
                        market_hike_prob: { type: "number", minimum: 0, maximum: 1 },
                        market_hold_prob: { type: "number", minimum: 0, maximum: 1 },
                        market_cut_prob: { type: "number", minimum: 0, maximum: 1 },
                        ai_hike_prob: { type: "number", minimum: 0, maximum: 1 },
                        ai_hold_prob: { type: "number", minimum: 0, maximum: 1 },
                        ai_cut_prob: { type: "number", minimum: 0, maximum: 1 },
                        price: { type: "number" },
                        change_24h: { type: "number" }
                      },
                      required: ["id", "name", "type", "bank", "meeting_date", "market_hike_prob", "market_hold_prob", "market_cut_prob", "ai_hike_prob", "ai_hold_prob", "ai_cut_prob", "price", "change_24h"]
                    }
                  }
                },
                required: ["instruments"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "provide_futures_data" } }
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API call failed: ${errorText}`);
    }

    const data = await response.json();
    console.log("Gemini response:", JSON.stringify(data, null, 2));

    // Extract the tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function?.name !== "provide_futures_data") {
      throw new Error("Invalid response format from Gemini");
    }

    const futuresData = JSON.parse(toolCall.function.arguments);
    
    return new Response(
      JSON.stringify(futuresData.instruments),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Market futures error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
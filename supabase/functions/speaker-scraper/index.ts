import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function safeFetch(url: string, ms = 20000): Promise<Response | null> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: ac.signal });
    clearTimeout(t);
    return r;
  } catch { return null; }
}

function extractText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function parseDate(t: string): string | null {
  if (!t || t.trim().length < 4) return null;
  try {
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    // Reject epoch (1970) and anything before 2018
    const year = d.getFullYear();
    if (year < 2018 || year > 2030) return null;
    return d.toISOString().split("T")[0];
  } catch { return null; }
}

async function scoreWithAI(title: string, text: string, bank: string, apiKey: string) {
  const truncated = text.length <= 8000 ? text : (
    text.slice(0, 4000) + "\n...[truncated]...\n" +
    text.slice(Math.floor(text.length / 2) - 1000, Math.floor(text.length / 2) + 1000) +
    "\n...[truncated]...\n" + text.slice(-2000)
  );

  const prompt = `You are a senior monetary policy analyst. Score this central bank communication on the hawkish-dovish spectrum.
Score from -1.0 (extremely dovish) to +1.0 (extremely hawkish), 0.0 being neutral.
DOVISH: rate cuts, easing, weak growth, disinflation, labor softening, downside risks, patience on tightening
HAWKISH: rate hikes, tightening, inflation persistence, strong economy, upside risks, data dependency
NEUTRAL: purely administrative, ceremonial, or non-monetary topics

IMPORTANT: Even if the speech is primarily about regulation or other topics, if it contains ANY monetary policy signals (inflation outlook, employment, rates), score those signals. Only score 0.0 if there is truly ZERO monetary policy content.

Also extract up to 5 key topics and classify the forward guidance dimension.

Respond with ONLY JSON (no markdown):
{"score": <number>, "label": "hawkish"|"dovish"|"neutral", "reasoning": "<1 sentence>", "topics": ["topic1", "topic2"], "forward_guidance": "firm"|"conditional"|"open-ended"|"none"}`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: `Bank: ${bank}\nTitle: ${title}\nContent: ${truncated}` },
        ],
      }),
    });

    if (!resp.ok) return { score: 0, label: "neutral", reasoning: "AI unavailable", topics: [], forward_guidance: "none" };

    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || "";
    content = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(content);
    const score = Math.max(-1, Math.min(1, Number(parsed.score) || 0));
    return {
      score: Math.round(score * 1000) / 1000,
      label: score > 0.05 ? "hawkish" : score < -0.05 ? "dovish" : "neutral",
      reasoning: parsed.reasoning || "",
      topics: parsed.topics || [],
      forward_guidance: parsed.forward_guidance || "none",
    };
  } catch (e) {
    console.error("AI score error:", e);
    return { score: 0, label: "neutral", reasoning: "error", topics: [], forward_guidance: "none" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const { speakers = ["powell", "lagarde"], maxItems = 50 } = await req.json().catch(() => ({}));

    // Get existing URLs to avoid duplicates
    const { data: existingItems } = await sb
      .from("sentiment_items")
      .select("url")
      .eq("is_statistical", false);
    const existingUrls = new Set((existingItems || []).map((i: any) => i.url).filter(Boolean));

    const newItems: any[] = [];
    const results: Record<string, number> = {};

    // ── POWELL: Scrape Fed yearly speech index pages ──
    // Only grab URLs that contain "powell" in the filename
    if (speakers.includes("powell")) {
      console.log("Scraping Powell speeches (URL-filtered)...");

      const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
      for (const year of years) {
        if (newItems.filter(i => i.bank === "FED").length >= maxItems) break;

        const indexUrl = `https://www.federalreserve.gov/newsevents/speech/${year}-speeches.htm`;
        console.log(`  Checking ${year}...`);
        const resp = await safeFetch(indexUrl, 10000);
        if (!resp?.ok) continue;
        const html = await resp.text();

        // ONLY match URLs with "powell" in the filename
        const linkRe = /href="(\/newsevents\/speech\/powell\d{8}[a-z]?\.htm)"/gi;
        let lm;
        const powellUrls: string[] = [];
        while ((lm = linkRe.exec(html)) !== null) {
          const fullUrl = `https://www.federalreserve.gov${lm[1]}`;
          if (!existingUrls.has(fullUrl) && !powellUrls.includes(fullUrl)) {
            powellUrls.push(fullUrl);
          }
        }

        console.log(`  ${year}: ${powellUrls.length} new Powell URLs`);

        for (const url of powellUrls) {
          if (newItems.filter(i => i.bank === "FED").length >= maxItems) break;

          const pageResp = await safeFetch(url, 15000);
          if (!pageResp?.ok) continue;
          const pageHtml = await pageResp.text();
          const text = extractText(pageHtml);

          const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          let title = titleMatch ? titleMatch[1].replace(/\s*-\s*Federal Reserve Board\s*$/i, "").trim() : "";
          if (!title) title = `Chair Powell Speech ${url.match(/(\d{8})/)?.[1] || year}`;

          const dateMatch = pageHtml.match(/(\w+ \d{1,2}, \d{4})/);
          const date = dateMatch ? parseDate(dateMatch[1]) : null;
          if (!date) continue;

          const ai = await scoreWithAI(title, text, "FED", apiKey);
          newItems.push({
            bank: "FED", source: "fed_speech", item_date: date, title,
            url, is_statistical: false,
            hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
            dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
            net_score: ai.score, label: ai.label,
            word_count: text.split(/\s+/).length,
            reasons: [ai.reasoning], stat_metric: null, stat_value: null, stat_weight: 0,
            topics: ai.topics, policy_dimensions: { forward_guidance: ai.forward_guidance },
          });
          existingUrls.add(url);
          console.log(`  ✓ ${title} (${date}) → ${ai.label} ${ai.score}`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      results.powell = newItems.filter(i => i.bank === "FED").length;
      console.log(`Total new Powell speeches: ${results.powell}`);
    }

    // ── LAGARDE: Scrape ECB key speeches pages ──
    if (speakers.includes("lagarde")) {
      console.log("Scraping Lagarde speeches...");

      const ecbCandidates: { url: string; title: string; pubDate: string }[] = [];

      // ECB key speeches pages (correct URL format)
      const ecbYears = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
      for (const year of ecbYears) {
        // ECB uses this format for speeches listing
        const indexUrl = `https://www.ecb.europa.eu/press/key/date/${year}/html/index_include.en.html`;
        console.log(`  ECB speeches ${year}...`);
        const resp = await safeFetch(indexUrl, 10000);
        if (!resp?.ok) {
          // Try alternate URL
          const altUrl = `https://www.ecb.europa.eu/press/key/${year}/html/index.en.html`;
          const altResp = await safeFetch(altUrl, 10000);
          if (!altResp?.ok) continue;
          const html = await altResp.text();
          // Parse for Lagarde links
          const sections = html.split(/(?=<dt|<div|<article)/i);
          for (const section of sections) {
            if (!section.toLowerCase().includes("lagarde")) continue;
            const hm = section.match(/href="([^"]+)"/i);
            const tm = section.match(/<a[^>]*>([^<]+)<\/a>/i);
            const dm = section.match(/(\d{1,2}\s+\w+\s+\d{4})/);
            if (hm && tm) {
              const link = hm[1].startsWith("http") ? hm[1] : `https://www.ecb.europa.eu${hm[1]}`;
              ecbCandidates.push({ url: link, title: tm[1].trim(), pubDate: dm ? dm[1] : "" });
            }
          }
          continue;
        }
        const html = await resp.text();

        // ECB include pages have a different structure
        const sections = html.split(/(?=<dt|<div|<article|<li)/i);
        for (const section of sections) {
          if (!section.toLowerCase().includes("lagarde")) continue;
          const hm = section.match(/href="([^"]+)"/i);
          const tm = section.match(/<a[^>]*>([^<]+)<\/a>/i);
          const dm = section.match(/(\d{1,2}\s+\w+\s+\d{4})/);
          if (hm && tm) {
            const link = hm[1].startsWith("http") ? hm[1] : `https://www.ecb.europa.eu${hm[1]}`;
            ecbCandidates.push({ url: link, title: tm[1].trim(), pubDate: dm ? dm[1] : "" });
          }
        }
      }

      // ECB press conferences
      for (const year of [2025, 2024, 2023, 2022, 2021, 2020]) {
        const pcUrl = `https://www.ecb.europa.eu/press/pressconf/${year}/html/index_include.en.html`;
        const pcResp = await safeFetch(pcUrl, 10000);
        if (!pcResp?.ok) continue;
        const pcHtml = await pcResp.text();
        const pcRe = /href="([^"]*\.en\.html)"/gi;
        let pm;
        while ((pm = pcRe.exec(pcHtml)) !== null) {
          const link = pm[1].startsWith("http") ? pm[1] : `https://www.ecb.europa.eu${pm[1]}`;
          ecbCandidates.push({ url: link, title: `ECB Press Conference - Lagarde`, pubDate: "" });
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      const unique = ecbCandidates.filter(i => {
        if (seen.has(i.url) || existingUrls.has(i.url)) return false;
        seen.add(i.url);
        return true;
      });

      console.log(`  ${unique.length} unique new Lagarde URLs`);

      let lagardeCount = 0;
      for (const item of unique) {
        if (lagardeCount >= maxItems) break;

        const pageResp = await safeFetch(item.url, 15000);
        if (!pageResp?.ok) continue;
        const pageHtml = await pageResp.text();
        const text = extractText(pageHtml);
        if (text.length < 200) continue; // Skip empty/error pages

        // Extract/improve title
        let title = item.title;
        if (title.startsWith("ECB Press Conference")) {
          const tm = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (tm) title = tm[1].trim();
        }

        // Extract date
        if (!item.pubDate) {
          const dm = pageHtml.match(/(\d{1,2}\s+\w+\s+\d{4})/);
          if (dm) item.pubDate = dm[1];
        }
        const date = parseDate(item.pubDate);
        if (!date) continue;

        const ai = await scoreWithAI(title, text, "ECB", apiKey);
        newItems.push({
          bank: "ECB", source: "ecb_speech", item_date: date, title,
          url: item.url, is_statistical: false,
          hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
          dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
          net_score: ai.score, label: ai.label,
          word_count: text.split(/\s+/).length,
          reasons: [ai.reasoning], stat_metric: null, stat_value: null, stat_weight: 0,
          topics: ai.topics, policy_dimensions: { forward_guidance: ai.forward_guidance },
        });
        existingUrls.add(item.url);
        lagardeCount++;
        console.log(`  ✓ ${title} (${date}) → ${ai.label} ${ai.score}`);
        await new Promise(r => setTimeout(r, 500));
      }

      results.lagarde = lagardeCount;
      console.log(`Total new Lagarde speeches: ${results.lagarde}`);
    }

    // ── Insert new items ──
    if (newItems.length > 0) {
      console.log(`Inserting ${newItems.length} new items...`);
      for (let i = 0; i < newItems.length; i += 20) {
        const batch = newItems.slice(i, i + 20);
        const { error } = await sb.from("sentiment_items").insert(batch);
        if (error) console.error("Insert error:", error.message);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      new_items: newItems.length,
      breakdown: results,
      message: `Scraped and scored ${newItems.length} new communications`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("speaker-scraper error:", e);
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

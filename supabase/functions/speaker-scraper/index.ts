import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function safeFetch(url: string, ms = 15000): Promise<Response | null> {
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
  if (!t) return null;
  try {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  } catch { return null; }
}

function cdataContent(xml: string, tag: string): string {
  const m = xml.match(new RegExp("<" + tag + "[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*</" + tag + ">", "i"));
  return m ? m[1].trim() : "";
}

function parseRSSItems(xml: string) {
  const items: { title: string; link: string; pubDate: string }[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    items.push({
      title: cdataContent(m[1], "title"),
      link: cdataContent(m[1], "link") || cdataContent(m[1], "guid"),
      pubDate: cdataContent(m[1], "pubDate"),
    });
  }
  return items;
}

async function scoreWithAI(title: string, text: string, bank: string, apiKey: string) {
  const truncated = text.length <= 6000 ? text : (
    text.slice(0, 3000) + "\n...[truncated]...\n" +
    text.slice(Math.floor(text.length / 2) - 750, Math.floor(text.length / 2) + 750) +
    "\n...[truncated]...\n" + text.slice(-1500)
  );

  const prompt = `You are a senior monetary policy analyst. Score this central bank communication on the hawkish-dovish spectrum.
Score from -1.0 (extremely dovish) to +1.0 (extremely hawkish), 0.0 being neutral.
DOVISH: rate cuts, easing, weak growth, disinflation, labor softening, downside risks
HAWKISH: rate hikes, tightening, inflation persistence, strong economy, upside risks
NEUTRAL: administrative, non-monetary topics
If NOT about monetary policy, score 0.0.

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

    // Get existing titles/urls to avoid duplicates
    const { data: existingItems } = await sb
      .from("sentiment_items")
      .select("title, url")
      .eq("is_statistical", false);
    const existingTitles = new Set((existingItems || []).map((i: any) => i.title.toLowerCase()));
    const existingUrls = new Set((existingItems || []).map((i: any) => i.url).filter(Boolean));

    const newItems: any[] = [];
    const results: Record<string, number> = {};

    // ── POWELL: Scrape Fed speeches across MULTIPLE YEARS ──
    if (speakers.includes("powell")) {
      console.log("Scraping Powell speeches across multiple years...");

      // 1) RSS feed
      const fedRSS = await safeFetch("https://www.federalreserve.gov/feeds/speeches.xml");
      if (fedRSS?.ok) {
        const xml = await fedRSS.text();
        const rssItems = parseRSSItems(xml);
        const powellItems = rssItems.filter(i =>
          i.title.toLowerCase().includes("powell") ||
          i.link.toLowerCase().includes("powell")
        );
        console.log(`RSS: ${powellItems.length} Powell items`);

        for (const item of powellItems.slice(0, maxItems)) {
          if (existingTitles.has(item.title.toLowerCase()) || existingUrls.has(item.link)) continue;
          const date = parseDate(item.pubDate);
          if (!date) continue;

          let text = "";
          const pageResp = await safeFetch(item.link, 12000);
          if (pageResp?.ok) text = extractText(await pageResp.text());

          const ai = await scoreWithAI(item.title, text || item.title, "FED", apiKey);
          newItems.push({
            bank: "FED", source: "fed_speech", item_date: date, title: item.title,
            url: item.link, is_statistical: false,
            hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
            dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
            net_score: ai.score, label: ai.label,
            word_count: (text || item.title).split(/\s+/).length,
            reasons: [ai.reasoning], stat_metric: null, stat_value: null, stat_weight: 0,
            topics: ai.topics, policy_dimensions: { forward_guidance: ai.forward_guidance },
          });
          existingTitles.add(item.title.toLowerCase());
          existingUrls.add(item.link);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      // 2) Scrape yearly speech index pages (2018-2026) for Powell
      const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
      for (const year of years) {
        if (newItems.filter(i => i.bank === "FED").length >= maxItems) break;

        const indexUrl = `https://www.federalreserve.gov/newsevents/speech/${year}-speeches.htm`;
        console.log(`Checking Fed speeches index: ${year}`);
        const resp = await safeFetch(indexUrl, 10000);
        if (!resp?.ok) continue;
        const html = await resp.text();

        // Find all speech links — the page lists all speeches, we filter for Powell
        const linkRe = /href="(\/newsevents\/speech\/[^"]+\.htm)"/gi;
        let lm;
        const speechLinks: string[] = [];
        while ((lm = linkRe.exec(html)) !== null) {
          speechLinks.push(`https://www.federalreserve.gov${lm[1]}`);
        }

        // Check each speech page for Powell's name
        for (const url of speechLinks) {
          if (newItems.filter(i => i.bank === "FED").length >= maxItems) break;
          if (existingUrls.has(url)) continue;

          const pageResp = await safeFetch(url, 12000);
          if (!pageResp?.ok) continue;
          const pageHtml = await pageResp.text();

          // Check if this is a Powell speech
          const lowerHtml = pageHtml.toLowerCase();
          if (!lowerHtml.includes("powell") && !lowerHtml.includes("chair powell") && !lowerHtml.includes("chairman powell")) continue;

          const text = extractText(pageHtml);
          const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          let title = titleMatch ? titleMatch[1].trim() : `Powell Speech ${year}`;
          // Clean up Fed title format
          title = title.replace(/\s*-\s*Federal Reserve Board\s*$/i, "").trim();
          if (!title || title.length < 5) title = `Chair Powell Speech - ${url.match(/(\d{8})/)?.[1] || year}`;

          if (existingTitles.has(title.toLowerCase())) continue;

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
          existingTitles.add(title.toLowerCase());
          existingUrls.add(url);
          console.log(`  ✓ Powell: ${title} (${date}) → ${ai.label} ${ai.score}`);
          await new Promise(r => setTimeout(r, 600));
        }
      }

      results.powell = newItems.filter(i => i.bank === "FED").length;
      console.log(`Total Powell items found: ${results.powell}`);
    }

    // ── LAGARDE: Scrape ECB speeches across multiple years ──
    if (speakers.includes("lagarde")) {
      console.log("Scraping Lagarde speeches...");

      const ecbItems: { title: string; link: string; pubDate: string }[] = [];

      // 1) ECB press key speeches index pages (multiple years)
      const ecbYears = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019];
      for (const year of ecbYears) {
        // ECB speeches listing
        const indexUrl = `https://www.ecb.europa.eu/press/key/date/${year}/html/index.en.html`;
        console.log(`Checking ECB speeches index: ${year}`);
        const resp = await safeFetch(indexUrl, 10000);
        if (!resp?.ok) continue;
        const html = await resp.text();

        // Find Lagarde speech links
        const sections = html.split(/(?=<dt|<div class="title")/i);
        for (const section of sections) {
          if (!section.toLowerCase().includes("lagarde")) continue;
          const hrefMatch = section.match(/href="([^"]+)"/i);
          const titleMatch = section.match(/<a[^>]*>([^<]+)<\/a>/i);
          const dateMatch = section.match(/(\d{1,2}\s+\w+\s+\d{4})/);

          if (hrefMatch && titleMatch) {
            const link = hrefMatch[1].startsWith("http") ? hrefMatch[1] : `https://www.ecb.europa.eu${hrefMatch[1]}`;
            ecbItems.push({
              title: titleMatch[1].trim(),
              link,
              pubDate: dateMatch ? dateMatch[1] : "",
            });
          }
        }

        // Press conferences (Lagarde is always speaker)
        const pcUrl = `https://www.ecb.europa.eu/press/pressconf/${year}/html/index.en.html`;
        const pcResp = await safeFetch(pcUrl, 10000);
        if (pcResp?.ok) {
          const pcHtml = await pcResp.text();
          const pcRe = /href="(\/press\/pressconf\/\d{4}\/html\/[^"]+)"/gi;
          let pm;
          while ((pm = pcRe.exec(pcHtml)) !== null) {
            const link = `https://www.ecb.europa.eu${pm[1]}`;
            ecbItems.push({ title: `ECB Press Conference - Lagarde ${year}`, link, pubDate: "" });
          }
        }
      }

      // 2) ECB RSS feed
      const ecbRSS = await safeFetch("https://www.ecb.europa.eu/rss/press.html");
      if (ecbRSS?.ok) {
        const xml = await ecbRSS.text();
        const rssItems = parseRSSItems(xml);
        for (const ri of rssItems) {
          if (ri.title.toLowerCase().includes("lagarde") || ri.link.toLowerCase().includes("lagarde")) {
            ecbItems.push(ri);
          }
        }
      }

      // Deduplicate by link
      const seenLinks = new Set<string>();
      const uniqueEcb = ecbItems.filter(i => {
        if (seenLinks.has(i.link)) return false;
        seenLinks.add(i.link);
        return true;
      });

      console.log(`Found ${uniqueEcb.length} unique Lagarde items to check`);

      let lagardeCount = 0;
      for (const item of uniqueEcb) {
        if (lagardeCount >= maxItems) break;
        if (existingUrls.has(item.link)) continue;

        let text = "";
        const pageResp = await safeFetch(item.link, 12000);
        if (pageResp?.ok) {
          const pageHtml = await pageResp.text();
          text = extractText(pageHtml);

          if (!item.pubDate) {
            const dateMatch = pageHtml.match(/(\d{1,2}\s+\w+\s+\d{4})/);
            if (dateMatch) item.pubDate = dateMatch[1];
          }

          if (item.title.startsWith("ECB Press Conference") || item.title.startsWith("Lagarde Press Conference")) {
            const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) item.title = titleMatch[1].trim();
          }
        }

        if (existingTitles.has(item.title.toLowerCase())) continue;

        const date = parseDate(item.pubDate);
        if (!date) continue;

        const ai = await scoreWithAI(item.title, text || item.title, "ECB", apiKey);

        newItems.push({
          bank: "ECB", source: "ecb_speech", item_date: date, title: item.title,
          url: item.link, is_statistical: false,
          hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
          dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
          net_score: ai.score, label: ai.label,
          word_count: (text || item.title).split(/\s+/).length,
          reasons: [ai.reasoning], stat_metric: null, stat_value: null, stat_weight: 0,
          topics: ai.topics, policy_dimensions: { forward_guidance: ai.forward_guidance },
        });

        existingTitles.add(item.title.toLowerCase());
        existingUrls.add(item.link);
        lagardeCount++;
        console.log(`  ✓ Lagarde: ${item.title} (${date}) → ${ai.label} ${ai.score}`);
        await new Promise(r => setTimeout(r, 600));
      }

      results.lagarde = lagardeCount;
      console.log(`Total Lagarde items found: ${results.lagarde}`);
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

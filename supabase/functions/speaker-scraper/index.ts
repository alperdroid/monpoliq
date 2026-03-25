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

// RSS XML helpers
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

// AI scoring
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

    const { speakers = ["powell", "lagarde"], maxItems = 30 } = await req.json().catch(() => ({}));

    // Get existing titles to avoid duplicates
    const { data: existingItems } = await sb
      .from("sentiment_items")
      .select("title, url")
      .eq("is_statistical", false);
    const existingTitles = new Set((existingItems || []).map((i: any) => i.title.toLowerCase()));
    const existingUrls = new Set((existingItems || []).map((i: any) => i.url).filter(Boolean));

    const newItems: any[] = [];
    const results: Record<string, number> = {};

    // ── POWELL: Scrape Fed speeches RSS ──
    if (speakers.includes("powell")) {
      console.log("Scraping Powell speeches...");

      // Fed speeches RSS
      const fedRSS = await safeFetch("https://www.federalreserve.gov/feeds/speeches.xml");
      if (fedRSS?.ok) {
        const xml = await fedRSS.text();
        const rssItems = parseRSSItems(xml);
        const powellItems = rssItems.filter(i =>
          i.title.toLowerCase().includes("powell") ||
          i.link.toLowerCase().includes("powell")
        );
        console.log(`Found ${powellItems.length} Powell items in RSS`);

        for (const item of powellItems.slice(0, maxItems)) {
          if (existingTitles.has(item.title.toLowerCase())) continue;
          if (existingUrls.has(item.link)) continue;

          const date = parseDate(item.pubDate);
          if (!date) continue;

          // Fetch full text
          let text = "";
          const pageResp = await safeFetch(item.link, 12000);
          if (pageResp?.ok) {
            const html = await pageResp.text();
            text = extractText(html);
          }

          const ai = await scoreWithAI(item.title, text || item.title, "FED", apiKey);

          newItems.push({
            bank: "FED",
            source: "fed_speech",
            item_date: date,
            title: item.title,
            url: item.link,
            is_statistical: false,
            hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
            dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
            net_score: ai.score,
            label: ai.label,
            word_count: (text || item.title).split(/\s+/).length,
            reasons: [ai.reasoning],
            stat_metric: null,
            stat_value: null,
            stat_weight: 0,
            topics: ai.topics,
            policy_dimensions: { forward_guidance: ai.forward_guidance },
          });

          existingTitles.add(item.title.toLowerCase());
          // Rate limit
          await new Promise(r => setTimeout(r, 800));
        }
      }

      // Also scrape Fed Board speeches page for historical Powell
      const fedSpeechesPage = await safeFetch("https://www.federalreserve.gov/newsevents/speeches.htm");
      if (fedSpeechesPage?.ok) {
        const html = await fedSpeechesPage.text();
        // Extract speech links mentioning Powell
        const linkRegex = /href="(\/newsevents\/speech\/powell\d+a?\.htm)"/gi;
        let linkMatch;
        const powellLinks: string[] = [];
        while ((linkMatch = linkRegex.exec(html)) !== null) {
          powellLinks.push(`https://www.federalreserve.gov${linkMatch[1]}`);
        }

        // Also find links by pattern near "Powell" text
        const speechRows = html.split(/(?=<div class="row")/i);
        for (const row of speechRows) {
          if (row.toLowerCase().includes("powell")) {
            const hrefMatch = row.match(/href="(\/newsevents\/speech\/[^"]+)"/i);
            if (hrefMatch) {
              const fullUrl = `https://www.federalreserve.gov${hrefMatch[1]}`;
              if (!powellLinks.includes(fullUrl)) powellLinks.push(fullUrl);
            }
          }
        }

        console.log(`Found ${powellLinks.length} Powell speech page links`);

        for (const url of powellLinks.slice(0, maxItems)) {
          if (existingUrls.has(url)) continue;

          const pageResp = await safeFetch(url, 12000);
          if (!pageResp?.ok) continue;
          const pageHtml = await pageResp.text();
          const text = extractText(pageHtml);

          // Extract title
          const titleMatch = pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          let title = titleMatch ? titleMatch[1].trim() : "";
          if (!title) title = `Powell Speech - ${url.match(/(\d{8})/)?.[1] || "unknown"}`;
          if (existingTitles.has(title.toLowerCase())) continue;

          // Extract date
          const dateMatch = pageHtml.match(/(\w+ \d{1,2}, \d{4})/);
          const date = dateMatch ? parseDate(dateMatch[1]) : null;
          if (!date) continue;

          const ai = await scoreWithAI(title, text, "FED", apiKey);

          newItems.push({
            bank: "FED",
            source: "fed_speech",
            item_date: date,
            title,
            url,
            is_statistical: false,
            hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
            dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
            net_score: ai.score,
            label: ai.label,
            word_count: text.split(/\s+/).length,
            reasons: [ai.reasoning],
            stat_metric: null,
            stat_value: null,
            stat_weight: 0,
            topics: ai.topics,
            policy_dimensions: { forward_guidance: ai.forward_guidance },
          });

          existingTitles.add(title.toLowerCase());
          await new Promise(r => setTimeout(r, 800));
        }
      }

      results.powell = newItems.filter(i => i.bank === "FED").length;
    }

    // ── LAGARDE: Scrape ECB speeches ──
    if (speakers.includes("lagarde")) {
      console.log("Scraping Lagarde speeches...");

      // ECB RSS feed
      const ecbRSS = await safeFetch("https://www.ecb.europa.eu/rss/press.html");
      let ecbItems: { title: string; link: string; pubDate: string }[] = [];

      if (ecbRSS?.ok) {
        const xml = await ecbRSS.text();
        ecbItems = parseRSSItems(xml);
      }

      // ECB speeches page for Lagarde
      const ecbSpeeches = await safeFetch("https://www.ecb.europa.eu/press/key/html/downloads.en.html");
      if (ecbSpeeches?.ok) {
        const html = await ecbSpeeches.text();
        // Find Lagarde speech links
        const rows = html.split(/(?=<dt)/i);
        for (const row of rows) {
          if (row.toLowerCase().includes("lagarde")) {
            const hrefMatch = row.match(/href="([^"]+)"/i);
            const dateMatch = row.match(/(\d{1,2}\s+\w+\s+\d{4})/);
            const titleMatch = row.match(/<a[^>]*>([^<]+)<\/a>/i);

            if (hrefMatch && titleMatch) {
              const link = hrefMatch[1].startsWith("http") ? hrefMatch[1] : `https://www.ecb.europa.eu${hrefMatch[1]}`;
              ecbItems.push({
                title: titleMatch[1].trim(),
                link,
                pubDate: dateMatch ? dateMatch[1] : "",
              });
            }
          }
        }
      }

      // Also try ECB press conferences search for Lagarde
      const years = [2024, 2025, 2026];
      for (const year of years) {
        const pcUrl = `https://www.ecb.europa.eu/press/pressconf/${year}/html/index.en.html`;
        const pcResp = await safeFetch(pcUrl, 10000);
        if (pcResp?.ok) {
          const html = await pcResp.text();
          const hrefRe = /href="([^"]*pressconf[^"]*lagarde[^"]*)"/gi;
          let hm;
          while ((hm = hrefRe.exec(html)) !== null) {
            const link = hm[1].startsWith("http") ? hm[1] : `https://www.ecb.europa.eu${hm[1]}`;
            ecbItems.push({ title: `Lagarde Press Conference ${year}`, link, pubDate: "" });
          }

          // Also grab general press conference links (Lagarde is always the speaker)
          const genRe = /href="(\/press\/pressconf\/\d{4}\/html\/[^"]+)"/gi;
          while ((hm = genRe.exec(html)) !== null) {
            const link = `https://www.ecb.europa.eu${hm[1]}`;
            ecbItems.push({ title: `ECB Press Conference - Lagarde`, link, pubDate: "" });
          }
        }
      }

      // Deduplicate by link
      const seenLinks = new Set<string>();
      const uniqueEcbItems = ecbItems.filter(i => {
        if (seenLinks.has(i.link)) return false;
        seenLinks.add(i.link);
        return true;
      });

      const lagardeItems = uniqueEcbItems.filter(i =>
        i.title.toLowerCase().includes("lagarde") ||
        i.link.toLowerCase().includes("lagarde") ||
        i.link.includes("pressconf")
      );

      console.log(`Found ${lagardeItems.length} Lagarde items`);

      for (const item of lagardeItems.slice(0, maxItems)) {
        if (existingUrls.has(item.link)) continue;

        let text = "";
        const pageResp = await safeFetch(item.link, 12000);
        if (pageResp?.ok) {
          const pageHtml = await pageResp.text();
          text = extractText(pageHtml);

          // Try to extract date from page if not in RSS
          if (!item.pubDate) {
            const dateMatch = pageHtml.match(/(\d{1,2}\s+\w+\s+\d{4})/);
            if (dateMatch) item.pubDate = dateMatch[1];
          }

          // Improve title from page
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
          bank: "ECB",
          source: "ecb_speech",
          item_date: date,
          title: item.title,
          url: item.link,
          is_statistical: false,
          hawk_pts: ai.score > 0 ? Math.round(ai.score * 10) : 0,
          dove_pts: ai.score < 0 ? Math.round(Math.abs(ai.score) * 10) : 0,
          net_score: ai.score,
          label: ai.label,
          word_count: (text || item.title).split(/\s+/).length,
          reasons: [ai.reasoning],
          stat_metric: null,
          stat_value: null,
          stat_weight: 0,
          topics: ai.topics,
          policy_dimensions: { forward_guidance: ai.forward_guidance },
        });

        existingTitles.add(item.title.toLowerCase());
        await new Promise(r => setTimeout(r, 800));
      }

      results.lagarde = newItems.filter(i => i.bank === "ECB").length;
    }

    // ── Insert new items ──
    if (newItems.length > 0) {
      console.log(`Inserting ${newItems.length} new items...`);
      // Insert in batches of 20
      for (let i = 0; i < newItems.length; i += 20) {
        const batch = newItems.slice(i, i + 20);
        const { error } = await sb.from("sentiment_items").insert(batch);
        if (error) console.error("Insert error:", error.message);
      }
    }

    const response = {
      success: true,
      new_items: newItems.length,
      breakdown: results,
      message: `Scraped and scored ${newItems.length} new communications`,
    };

    return new Response(JSON.stringify(response), {
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

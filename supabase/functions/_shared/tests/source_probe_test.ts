// Run: deno run --allow-read supabase/functions/_shared/tests/source_probe_test.ts
import { feedLinks, speechLinks, linkDate, dateRange, bisArchiveTargets } from '../source-probe.ts';

let pass = 0, total = 0;
const check = (name: string, ok: boolean, detail = '') => { total++; pass += +ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

const html = `<html><head>
<link rel="alternate" type="application/rss+xml" title="Speeches" href="/rss/speeches.xml">
<link rel="stylesheet" href="/main.css">
<link type="application/atom+xml" rel="alternate" href="https://www.example-fed.org/feeds/atom">
</head><body>
<a href="/news-and-events/speeches.aspx">All speeches</a>
<a href="/news-and-events/speeches/2026/outlook-for-the-economy.aspx">Outlook</a>
<a href="https://www.example-fed.org/news-and-events/speeches/2026/09/24/inflation">Inflation</a>
<a href="/news-and-events/speeches.aspx?page=2">Next</a>
<a href="https://other.org/speeches/x">External</a>
<a href="/about">About</a>
<a href="/speeches/20260924-challenge-innovation#top">BIS style</a>
</body></html>`;
const base = 'https://www.example-fed.org/news-and-events/speeches.aspx';

const feeds = feedLinks(html, base);
check('feed discovery (rss + atom, relative resolved)', feeds.length === 2 && feeds[0] === 'https://www.example-fed.org/rss/speeches.xml', feeds.join(', '));

const links = speechLinks(html, base);
check('speech links: same site, not listing/paging/external', links.length === 3, links.join(', '));
check('fragment stripped', links.includes('https://www.example-fed.org/speeches/20260924-challenge-innovation'));

check('date from BIS slug', linkDate('https://www.bis.org/speeches/20260924-challenge-innovation') === '2026-09-24');
check('date from y/m/d path', linkDate('https://x.org/speeches/2026/9/4/title') === '2026-09-04');
check('date from yymmdd', linkDate('https://x.org/sp260315.htm') === '2026-03-15');
check('no date', linkDate('https://x.org/speeches/outlook-for-the-economy.aspx') === null);

const r = dateRange(['2026-09-24', null, '2026-03-15', '2026-06-01']);
check('date range', r.min === '2026-03-15' && r.max === '2026-09-24' && r.dated === 3);

const t = bisArchiveTargets(new Date('2026-09-29T00:00:00Z'));
check('BIS window is 90-180 days back', t[1].url.includes('from=02%2F04%2F2026') && t[1].url.includes('till=01%2F07%2F2026'), t[1].url);

console.log(`${pass}/${total} passed`); if (pass !== total) Deno.exit(1);

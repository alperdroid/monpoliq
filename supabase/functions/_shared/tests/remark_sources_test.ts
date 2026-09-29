// Run: deno run --allow-read supabase/functions/_shared/tests/remark_sources_test.ts
import {
  remarkSurname, headlineKeywords, attributedSentences, verifyArticle, parseGdelt, rankCandidates, gdeltUrl,
} from '../remark-sources.ts';

let pass = 0, total = 0;
const check = (name: string, ok: boolean, detail = '') => { total++; pass += +ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

// Speaker surnames from the headline styles the AI search produced.
const titles: [string, string][] = [
  ['Knot: Core inflation remains sticky, poses ongoing risk', 'Knot'],
  ["Bundesbank's Nagel: Premature to commit to further rate cuts after June", 'Nagel'],
  ["ECB's Rehn sees potential for 'good number' of rate cuts this year", 'Rehn'],
  ['Bostic reiterates cautious approach to rate cuts, citing persistent inflation concerns (Reuters Interview)', 'Bostic'],
  ['Nagel Says ECB Must Remain Cautious, Premature Cuts Could Backfire (Frankfurter Allgemeine Zeitung)', 'Nagel'],
  ["Villeroy: June cut 'very highly probable' for ECB, but not automatic thereafter", 'Villeroy'],
  ["Williams suggests policy is 'well-positioned' and data-dependent approach remains key (Public Speech)", 'Williams'],
  ["Fed's Waller: Labor market is cooling", 'Waller'],
];
for (const [t, want] of titles) { const got = remarkSurname(t); check(`surname ${want}`, got === want, `got ${got}`); }

check('headline keywords drop speaker and filler',
  JSON.stringify(headlineKeywords('Knot: Core inflation remains sticky, poses ongoing risk', 'Knot')) === JSON.stringify(['core', 'inflation', 'sticky', 'poses', 'ongoing', 'risk']));

const article = [
  'AMSTERDAM, Aug 5 (Reuters) - Dutch central bank chief Klaas Knot said on Tuesday that core inflation in the euro area remains sticky and poses an ongoing risk to the ECB target.',
  '"Core inflation has been more persistent than we expected, and I see an ongoing risk that it stays above our target for longer," Knot told reporters in Amsterdam.',
  'He added that the policy rate should stay restrictive until wage growth moderates further.',
  'Markets currently price one more rate cut from the European Central Bank before the end of the year.',
  'Separately, Bank of France Governor Francois Villeroy de Galhau said earlier this week that easing could continue gradually.',
  'The euro was little changed against the dollar after the comments, trading near its highest level in two months.',
  'Knot, who sits on the ECB Governing Council, said the labour market remains tight and wage pressures are still elevated in several member countries.',
  'Economists polled by Reuters expect headline inflation to fall back toward two percent next year as energy prices ease and demand softens across the bloc.',
  'The ECB meets again in September, and investors will watch the new staff projections for signs of how long policymakers expect price pressures to last.',
  'Analysts said the tone of recent comments from governing council members has been mixed, with some pointing to weakening growth and others to persistent services inflation.',
].join(' ');
const pad = ' Other market news filled the rest of the page with unrelated items about bonds, equities and commodities trading in European hours today.'.repeat(4);

const v = verifyArticle(article + pad, 'Knot', 'Knot: Core inflation remains sticky, poses ongoing risk');
check('real article verifies', v.ok, `${v.reason}; words ${v.words}, hits ${v.surname_hits}, kw ${v.keyword_share}, attributed ${v.attributed.length}, relevant ${v.relevant}`);
check('attributed text excludes other officials', !v.attributed.some(s => /Villeroy/.test(s)) && v.attributed.some(s => /He added/.test(s)));
check('journalist framing excluded', !v.attributed.some(s => /Markets currently price/.test(s)));

const wrongSpeaker = verifyArticle(article + pad, 'Kashkari', 'Kashkari warns against cutting rates too soon, citing upside risks to inflation');
check('article about someone else is rejected', !wrongSpeaker.ok, wrongSpeaker.reason);

const wrongStory = verifyArticle(article + pad, 'Knot', 'Knot: ECB should consider quantitative tightening acceleration and bank capital buffers');
check('same speaker, different remark is rejected', !wrongStory.ok, wrongStory.reason);

const short = verifyArticle('Knot said inflation remains sticky. Knot said rates stay high.', 'Knot', 'Knot: Core inflation remains sticky');
check('short snippet is rejected', !short.ok, short.reason);

check('attribution keeps a quote that follows the naming sentence',
  attributedSentences('Knot spoke to reporters in Amsterdam on Tuesday morning. "Inflation is still too high for comfort in the euro area," he said. Oil prices rose sharply in Asian trading overnight.', 'Knot').length === 2);

const cands = parseGdelt({ articles: [
  { url: 'https://www.bloomberg.com/news/x', title: 'Knot Says Inflation Sticky', seendate: '20260805T101500Z', domain: 'bloomberg.com' },
  { url: 'https://www.reuters.com/markets/y', title: 'Euro zone bond yields edge up', seendate: '20260805T111500Z', domain: 'reuters.com' },
  { url: 'https://www.reuters.com/markets/z', title: "ECB's Knot says core inflation remains sticky", seendate: '20260805T121500Z', domain: 'reuters.com' },
  { url: 'https://www.reuters.com/markets/z', title: 'duplicate', seendate: '20260805T121500Z', domain: 'reuters.com' },
  { title: 'no url' },
] });
check('gdelt parse', cands.length === 4 && cands[0].date === '2026-08-05');
const ranked = rankCandidates(cands, 'Knot');
check('ranking: named in title and free first, paywalled last, deduped',
  ranked.length === 3 && ranked[0].url.endsWith('/z') && ranked[ranked.length - 1].domain === 'bloomberg.com', ranked.map(c => c.domain + c.url.slice(-2)).join(', '));
check('gdelt query window', /startdatetime=20260803000000/.test(gdeltUrl('Knot', 'ECB', '2026-08-05')) && /enddatetime=20260808000000/.test(gdeltUrl('Knot', 'ECB', '2026-08-05')));
check('gdelt no articles', parseGdelt({}).length === 0 && parseGdelt(null).length === 0);

console.log(`${pass}/${total} passed`); if (pass !== total) Deno.exit(1);

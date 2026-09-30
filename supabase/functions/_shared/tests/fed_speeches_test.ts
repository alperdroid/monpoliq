// Run: deno run --allow-read supabase/functions/_shared/tests/fed_speeches_test.ts
import {
  feedItems, listingLinks, pageDate, presidentByline, pageTitle, speechTitle, FED_SPEECH_SOURCES, fomcVoterBanks, isFomcVoter,
  byPresident, metaAuthor, pageText,
} from '../fed-speeches.ts';

let pass = 0, total = 0;
const check = (name: string, ok: boolean, detail = '') => { total++; pass += +ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

const rss2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>Speeches</title>
<item><title><![CDATA[Why Hike?]]></title><link>https://www.richmondfed.org/press_room/speeches/thomas_i_barkin/2026/barkin_speech_20260922</link>
<pubDate>Tue, 22 Sep 2026 14:00:00 GMT</pubDate></item>
<item><title>No link</title></item>
</channel></rss>`;
const items = feedItems(rss2);
check('rss2 items', items.length === 1 && items[0].title === 'Why Hike?' && items[0].date === '2026-09-22', JSON.stringify(items[0]));

const atom = `<feed><entry><title>Outlook</title><link rel="alternate" href="https://x.org/speeches/outlook"/><updated>2026-09-01T10:00:00Z</updated></entry></feed>`;
check('atom items', feedItems(atom)[0]?.url === 'https://x.org/speeches/outlook' && feedItems(atom)[0]?.date === '2026-09-01');

const ny = FED_SPEECH_SOURCES[0];
const nyHtml = `<a href="/newsevents/speeches/2026/wil260915">Williams</a><a href="/newsevents/speeches/2026/abe260925">Staff</a>
<a href="/newsevents/speeches">All</a><a href="/newsevents/speeches/2026/wil260915">dup</a><a href="/newsevents/speeches/2026/wil260915#x">frag</a>`;
const nyLinks = listingLinks(nyHtml, ny.url, ny.link!);
check('NY listing: only the president (wil) links', nyLinks.length === 1 && nyLinks[0].endsWith('/wil260915'), nyLinks.join(', '));
const kc = FED_SPEECH_SOURCES.find(s => /Kansas/.test(s.bank))!;
check('KC listing excludes speakers bureau',
  listingLinks('<a href="/speeches/speakers-bureau/">x</a><a href="/speeches/agriculture-the-economy-and-the-kansas-city-fed-august-2026/">y</a>', kc.url, kc.link!).length === 1);

check('date "September 24, 2026"', pageDate('Home > Speeches  September 24, 2026  Remarks') === '2026-09-24');
check('date "4 September 2026"', pageDate('Delivered 4 September 2026 in Dallas') === '2026-09-04');
check('no date', pageDate('No date here') === null);

check('byline: President and CEO', presidentByline('Remarks  Lorie K. Logan, President and CEO  Dallas, Texas') === 'Lorie K. Logan');
check('byline: President and Chief Executive Officer', presidentByline('John C. Williams, President and Chief Executive Officer, spoke') === 'John C. Williams');
check('byline: President of the Federal Reserve Bank', presidentByline('Thomas I. Barkin President of the Federal Reserve Bank of Richmond') === 'Thomas I. Barkin');
check('first vice president rejected', presidentByline('Jane Q. Doe, First Vice President and Chief Operating Officer') === null);
check('staff speaker rejected', presidentByline('Richard Perli, Head of Markets, remarks at a conference') === null);

check('title from og:title without site name',
  pageTitle('<meta property="og:title" content="The Outlook for Inflation - Federal Reserve Bank of New York">') === 'The Outlook for Inflation');
check('title from h1', pageTitle('<title>x</title><h1 class="t">Why <em>Hike</em>?</h1>') === 'Why Hike ?');
check('speech title keeps one speaker prefix', speechTitle('Lorie K. Logan', 'Lorie K. Logan: Remarks on the economy') === 'Lorie K. Logan: Remarks on the economy');
check('speech title adds speaker', speechTitle('Mary C. Daly', 'Staying the course') === 'Mary C. Daly: Staying the course');

check('by president: full name once', byPresident('Remarks by Jeffrey R. Schmid at the Agricultural Symposium', 'Jeffrey R. Schmid'));
check('by president: first + last name', byPresident('Jeff Schmid said today', 'Jeffrey R. Schmid') === false
  && byPresident('Jeffrey Schmid said today', 'Jeffrey R. Schmid'));
check('by president: surname twice', byPresident('Collins noted... later Collins added', 'Susan M. Collins'));
check('not by president: surname once, other speaker', !byPresident('Opening remarks by Kelly Dubbert; welcome from Schmid', 'Jeffrey R. Schmid'));
check('meta author', metaAuthor('<meta name="author" content="Susan M. Collins">') === 'Susan M. Collins'
  && metaAuthor('<meta content="Lorie K. Logan" property="article:author">') === 'Lorie K. Logan' && metaAuthor('<p>x</p>') === '');
check('page text keeps header, drops scripts',
  pageText('<header>John C. Williams, President and CEO</header><script>var x=1</script><p>Text</p>').includes('John C. Williams, President and CEO')
  && !pageText('<script>var x=1</script>').includes('var x'));
check('scoped sources: NY, Dallas, SF', FED_SPEECH_SOURCES.filter(s => s.scoped).map(s => s.bank.replace('Federal Reserve Bank of ', '')).join(',') === 'New York,Dallas,San Francisco');

// Published FOMC rotation: 2023, 2024, 2025, 2026, 2027.
const want: Record<number, string[]> = {
  2023: ['Chicago', 'Dallas', 'Minneapolis', 'New York', 'Philadelphia'],
  2024: ['Atlanta', 'Cleveland', 'New York', 'Richmond', 'San Francisco'],
  2025: ['Boston', 'Chicago', 'Kansas City', 'New York', 'St. Louis'],
  2026: ['Cleveland', 'Dallas', 'Minneapolis', 'New York', 'Philadelphia'],
  2027: ['Atlanta', 'Chicago', 'New York', 'Richmond', 'San Francisco'],
};
for (const [y, banks] of Object.entries(want)) {
  const got = fomcVoterBanks(+y).sort();
  check(`FOMC voters ${y}`, JSON.stringify(got) === JSON.stringify(banks), got.join(', '));
}
check('voter by speech date', isFomcVoter('Federal Reserve Bank of Boston', '2025-11-20') && !isFomcVoter('Federal Reserve Bank of Boston', '2026-03-01'));
check('New York always votes', isFomcVoter('Federal Reserve Bank of New York', '2031-05-05'));
check('St. Louis name with a dot', isFomcVoter('Federal Reserve Bank of St. Louis', '2025-06-01'));

console.log(`${pass}/${total} passed`); if (pass !== total) Deno.exit(1);

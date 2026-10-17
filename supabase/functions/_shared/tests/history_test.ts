// History backfill: decision calendar, archive readers, statistical series, SEP from FRED, frozen-only scoring.
// The HTML/CSV snippets below are written from the documented URL and page patterns of each source (this
// test environment cannot reach them); the admin preview (backfill-history, apply=false) checks the live pages.
import { FOMC_MEETINGS, ECB_DATES, fomcMeetingsBetween } from '../meeting-calendar.ts';
import { POLICY_ACTIONS, currentPolicyRate } from '../scoring-weights.ts';
import {
  parseFedSpeechIndex, fedSpeechTitle, parseEcbIndex, isEcbDecision, ecbBoardSpeaker, ecbSpeechTitle, surnameOf,
  bisReviewUrl, parseBisReviewPage, coversWindow,
} from '../history-sources.ts';
import { classifyMember, isEuroAreaMember } from '../member-sources.ts';
import { isFomcVoter } from '../fed-speeches.ts';
import { parseEcbCsv, transformSeries, approxRelease, ecbRows, ECB_SERIES, balanceSheetYoY, releaseDate } from '../stat-series.ts';
import { compareSep, scoreSEPDelta, type VintageRow } from '../sep-projections.ts';
import { scoreCombined, scorerMode } from '../frozen-scoring.ts';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  if (ok) pass++; else { fail++; console.log('FAIL', name, detail); }
}

// ── Decision calendar ──
const fedDates = new Set(FOMC_MEETINGS.map(m => m.date));
const ecbDates = new Set(ECB_DATES);
check('every Fed action is a calendar meeting', POLICY_ACTIONS.FED.every(a => fedDates.has(a.date)), POLICY_ACTIONS.FED.filter(a => !fedDates.has(a.date)));
check('every ECB action is a calendar meeting', POLICY_ACTIONS.ECB.every(a => ecbDates.has(a.date)), POLICY_ACTIONS.ECB.filter(a => !ecbDates.has(a.date)));
const lastFed = POLICY_ACTIONS.FED[POLICY_ACTIONS.FED.length - 1].date, lastEcb = POLICY_ACTIONS.ECB[POLICY_ACTIONS.ECB.length - 1].date;
check('every past Fed meeting has an action', FOMC_MEETINGS.filter(m => m.date <= lastFed).every(m => POLICY_ACTIONS.FED.some(a => a.date === m.date)));
check('every past ECB meeting has an action', ECB_DATES.filter(d => d <= lastEcb).every(d => POLICY_ACTIONS.ECB.some(a => a.date === d)));
const rateAt = (bank: 'FED' | 'ECB', date: string) => currentPolicyRate(bank, new Date(date + 'T12:00:00Z'));
const fedPath: [string, string][] = [['2015-06-01', '0.00–0.25%'], ['2015-12-16', '0.25–0.50%'], ['2018-12-19', '2.25–2.50%'],
  ['2020-03-03', '1.00–1.25%'], ['2020-03-15', '0.00–0.25%'], ['2022-12-14', '4.25–4.50%'], ['2023-07-26', '5.25–5.50%'],
  ['2024-12-18', '4.25–4.50%'], ['2025-12-10', '3.50–3.75%'], ['2026-10-17', '3.75–4.00%']];
for (const [d, r] of fedPath) check(`Fed target range on ${d}`, rateAt('FED', d) === r, rateAt('FED', d));
const ecbPath: [string, string][] = [['2015-06-01', '-0.20%'], ['2015-12-03', '-0.30%'], ['2016-03-10', '-0.40%'], ['2019-09-12', '-0.50%'],
  ['2022-07-21', '0.00%'], ['2023-09-14', '4.00%'], ['2024-12-12', '3.00%'], ['2025-06-05', '2.00%'], ['2026-10-17', '2.50%']];
for (const [d, r] of ecbPath) check(`ECB deposit rate on ${d}`, rateAt('ECB', d) === r, rateAt('ECB', d));
const y = (yr: number) => fomcMeetingsBetween(`${yr}-01-01`, `${yr}-12-31`);
check('2015: 8 FOMC meetings, 4 press conferences, 4 SEPs', y(2015).length === 8 && y(2015).filter(m => m.pressConf).length === 4 && y(2015).filter(m => m.sep).length === 4);
check('2019: a press conference at every meeting', y(2019).every(m => m.pressConf));
check('2020: 9 decisions, no SEP in March', y(2020).length === 9 && !y(2020).some(m => m.sep && m.date.startsWith('2020-03')));
check('2026 calendar: April 29 and September 16', fedDates.has('2026-04-29') && fedDates.has('2026-09-16') && !fedDates.has('2026-05-06'));

// ── Fed Board speeches ──
const fedIndex = `<div class="row"><div class="col-xs-3"><time>12/2/2015</time></div><div class="col-xs-9">
  <p><a href="/newsevents/speech/yellen20151202a.htm"><em>The Economic Outlook and Monetary Policy</em></a></p>
  <p class="news__speaker">Chair Janet L. Yellen</p></div></div>
  <a href="/newsevents/speech/fischer20151109a.htm"><em>Monetary Policy, Financial Stability, and the Zero Lower Bound</em></a>
  <a href="/newsevents/speech/yellen20151202a.htm">Watch Live</a><a href="/newsevents/speech/powell20141103a.htm">old</a>`;
const fs = parseFedSpeechIndex(fedIndex, 2015);
check('Fed index: two 2015 speeches in date order', fs.length === 2 && fs[0].surname === 'Fischer' && fs[1].date === '2015-12-02', fs);
check('Fed speech title in feed form', fedSpeechTitle(fs[1]) === 'Yellen, The Economic Outlook and Monetary Policy', fedSpeechTitle(fs[1]));

// ── ECB index pages ──
const ecbIndex = `<dl><dt isodate="2015-12-03"></dt><dd><div class="title"><a href="/press/pressconf/2015/html/is151203.en.html">Introductory statement to the press conference (with Q&amp;A)</a></div></dd>
<dt></dt><dd><a href="/press/press_conference/monetary-policy-statement/2019/html/ecb.is190912~08de50b4d2.en.html">Monetary policy statement</a></dd>
<dt></dt><dd><a href="/press/pr/date/2015/html/pr151203.en.html">Monetary policy decisions</a></dd>
<dt></dt><dd><a href="/press/pr/date/2015/html/pr151204.en.html">ECB publishes annual report</a></dd>
<dt></dt><dd><a href="/press/pr/date/2019/html/ecb.mp190912~08de50b4d2.en.html">Monetary policy decisions</a></dd>
<dt></dt><dd><a href="/press/accounts/2015/html/mg150219.en.html">Account of the monetary policy meeting</a></dd></dl>`;
const el = parseEcbIndex(ecbIndex);
check('ECB index: old and new statement links', el.filter(l => l.kind === 'is').map(l => l.date).join() === '2015-12-03,2019-09-12', el.map(l => l.kind + l.date));
check('ECB index: decisions only', el.filter(isEcbDecision).map(l => l.date).join() === '2015-12-03,2019-09-12', el.filter(isEcbDecision));
check('ECB index: account dated by its file', el.some(l => l.kind === 'mg' && l.date === '2015-02-19'));
const speeches = parseEcbIndex(`<dt isodate="2015-12-04"></dt><dd><div class="title"><a href="/press/key/date/2015/html/sp151204.en.html">Monetary policy: past, present and future</a></div>
  <div class="subtitle">Speech by Mario Draghi, President of the ECB, at The Economic Club of New York, 4 December 2015</div></dd>
  <dt></dt><dd><a href="/press/key/date/2016/html/sp160208.en.html">Supervision in 2016</a><div class="subtitle">Speech by Danièle Nouy, Chair of the Supervisory Board of the ECB, Frankfurt</div></dd>
  <dt></dt><dd><a href="/press/key/date/2019/html/ecb.in190125~5a2b.en.html">Interview with Luis de Guindos</a><div class="subtitle">Interview with Luis de Guindos, Vice-President of the ECB, conducted by X</div></dd>
  <dt></dt><dd><a href="/press/key/date/2018/html/ecb.sp180503.en.html">Monetary policy normalisation</a><div class="authors"><a href="/ecb/orga/x.en.html">Benoît Cœuré</a></div></dd>`);
const sp = speeches.map(l => ecbBoardSpeaker(l.context)?.surname ?? null);
check('ECB speakers (date order): Draghi kept, Nouy excluded, Cœuré by author link, de Guindos', sp.join('|') === 'Draghi||Cœuré|de Guindos', sp);
check('ECB speech title', ecbSpeechTitle('Draghi', speeches[0].text) === 'Draghi: Monetary policy: past, present and future');
check('surname with particle', surnameOf('Luis de Guindos') === 'de Guindos' && surnameOf('Philip R. Lane') === 'Lane');

// ── BIS review pages ──
check('BIS review URL', bisReviewUrl('2015-01-16', 1) === 'https://www.bis.org/review/r150116b.htm');
const bisPage = (who: string) => `<html><head><title>BIS</title></head><body><nav>Central bankers' speeches</nav>
  <h1>${who.split(',')[0]}: Monetary policy in the euro area</h1>
  <p>Speech by ${who}, at the Economic Forum, Frankfurt am Main, 12 January 2015.</p>
  <a href="/review/r150116a.pdf">Full speech</a><p>Ladies and gentlemen, inflation …</p></body></html>`;
const weid = parseBisReviewPage(bisPage('Dr Jens Weidmann, President of the Deutsche Bundesbank'), 'https://www.bis.org/review/r150116a.htm', '2015-01-16');
check('BIS page parsed', !!weid && weid.speaker === 'Jens Weidmann' && weid.title === 'Monetary policy in the euro area' && weid.delivered === '2015-01-12'
  && weid.pdf === 'https://www.bis.org/review/r150116a.pdf', weid);
const m = weid && classifyMember(weid);
check('BIS page → euro-area governor', !!m && m.bank === 'ECB' && /Bundesbank/.test(m.institution), m);
const croat = parseBisReviewPage(bisPage('Mr Boris Vujčić, Governor of the Croatian National Bank'), 'https://www.bis.org/review/r180116a.htm', '2018-01-16');
const cm = croat && classifyMember(croat);
check('Croatian governor counts only from 2023', !!cm && !isEuroAreaMember(cm.institution, '2018-01-12') && isEuroAreaMember(cm.institution, '2023-01-02'));
check('FOMC voters: Chicago 2015, Boston 2016, Cleveland not 2015', isFomcVoter('Federal Reserve Bank of Chicago', '2015-05-01')
  && isFomcVoter('Federal Reserve Bank of Boston', '2016-05-01') && !isFomcVoter('Federal Reserve Bank of Cleveland', '2015-05-01'));
check('no role line → not a speech', parseBisReviewPage('<h1>Page not found</h1>', 'u', '2015-01-01') === null);
check('feed window check', coversWindow(['2015-01-02', '2015-01-05'], '2015-01-01', '2015-01-07') && !coversWindow(['2026-10-01'], '2015-01-01', '2015-01-07'));

// ── ECB Data Portal and release dates ──
const csv = 'KEY,FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nICP.M.U2.N.000000.4.ANR,M,U2,2015-02,-0.3\nICP.M.U2.N.000000.4.ANR,M,U2,2015-01,-0.6\nICP.M.U2.N.000000.4.ANR,M,U2,2015-03,';
const obs = parseEcbCsv(csv);
check('CSV parsed, sorted, blanks dropped', obs.length === 2 && obs[0].period === '2015-01' && obs[1].value === -0.3, obs);
check('period-on-period %', transformSeries([{ period: '2015-Q1', value: 100 }, { period: '2015-Q2', value: 100.5 }], 'pop')[0].value.toFixed(2) === '0.50');
check('release dates: HICP flash, GDP flash', approxRelease('2015-01', { months: 1, day: 1 }) === '2015-02-01' && approxRelease('2015-Q2', { months: 4, day: 1 }) === '2015-08-01');
const hicp = ECB_SERIES.find(s => s.metric === 'HICP')!;
const rows = ecbRows(hicp, obs, '2015-01-01', '2015-03-01');
check('rows stop before the live feeds', rows.length === 1 && rows[0].release === '2015-02-01', rows);

// ── Balance sheet growth ──
const weekly: { date: string; value: number }[] = [];
for (let i = 0; i < 120; i++) weekly.push({ date: new Date(Date.UTC(2014, 0, 1) + i * 7 * 86400000).toISOString().slice(0, 10), value: 100 * Math.pow(1.002, i) });
const bs = balanceSheetYoY(weekly);
check('one balance sheet item per month after the first year', bs.length >= 15 && bs.length <= 16 && new Set(bs.map(b => b.date.slice(0, 7))).size === bs.length, bs.length);
check('y/y growth of a 0.2%/week path ≈ 11%', Math.abs(bs[0].value - (Math.pow(1.002, 52) - 1) * 100) < 0.05, bs[0]);
check('late ALFRED vintage replaced by the usual lag', releaseDate('2015-03-06', '2021-01-05', 4, 14) === '2015-03-10' && releaseDate('2015-03-06', '2015-03-10', 4, 14) === '2015-03-10');

// ── SEP from FRED vintages ──
const v = (id: string, yr: number, val: number, start: string, end: string): VintageRow => ({ date: `${yr}-01-01`, value: val, realtime_start: start, realtime_end: end });
const sepRows: Record<string, VintageRow[]> = {
  FEDTARMD: [v('', 2016, 1.4, '2015-09-17', '2015-12-15'), v('', 2016, 1.4 + 0.0, '2015-12-16', '9999-12-31'), v('', 2015, 0.4, '2015-09-17', '2015-12-15'),
    v('', 2015, 0.4, '2015-12-16', '9999-12-31')],
  PCECTPIMD: [v('', 2015, 0.4, '2015-09-17', '2015-12-15'), v('', 2015, 0.4, '2015-12-16', '9999-12-31'), v('', 2016, 1.7, '2015-09-17', '2015-12-15'),
    v('', 2016, 1.6, '2015-12-16', '9999-12-31')],
};
const cmp = compareSep(sepRows, '2015-12-16');
check('SEP: current vs previous vintage', !!cmp && cmp.current.pce_next === 1.6 && cmp.previous.pce_next === 1.7 && cmp.series.fed_funds === 'FEDTARMD', cmp);
const d = cmp && scoreSEPDelta(cmp.current, cmp.previous);
check('SEP: lower inflation projection scores dovish', !!d && d.score < 0, d);
check('SEP: no vintage → null', compareSep(sepRows, '2016-06-15') === null);

// ── Scoring is frozen-only ──
const sc = scoreCombined('The Committee decided to raise the target range for the federal funds rate to 1/4 to 1/2 percent. Inflation is expected to rise to 2 percent.', 'decision');
check('scorer mode is always frozen-only', scorerMode() === 'frozen-only');
check('decision document scored by the frozen scorer', !!(sc.audit as any)?.frozen, sc);

console.log(`${pass}/${pass + fail} passed`);
if (fail) Deno.exit(1);

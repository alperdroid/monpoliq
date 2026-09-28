import { parseBisRss, classifyMember, monpoliqTitle } from '../member-sources.ts';
import { extractSpeaker } from '../speaker-calibration.ts';
const items = parseBisRss(Deno.readTextFileSync(new URL('./bis_fixture.xml', import.meta.url)));
const expect: Record<string, string | null> = {
  'Olli Rehn': 'ECB/ncb_governor', 'Fabio Panetta': 'ECB/ncb_governor', 'Claudia Buch': null, 'Christine Lagarde': null,
  'Erik Thedéen': null, 'Gabriel Makhlouf': 'ECB/ncb_governor', 'Joachim Nagel': 'ECB/ncb_governor', 'Emmanuel Moulin': 'ECB/ncb_governor',
  'Jose Luis Escrivá': 'ECB/ncb_governor', 'Boris Vujčić': null, 'Christopher J Waller': null, 'Kevin Warsh': null,
  'John C Williams': 'FED/reserve_bank_president', 'Some Deputy': null,
};
let pass = 0;
for (const it of items) {
  const c = classifyMember(it); const got = c ? `${c.bank}/${c.group}` : null; const ok = got === expect[it.speaker];
  pass += +ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${it.speaker.padEnd(22)} -> ${String(got).padEnd(28)} delivered=${it.delivered} ${c ? '| ' + c.institution + ' | speaker parsed: ' + extractSpeaker(monpoliqTitle(c)) : ''}${it.pdf ? ' | pdf' : ''}`);
}
console.log(`${pass}/${items.length} passed`); if (pass !== items.length) Deno.exit(1);

// Regression test for the decision reader (decision-v1.0).
// Run: deno run --allow-read supabase/functions/_shared/tests/decision_test.ts
import { readDecision, scoreText } from '../frozen-scorer.ts';
const fx = JSON.parse(Deno.readTextFileSync(new URL('./decision_fixture.json', import.meta.url)));
let ok = 0;
for (const c of fx.cases) {
  const r = readDecision([c.sentence]);
  const good = r.direction === c.direction && r.bp === c.bp;
  ok += +good;
  if (!good) console.log('FAIL', c.bank, c.date, 'expected', c.direction, c.bp, 'got', r.direction, r.bp, '|', c.sentence.slice(0, 120));
}
const hold = readDecision([fx.no_decision]);
const holdOk = hold.direction === 0 && hold.bp === 0;
const plain = scoreText(fx.no_decision), dflt = scoreText(fx.no_decision, 0.1, 'general');
const generalUnchanged = JSON.stringify(plain) === JSON.stringify(dflt) && plain.decision === undefined;
console.log(`decision sentences ${ok}/${fx.cases.length} | no-decision → hold: ${holdOk} | general path unchanged: ${generalUnchanged}`);
if (ok !== fx.cases.length || !holdOk || !generalUnchanged) Deno.exit(1);

// Run: deno run --allow-read supabase/functions/_shared/tests/bundesbank_test.ts
import { isGerman, byBundesbankPresident, bundesbankVerdict, titleKey } from '../bundesbank.ts';

let pass = 0, total = 0;
const check = (name: string, ok: boolean, detail = '') => { total++; pass += +ok; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

const en = 'Joachim Nagel, President of the Deutsche Bundesbank. Ladies and gentlemen, it is a pleasure to be here. Inflation is still too high and we will do what is necessary to bring it back to target. '.repeat(3);
const de = 'Sehr geehrte Damen und Herren, die Inflation ist noch zu hoch und wir werden das Notwendige tun, um sie wieder auf das Ziel zu bringen. Das ist nicht einfach, aber es ist wichtig für die Stabilität. '.repeat(3);
const theurer = 'Michael Theurer, Member of the Executive Board of the Deutsche Bundesbank. Banks in Europe need simpler rules, not laxer ones. The supervisory framework is complex and we should make it more efficient. '.repeat(3)
  + ' As President Joachim Nagel has said, stability matters.';

check('English detected', !isGerman('Act now and advance the German economy', en));
check('German detected', isGerman('Jetzt handeln und die deutsche Wirtschaft voranbringen', de));
check('German title with English-like words still German', isGerman('Europa kann Tech – jetzt müssen wir daraus erfolgreiche Produkte machen', de));

check('Nagel byline at the top', byBundesbankPresident('Act now and advance the German economy | Keynote speech', en));
check('Nagel in the title', byBundesbankPresident('Nagel interview: Interest rates could rise if outlook doesn’t improve | Interview with RND', 'Q: How do you see ...'));
check('Theurer piece that mentions Nagel later is not his', !byBundesbankPresident('Banks in Europe need simpler rules | Guest contribution', theurer));

check('keep: English Nagel', bundesbankVerdict('Act now and advance the German economy | Keynote', en).keep);
check('remove: German copy', bundesbankVerdict('Jetzt handeln | Keynote-Rede', 'Joachim Nagel ' + de).reason === 'German-language copy');
check('remove: other board member', bundesbankVerdict('Banks need simpler rules | Guest contribution', theurer).reason === 'not by the Bundesbank President');
check('remove: unreadable', bundesbankVerdict('x', '').reason === 'page could not be read');

check('title key: Bundesbank vs BIS form match',
  titleKey('Stable and strong in turbulent times – Europe’s responses to global challenges | Speech at the Lions Club')
  === titleKey('Joachim Nagel: Stable and strong in turbulent times - Europe\'s responses to global challenges', 'Joachim Nagel'));

console.log(`${pass}/${total} passed`); if (pass !== total) Deno.exit(1);

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createTranslator,translateAudioTrackLabel} from './public/i18n.js';
import catalog from './public/messages.en.js';

const en=createTranslator('en');
const cs=createTranslator('cs');
const slots=text=>[...text.matchAll(/\{(\d+)\}/g)].map(match=>Number(match[1])).sort((a,b)=>a-b);

test('Czech mode preserves authored messages, metadata and object identity',()=>{
 const values=['Zavřít','Důvod: Zvuk má chybu.','/media/Zavřít.mkv','',null,undefined,42,false,{reason:'Soubory se změnily.'}];
 for(const value of values)assert.strictEqual(cs(value),value);
});

test('English translates navigation and the language control',()=>{
 assert.equal(en('Pozornost'),'Attention');
 assert.equal(en('Obnovy'),'Recovery');
 assert.equal(en('Historie'),'History');
 assert.equal(en('Úspory'),'Savings');
 assert.equal(en('Nastavení'),'Settings');
 assert.equal(en('Jazyk'),'Language');
 assert.equal(en('Zavřít'),'Close');
 assert.equal(en('Čeština'),'Čeština');
});

test('approval and rejection still state which copy will be deleted',()=>{
 const rejection=en('Odstraní se pouze překódovaný soubor z review. Originál v knihovně médií zůstane zachovaný.');
 assert.match(rejection,/Only the transcoded file in Review will be deleted/);
 assert.match(rejection,/original.*preserved/i);
 assert.equal(en('Přijmout rozdíl a nahradit originál'),'Accept the difference and replace the original');
});

test('combined duration-exception confirmation keeps every warning and numerical fact',()=>{
 const source='Po ověření identity souborů a kontrolního součtu kopie se původní film (33.7 GiB) nahradí výsledkem (11.8 GiB). Původní verze bude odstraněna. Plex bude používat nový soubor. Health check z Tdarru se neopakuje. Akce může trvat několik minut. Výslovně přijímáš rozdíl délky: originál 8288.061 s, výstup 8286.061 s, rozdíl -2.000 s. Potvrď pouze po kontrole začátku, konce a synchronizace zvuku.';
 const result=en(source);
 assert.notEqual(result,source);
 assert.match(result,/original movie \(33\.7 GiB\).*output \(11\.8 GiB\)/i);
 assert.match(result,/original version will be deleted/i);
 assert.match(result,/health check is not repeated/i);
 assert.match(result,/explicitly accept.*duration difference/i);
 assert.match(result,/original 8288\.061 s, output 8286\.061 s, difference -2\.000 s/);
 assert.match(result,/checking the beginning, end and audio synchroni[sz]ation/);
 assert.doesNotMatch(result,/[áčďéěíňóřšťúůýž]/i);
});

test('raw movie titles remain intact even when they are valid UI translation keys',()=>{
 for(const title of ['Zavřít','Historie','Schválit a nahradit','Movie [A+B] (2026)']){
  assert.equal(en('Posoudit '+title),'Review '+title);
  assert.equal(en('Vybrat '+title),'Select '+title);
  assert.equal(en('Porovnání zvuku · '+title),'Audio comparison · '+title);
 }
});

test('batch confirmation does not translate selected movie names',()=>{
 const source='Vybrané filmy: Zavřít; Historie (2026). Postupně se ověří identita souborů a kontrolní součet kopie, pak se nahradí originály. Původní verze budou odstraněny. Health check z Tdarru se neopakuje. Možná úspora 46.5 GiB. Dávka běží na serveru i po zavření stránky. Při chybě jednoho filmu zachová jeho soubory a pokračuje dalším.';
 const result=en(source);
 assert.match(result,/Selected movies: Zavřít; Historie \(2026\)\./);
 assert.match(result,/original versions will be deleted/i);
 assert.match(result,/health check is not repeated/i);
 assert.match(result,/46\.5 GiB/);
 assert.match(result,/files are preserved/i);
});

test('raw paths survive translated wrappers and nested backend errors',()=>{
 for(const file of ['/media/Zavřít.mkv','C:\\Média\\Historie.mkv','\\\\TOWER\\Filmy\\Zavřít.mkv']){
  const result=en('Nelze načíst '+file+': Soubory se změnily. Obnov přehled.');
  assert.ok(result.startsWith('Cannot read '+file+': '));
  assert.match(result,/: (?:The )?[Ff]iles have changed\. Refresh the overview\.$/);
  assert.equal(en(file),file);
 }
});

test('release names and identifiers are not mistaken for authored labels',()=>{
 for(const release of ['Zavřít','Historie.2026.1080p.Remux-[A+B]','Soubory se změnily. Obnov přehled.']){
  assert.equal(en('Vyřazené vydání: '+release),'Excluded release: '+release);
 }
 const id='9cf6ad08e37d64f0b3a5893248ecaef5';
 assert.equal(en(id),id);
 assert.equal(en('Neplatné pole Zavřít'),'Invalid field Zavřít');
});

test('the user-authored rejection reason is preserved verbatim',()=>{
 const reason='Zavřít. Zvuk nesedí; /media/Historie.mkv, score=85/100.';
 assert.equal(en('Důvod: '+reason),'Reason: '+reason);
});

test('known backend warnings translate recursively without losing successful replacement',()=>{
 const result=en('Film je nahrazený, ale aktualizace údajů v Tdarru selhala: Soubory se změnily. Obnov přehled.');
 assert.ok(result.startsWith('The movie was replaced, but its Tdarr metadata update failed: '));
 assert.match(result,/: (?:The )?[Ff]iles have changed\. Refresh the overview\.$/);
});

test('savings reason translates its advice while retaining the signed duration difference',()=>{
 const result=en('Úspora 65.1 %; rozdíl délky -0.001 s. Před schválením posuď obraz a zvuk při přehrávání.');
 assert.match(result,/Savings 65\.1%/);
 assert.match(result,/duration difference -0\.001 s/);
 assert.match(result,/Review the picture and audio during playback before approving\./);
});

test('audio track labels translate channel units but preserve codec, language and track title',()=>{
 const label='0: eng · ac3 · 6 kan. · Zavřít';
 assert.equal(translateAudioTrackLabel(label,en),'0: eng · ac3 · 6 ch. · Zavřít');
 assert.equal(translateAudioTrackLabel(label,cs),label);
 for(const metadata of ['Zavřít','Historie','eng','/media/Zavřít.mkv',null,undefined,42])assert.strictEqual(translateAudioTrackLabel(metadata,en),metadata);
 assert.equal(en('myn, eng · 2 stop'),'myn, eng · 2 tracks');
 const localized=translateAudioTrackLabel(label,en);
 const result=en('Originál vlevo (12.0 s), pak převod vpravo (12.0 s). Úsek od 300 s. '+localized+' → '+localized+'.');
 assert.match(result,/Original in the left channel \(12\.0 s\)/);
 assert.match(result,/transcode in the right channel \(12\.0 s\)/);
 assert.match(result,/0: eng · ac3 · 6 ch\. · Zavřít → 0: eng · ac3 · 6 ch\. · Zavřít\./);
 const rawResult=en('Originál vlevo (12.0 s), pak převod vpravo (12.0 s). Úsek od 300 s. Zavřít → Historie.');
 assert.match(rawResult,/Zavřít → Historie\.$/,'Unknown short track titles must never be recursively treated as UI labels');
});

test('unknown technical evidence stays untouched, including inside a known warning',()=>{
 const log="[matroska,webm @ 0x1a2b] EBML header parsing failed; Invalid NAL unit size (-1 > 320936). Path=/media/Film.mkv";
 assert.equal(en(log),log);
 assert.equal(en('Film je nahrazený, ale aktualizace údajů v Tdarru selhala: '+log),'The movie was replaced, but its Tdarr metadata update failed: '+log);
});

test('English mode preserves non-string values and their identity',()=>{
 for(const value of [null,undefined,0,false,NaN,{status:'ready'},['Zavřít']])assert.strictEqual(en(value),value);
});

test('translation preserves surrounding whitespace needed by adjacent inline text',()=>{
 assert.equal(en('  Zavřít\n'),'  Close\n');
 assert.equal(en(' Neznámý log [0x123] '),' Neznámý log [0x123] ');
});

test('every catalog pattern preserves placeholders and has valid raw metadata slots',()=>{
 for(const [source,target,options={}] of catalog.patterns){
  assert.deepEqual(slots(target),slots(source),'Dropped or changed placeholder in '+source);
  const available=new Set(slots(source)),raw=options.raw||[];
  assert.equal(new Set(raw).size,raw.length,'Duplicate raw slot in '+source);
  for(const slot of raw)assert.ok(Number.isInteger(slot)&&available.has(slot),'Invalid raw slot in '+source);
 }
 for(const [source,target] of Object.entries(catalog.exact))assert.deepEqual(slots(target),slots(source),'Dropped exact-message placeholder in '+source);
});

test('all current authored Czech HTML text and accessible attributes have an English translation',async()=>{
 const html=await fs.readFile(new URL('./public/index.html',import.meta.url),'utf8');
 const texts=[...html.matchAll(/>([^<]+)</g)].map(match=>match[1].trim());
 const attributes=[...html.matchAll(/\b(?:aria-label|placeholder|title)="([^"]+)"/g)].map(match=>match[1]);
 const czech=/[áčďéěíňóřšťúůýž]/i;
 const missing=[...new Set([...texts,...attributes])].filter(value=>value!=='Čeština'&&(czech.test(value)||['Historie','Potvrdit'].includes(value))).filter(value=>en(value)===value);
 assert.deepEqual(missing,[],'Untranslated static UI text or accessible name');
 assert.match(html,/data-i18n="ignore">Čeština<\/option>/,'Native language name must be explicitly exempted');
});

test('quarantine retention text uses the server-provided number of days',async()=>{
 assert.equal(en('Schválená lhůta pro následný úklid je 14 dní.'),'The approved retention period before cleanup is 14 days.');
 assert.equal(en('Stavy filmů a žádostí najdeš v sekci Obnovy. Retence karantény běží 7 dní od doloženého schválení funkční náhrady.'),'Movie and request statuses are in Recovery. Quarantine retention lasts 7 days after documented approval of a working replacement.');
 for(const text of ['Automatický úklid karantény je vypnutý.','Starší případy bez důkazu zůstávají zachované.','Stavy filmů a žádostí najdeš v sekci Obnovy.'])assert.notEqual(en(text),text);
 const app=await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/(úklid|Retence karantény)[^'"]*\b7 dní/);assert.match(app,/d\.retentionDays/);assert.match(app,/d\.cleanupEnabled/);assert.match(app,/c\.retentionDays/);
});

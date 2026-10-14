import path from 'node:path';
// node:test reporter: after the run, lists every skipped test so a green summary cannot hide them.
export default async function*skipSummary(source){
  const skipped=[];
  for await (const {type,data} of source){
    if((type==='test:pass'||type==='test:fail')&&data.skip!==undefined&&data.skip!==false){
      const file=data.file?path.relative(process.cwd(),data.file).replaceAll('\\','/'):'(unknown file)';
      skipped.push(file+': '+data.name+(typeof data.skip==='string'&&data.skip?' ('+data.skip+')':''));
    }
  }
  if(!skipped.length)return;
  const count=skipped.length===1?'1 test was':skipped.length+' tests were';
  yield '\n'+'!'.repeat(72)+'\n'+count+' SKIPPED and did not run on '+process.platform+':\n'+skipped.map(line=>'  - '+line+'\n').join('')
    +'Run them on Linux through the "Linux tests (manual)" workflow (.github/workflows/linux-tests.yml); see docs/DEVELOPMENT.md.\n'+'!'.repeat(72)+'\n';
}

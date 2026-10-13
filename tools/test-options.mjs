export function testRunnerFlags(args=[]){
  if(args.length>1||args.some(arg=>arg!=='--coverage'))throw Error('Usage: node tools/test.mjs [--coverage]');
  return ['--test','--test-concurrency=1',...(args[0]==='--coverage'?['--experimental-test-coverage']:[])];
}

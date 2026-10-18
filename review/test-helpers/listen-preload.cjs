// Child-only instrumentation; never loaded by the application itself.
// The test harness binds its loopback port once and hands the listening socket to the server as an
// inherited descriptor, so no other process can take the port between reservation and start (#191).
const fd=Number(process.env.REVIEW_TEST_LISTEN_FD);
if(Number.isInteger(fd)&&fd>2){
 const net=require('node:net'),path=require('node:path'),childProcess=require('node:child_process'),{syncBuiltinESMExports}=require('node:module');
 const server=path.join(__dirname,'..','server.mjs');
 if(process.argv[1]===server){
  // Review's own listen(PORT,'0.0.0.0',callback) uses the inherited socket instead.
  const listen=net.Server.prototype.listen;
  net.Server.prototype.listen=function(...args){
   if(args[0]!==Number(process.env.PORT))return listen.apply(this,args);
   net.Server.prototype.listen=listen;return listen.call(this,{fd},args.find(arg=>typeof arg==='function'));
  };
 }else{
  // The supervised launcher keeps the descriptor (it never listens) and passes it to each Review child.
  const spawn=childProcess.spawn;
  childProcess.spawn=function(command,args,options){
   if(!Array.isArray(args)||!args.includes(server))return spawn.apply(this,arguments);
   const stdio=[...(options?.stdio||['pipe','pipe','pipe'])];while(stdio.length<fd)stdio.push('ignore');stdio[fd]=fd;
   return spawn.call(this,command,args,{...options,stdio});
  };
  syncBuiltinESMExports();
 }
}

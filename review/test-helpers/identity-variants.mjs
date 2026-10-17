// Stored file identity variants for tests of every identity comparison. Changed
// fields stay numbers, so only the deliberately malformed variants are malformed.
export function identityVariants(fp){
 const [dev,ino,size,mtime,ctime]=fp.split(':'),bump=v=>String(Number(v)+1000),join=(...v)=>v.join(':');
 return {
  same:fp,
  ctimeChanged:join(dev,ino,size,mtime,bump(ctime)),
  deviceChanged:join(bump(dev),ino,size,mtime,ctime),
  deviceAndCtimeChanged:join(bump(dev),ino,size,mtime,bump(ctime)),
  inodeChanged:join(dev,bump(ino),size,mtime,ctime),
  fourFields:join(dev,ino,size,mtime),
  emptyCtime:join(dev,ino,size,mtime,''),
  textCtime:join(dev,ino,size,mtime,'x'),
  textDevice:join('x',ino,size,mtime,ctime),
  sixFields:join(dev,ino,size,mtime,ctime,'1'),
  missing:undefined,
 };
}

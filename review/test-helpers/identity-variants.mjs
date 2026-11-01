// Stored file identity variants for tests of every identity comparison. Changed
// fields stay numbers that differ even beyond 2^53, so only the deliberately
// malformed variants are malformed.
export function identityVariants(fp){
 const [dev,ino,size,mtime,ctime]=fp.split(':'),bump=v=>String(Number(v)<0?Number(v)*2:Number(v)*2+1),join=(...v)=>v.join(':');
 return {
  same:fp,
  ctimeChanged:join(dev,ino,size,mtime,bump(ctime)),
  deviceChanged:join(bump(dev),ino,size,mtime,ctime),
  deviceAndCtimeChanged:join(bump(dev),ino,size,mtime,bump(ctime)),
  inodeChanged:join(dev,bump(ino),size,mtime,ctime),
  remounted:join(bump(dev),bump(ino),size,mtime,ctime),
  remountedCtimeChanged:join(bump(dev),bump(ino),size,mtime,bump(ctime)),
  sizeChanged:join(bump(dev),bump(ino),bump(size),mtime,ctime),
  mtimeChanged:join(bump(dev),bump(ino),size,bump(mtime),ctime),
  fourFields:join(dev,ino,size,mtime),
  emptyCtime:join(dev,ino,size,mtime,''),
  textCtime:join(dev,ino,size,mtime,'x'),
  textDevice:join('x',ino,size,mtime,ctime),
  sixFields:join(dev,ino,size,mtime,ctime,'1'),
  missing:undefined,
 };
}

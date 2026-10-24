// Exact namespace mapping from Sonarr's path spelling to the configured TV mount.
// Deliberately does not normalize case, drive letters, or path separators.
const invalid=()=>({status:'unmapped',reason:'path_unmapped'});

function parse(value){
 if(typeof value!=='string'||!value||value.length>4096||value.includes('\0'))return null;
 let kind,body;
 if(value.startsWith('\\\\')||value.startsWith('//')){
  kind='unc';body=value.slice(2).replaceAll('\\','/');
 }else if(/^[A-Za-z]:[\\/]/.test(value)){
  kind='drive';body=value.slice(3).replaceAll('\\','/');
 }else if(value.startsWith('/')&&!value.startsWith('//')){
  kind='posix';body=value.slice(1);
 }else return null;
 if(!body||body.endsWith('/')||body.includes('//'))return null;
 const parts=body.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||part.length>255))return null;
 if(kind==='unc'&&parts.length<2)return null; // server/share root or a path below it
 if(kind==='drive'&&parts.length<1)return null;
 if(kind==='posix'&&parts.length<1)return null;
 return {kind,drive:kind==='drive'?value[0]:null,parts};
}

/**
 * Maps one canonical Sonarr path beneath an explicitly configured namespace.
 * Matching is component-exact and case-sensitive for every namespace, including
 * Windows drive letters and UNC server/share names. Only a relative path leaves
 * this pure boundary; absolute roots remain private to the caller.
 */
export function mapSonarrSourcePath(input){
 if(input===null||typeof input!=='object'||Array.isArray(input))return invalid();
 const {sonarrRoot,filePath}=input;
 const root=parse(sonarrRoot),file=parse(filePath);
 if(!root||!file||root.kind!==file.kind||root.drive!==file.drive||root.parts.length>=file.parts.length)return invalid();
 if(root.parts.some((part,index)=>file.parts[index]!==part))return invalid();
 const relative=file.parts.slice(root.parts.length).join('/');
 if(!relative||relative.split('/').some(part=>part==='.'||part==='..'))return invalid();
 return {status:'mapped',relative};
}

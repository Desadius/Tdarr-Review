// @ts-check
import path from 'node:path';
import crypto from 'node:crypto';

// Positive allowlist: a generic FFmpeg exit/error is deliberately insufficient.
const damage = [
  /Invalid NAL unit size[^\r\n]*/i,
  /Length \d+ indicated by an EBML number[^\r\n]*/i,
  /Invalid EBML[^\r\n]*/i,
  /corrupt decoded frame[^\r\n]*/i,
  /error while decoding MB[^\r\n]*/i,
  /invalid residual[^\r\n]*/i,
  /EBML header parsing failed/i,
  /quant_step_size larger than huff_lsbs/i,
  /Read past end of XLL band data/i,
  // Decoder- and demuxer-specific structural errors, recognized only with their FFmpeg context.
  // The context's process address is dropped from the signature (see below), and a stored
  // signature classifies to itself, because replacement and daily-limit gates re-check it.
  /\[dca(?: @ [^\]\r\n]*)?\] (?:Residual encoded channels are present without core|Invalid isolated sample location|Invalid bit allocation index|Failed to decode block code\(s\))/,
  /\[matroska,webm(?: @ [^\]\r\n]*)?\] Element at 0x[0-9a-f]+ ending at 0x[0-9a-f]+ exceeds containing master element ending at 0x[0-9a-f]+/i,
];
const operational = /Permission denied|Operation not permitted|Input\/output error|I\/O error|Stale file handle|No such file or directory|No space left|Connection (?:reset|refused|timed out)|Network is unreachable|Cannot allocate memory|Out of memory|Resource temporarily unavailable|Decoder .* not found|Unknown decoder|Unsupported codec/i;
/**
 * Result of one original decode (runOriginalDecode).
 * @typedef {{code:number|null,stderr:string,timeout?:boolean,signal?:string|null,error?:unknown}} DecodeResult
 */
/**
 * @param {DecodeResult} result
 * @returns {{kind:'healthy'|'corrupt'|'unconfirmed'|'operational',signature?:string}}
 */
export function classify(result) {
  if (result.timeout || result.signal || result.error || operational.test(result.stderr || '')) return {kind:'operational'};
  const signature = damage.map(r => (result.stderr || '').match(r)?.[0]?.replace(/ @ [^\]\r\n]*\]/, ']')).filter(Boolean).join('\n');
  if(signature)return {kind:'corrupt',signature};
  return result.code===0&&!String(result.stderr||'').trim()?{kind:'healthy'}:{kind:'unconfirmed'};
}
/**
 * Two independent decodes confirm the same recognized corruption.
 * @param {DecodeResult} a
 * @param {DecodeResult} b
 */
export function confirmed(a,b) {
  const first=classify(a),second=classify(b);
  return first.kind==='corrupt' && second.kind==='corrupt' && first.signature===second.signature;
}
export function relative(source,root) {
  const p=source.replaceAll('\\','/');root=root.replace(/\/$/,'');
  if(!p.startsWith(root+'/'))throw Error('Source outside configured library');
  const rel=p.slice(root.length+1);
  if(rel.split('/').some(s=>!s||s==='.'||s==='..')||!rel.toLowerCase().endsWith('.mkv'))throw Error('Unsafe source path');
  return rel;
}
export function bindHistory(movie,history,radarrPath,size) {
  const f=movie.movieFile;
  if(!movie.monitored||!f||f.path!==radarrPath||f.size!==size||f.id!==movie.movieFileId)throw Error('Radarr current file does not match source');
  const imports=history.filter(h=>h.eventType==='downloadFolderImported'&&String(h.data?.fileId)===String(f.id)&&h.data?.importedPath===radarrPath&&Number(h.data?.size)===size);
  const ids=[...new Set(imports.map(h=>h.downloadId).filter(Boolean))];
  if(ids.length!==1)throw Error('Missing or ambiguous original import history');
  const grabs=history.filter(h=>h.eventType==='grabbed'&&h.movieId===movie.id&&h.downloadId===ids[0]&&h.sourceTitle===f.sceneName);
  if(grabs.length!==1)throw Error('Missing or ambiguous original grabbed release');
  const g=grabs[0];
  if(!g.data?.publishedDate||!g.data?.indexer||!Number(g.data?.size)||!['1','2'].includes(String(g.data?.protocol)))throw Error('Incomplete release blocklist identity');
  return {historyId:g.id,sourceTitle:g.sourceTitle,downloadId:g.downloadId,indexer:g.data.indexer,size:Number(g.data.size),protocol:Number(g.data.protocol),publishedDate:g.data.publishedDate,movieFileId:f.id};
}
// Why the exact original release cannot be bound, in terms an operator can check in Radarr's history.
// Only explains bindHistory's refusal; it never relaxes it or derives a binding.
export const BINDING_FAILURES=Object.freeze(['import-missing','import-incomplete','import-conflicting','grab-missing','grab-conflicting','grab-incomplete']);
export function bindingDiagnosis(movie,history,radarrPath,size) {
  const f=movie?.movieFile,imports=history.filter(h=>h.eventType==='downloadFolderImported'&&h.data?.importedPath===radarrPath);
  if(!imports.length)return 'import-missing';
  const complete=imports.filter(h=>String(h.data?.fileId)===String(f?.id)&&Number(h.data?.size)===size);
  if(!complete.length)return 'import-incomplete';
  const ids=[...new Set(complete.map(h=>h.downloadId).filter(Boolean))];
  if(ids.length!==1)return ids.length?'import-conflicting':'import-incomplete';
  const grabs=history.filter(h=>h.eventType==='grabbed'&&h.movieId===movie.id);
  const exact=grabs.filter(h=>h.downloadId===ids[0]&&h.sourceTitle===f?.sceneName);
  if(exact.length>1)return 'grab-conflicting';
  if(!exact.length)return grabs.some(h=>h.downloadId===ids[0]||h.sourceTitle===f?.sceneName)?'grab-conflicting':'grab-missing';
  const g=exact[0];
  if(!g.data?.publishedDate||!g.data?.indexer||!Number(g.data?.size)||!['1','2'].includes(String(g.data?.protocol)))return 'grab-incomplete';
  return null;
}
export function blocked(entries,binding) {
  // Radarr's BlocklistResource exposes title/indexer/protocol, but not size.
  // Size was already verified against the exact grabbed history before POST.
  const protocol=binding.protocol===1?'usenet':'torrent';
  return entries.some(b=>b.sourceTitle===binding.sourceTitle&&b.indexer===binding.indexer&&
    (b.protocol===protocol||Number(b.protocol)===binding.protocol)&&
    (b.size===undefined||Number(b.size)===binding.size));
}
export function bindApprovedImport(movie,history,radarrPath,size,approval){
 const f=movie.movieFile;
 if(!approval||movie.id!==approval.movieId||!movie.monitored||!f||f.id!==approval.movieFileId||movie.movieFileId!==f.id||f.path!==radarrPath||f.size!==size||f.sceneName!==approval.sourceTitle)throw Error('Approved import does not match current file');
 const h=history.filter(h=>h.eventType==='downloadFolderImported'&&h.movieId===movie.id&&h.downloadId===approval.downloadId&&h.sourceTitle===approval.sourceTitle&&String(h.data?.fileId)===String(f.id)&&h.data?.importedPath===radarrPath&&Number(h.data?.size)===size);
 if(h.length!==1)throw Error('Approved original import is ambiguous');
 return {mode:'exact_title_exclusion',...approval};
}
export const caseId=(file,fp)=>crypto.createHash('sha256').update(file+'\n'+fp).digest('hex').slice(0,24);
export function within(root,rel){const p=path.resolve(root,rel);if(!p.startsWith(path.resolve(root)+path.sep))throw Error('Path escapes root');return p;}

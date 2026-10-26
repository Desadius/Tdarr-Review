import {body,reply,apiError} from './http.mjs';
import {createSonarrInspection} from '../sonarr-inspection.mjs';
import {logEvent} from '../log.mjs';

const revisionPattern=/^[a-f0-9]{64}$/;

export async function sonarrRoutes(ctx,req,res,url){
 if(url.pathname==='/api/sonarr/technical-facts'&&req.method==='POST'){
  const input=await body(req),keys=['revision','seriesId','episodeFileId'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key))||Object.keys(input).length!==keys.length||!revisionPattern.test(input.revision||'')||!Number.isSafeInteger(input.seriesId)||input.seriesId<=0||!Number.isSafeInteger(input.episodeFileId)||input.episodeFileId<=0)return reply(res,400,apiError('sonarr_invalid_request'));
  let result;try{result=await ctx.sonarrResultInspection.inspectTechnical(input.revision,input.seriesId,input.episodeFileId);}catch(error){if(error?.code==='settings_conflict')return reply(res,409,apiError('settings_conflict'));return reply(res,503,apiError('sonarr_unavailable'));}
  logEvent('sonarr.inspection',{kind:'technical-facts',seriesId:input.seriesId,result:result.status});
  return reply(res,200,result);
 }
 if(req.method!=='GET'||!['/api/sonarr/series','/api/sonarr/inspect','/api/sonarr/source','/api/sonarr/result'].includes(url.pathname))return false;
 const revision=url.searchParams.get('revision');
 if(!revisionPattern.test(revision||''))return reply(res,400,apiError('sonarr_invalid_request'));
 const keys=url.pathname.endsWith('/series')?['revision']:url.pathname.endsWith('/source')||url.pathname.endsWith('/result')?['revision','seriesId','episodeFileId']:['revision','seriesId'];
 if([...url.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length!==1))return reply(res,400,apiError('sonarr_invalid_request'));
 for(const key of ['seriesId','episodeFileId'])if(keys.includes(key)&&(!/^[1-9]\d*$/.test(url.searchParams.get(key))||!Number.isSafeInteger(Number(url.searchParams.get(key)))))return reply(res,400,apiError('sonarr_invalid_request'));
 const inspector=createSonarrInspection({getConnection:value=>ctx.sharedSettings.sonarrConnection(value)});
 const kind=url.pathname.endsWith('/series')?'series':url.pathname.endsWith('/source')?'source':'selected-series';
 const task=url.pathname.endsWith('/result')?ctx.sonarrResultInspection.inspect(revision,Number(url.searchParams.get('seriesId')),Number(url.searchParams.get('episodeFileId'))):kind==='series'?inspector.series(revision):kind==='source'?ctx.sonarrSourceInspection.inspect(revision,Number(url.searchParams.get('seriesId')),Number(url.searchParams.get('episodeFileId'))):inspector.inspect(revision,Number(url.searchParams.get('seriesId')));
 return task.then(result=>{
  const eventKind=url.pathname.endsWith('/result')?'result':kind;
  logEvent('sonarr.inspection',{kind:eventKind,seriesId:eventKind==='series'?result.series?.id??null:Number(url.searchParams.get('seriesId')),result:result.status||'success'});
  return reply(res,200,result);
 }).catch(error=>{
  const code=error?.code==='settings_conflict'?'settings_conflict':error?.message==='sonarr_too_large'?'sonarr_too_large':'sonarr_unavailable';
  logEvent('sonarr.inspection',{kind,result:code});
  return reply(res,code==='settings_conflict'?409:503,apiError(code));
 });
}

import {reply,apiError} from './http.mjs';
import {createSonarrInspection} from '../sonarr-inspection.mjs';
import {logEvent} from '../log.mjs';

const revisionPattern=/^[a-f0-9]{64}$/;

export function sonarrRoutes(ctx,req,res,url){
 if(req.method!=='GET'||!['/api/sonarr/series','/api/sonarr/inspect','/api/sonarr/source'].includes(url.pathname))return false;
 const revision=url.searchParams.get('revision');
 if(!revisionPattern.test(revision||''))return reply(res,400,apiError('sonarr_invalid_request'));
 const keys=url.pathname.endsWith('/series')?['revision']:url.pathname.endsWith('/source')?['revision','seriesId','episodeFileId']:['revision','seriesId'];
 if([...url.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length!==1))return reply(res,400,apiError('sonarr_invalid_request'));
 for(const key of ['seriesId','episodeFileId'])if(keys.includes(key)&&(!/^[1-9]\d*$/.test(url.searchParams.get(key))||!Number.isSafeInteger(Number(url.searchParams.get(key)))))return reply(res,400,apiError('sonarr_invalid_request'));
 const inspector=createSonarrInspection({getConnection:value=>ctx.sharedSettings.sonarrConnection(value)});
 const kind=url.pathname.endsWith('/series')?'series':url.pathname.endsWith('/source')?'source':'selected-series';
 const task=kind==='series'?inspector.series(revision):kind==='source'?ctx.sonarrSourceInspection.inspect(revision,Number(url.searchParams.get('seriesId')),Number(url.searchParams.get('episodeFileId'))):inspector.inspect(revision,Number(url.searchParams.get('seriesId')));
 return task.then(result=>{
  logEvent('sonarr.inspection',{kind,seriesId:kind==='series'?result.series?.id??null:Number(url.searchParams.get('seriesId')),result:result.status||'success'});
  return reply(res,200,result);
 }).catch(error=>{
  const code=error?.code==='settings_conflict'?'settings_conflict':error?.message==='sonarr_too_large'?'sonarr_too_large':'sonarr_unavailable';
  logEvent('sonarr.inspection',{kind,result:code});
  return reply(res,code==='settings_conflict'?409:503,apiError(code));
 });
}

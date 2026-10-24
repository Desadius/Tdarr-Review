import {reply,apiError} from './http.mjs';
import {createSonarrInspection} from '../sonarr-inspection.mjs';
import {logEvent} from '../log.mjs';

const revisionPattern=/^[a-f0-9]{64}$/;

export function sonarrRoutes(ctx,req,res,url){
 if(req.method!=='GET'||!['/api/sonarr/series','/api/sonarr/inspect'].includes(url.pathname))return false;
 const revision=url.searchParams.get('revision');
 if(!revisionPattern.test(revision||''))return reply(res,400,apiError('sonarr_invalid_request'));
 const keys=url.pathname.endsWith('/series')?['revision']:['revision','seriesId'];
 if([...url.searchParams.keys()].some(key=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length!==1))return reply(res,400,apiError('sonarr_invalid_request'));
 if(keys.includes('seriesId')&&(!/^[1-9]\d*$/.test(url.searchParams.get('seriesId'))||!Number.isSafeInteger(Number(url.searchParams.get('seriesId')))))return reply(res,400,apiError('sonarr_invalid_request'));
 const inspector=createSonarrInspection({getConnection:value=>ctx.sharedSettings.sonarrConnection(value)});
 const task=url.pathname.endsWith('/series')?inspector.series(revision):inspector.inspect(revision,Number(url.searchParams.get('seriesId')));
 return task.then(result=>{
  logEvent('sonarr.inspection',{kind:url.pathname.endsWith('/series')?'series':'selected-series',seriesId:result.series?.id??null,result:'success'});
  return reply(res,200,result);
 }).catch(error=>{
  const code=error?.code==='settings_conflict'?'settings_conflict':error?.message==='sonarr_too_large'?'sonarr_too_large':'sonarr_unavailable';
  logEvent('sonarr.inspection',{kind:url.pathname.endsWith('/series')?'series':'selected-series',result:code});
  return reply(res,code==='settings_conflict'?409:code==='sonarr_invalid_request'?400:503,apiError(code));
 });
}

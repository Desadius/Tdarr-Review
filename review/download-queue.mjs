// Keep Radarr import failures distinct from a completed downloader operation.
const text=x=>typeof x==='string'?x.trim().slice(0,2000):null;
export function downloadQueue(q){
 const state=text(q.trackedDownloadState),tracking=text(q.trackedDownloadStatus);
 const blocked=state?.toLowerCase()==='importblocked';
 const failed=blocked||['warning','error'].includes(tracking?.toLowerCase())||['failed','error','warning','downloadclientunavailable'].includes(String(q.status).toLowerCase());
 const messages=(Array.isArray(q.statusMessages)?q.statusMessages:[]).flatMap(m=>Array.isArray(m?.messages)?m.messages:[]).map(text).filter(Boolean).slice(0,8);
 const reported=text(q.errorMessage);
 const summary=reported&&/^PAR Status:/i.test(reported)&&/Unpack Status: SUCCESS/i.test(reported)&&!/FAILURE|FAILED|ERROR|DAMAGED/i.test(reported);
 const residual=tracking?.toLowerCase()!=='ok'&&!summary?reported:null;
 const error=failed?(messages.join('; ').slice(0,2000)||text(q.errorMessage)||'Radarr download or import requires inspection'):residual;
 const valid=Number.isFinite(q.size)&&q.size>0&&Number.isFinite(q.sizeleft)&&q.sizeleft>=0;
 return {title:q.title,status:q.status,trackedDownloadState:state,trackedDownloadStatus:tracking,percent:valid?Math.max(0,Math.min(100,100*(1-q.sizeleft/q.size))):null,timeleft:q.timeleft,error};
}

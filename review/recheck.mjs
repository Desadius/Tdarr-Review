import {compareIdentity,REMOUNT_CHANGES} from '../recovery/file-identity.mjs';
// A remount changes only the device or inode number (ADR 0002); size, modification time and ctime must still match.
const REMOUNT=new Set(['same',...REMOUNT_CHANGES]);
export function remountOnly(prior,a,b){
 return !!prior&&[[prior.originalFP,a],[prior.reviewFP,b]].every(([x,y])=>REMOUNT.has(compareIdentity(x,y)));
}
// How a changed item may be verified again: a remount changes only the device or inode; a metadata-only
// change (ctime) needs an explicit content verification and a fresh assessment. Anything else
// (size, mtime, a remount with a ctime change) cannot be verified away.
export function identityChange(prior,a,b){
 if(!prior)return {recheck:null,changes:[]};
 if(remountOnly(prior,a,b))return {recheck:'remount',changes:[['original',prior.originalFP,a],['review',prior.reviewFP,b]].flatMap(([name,x,y])=>{const kind=compareIdentity(x,y);return kind==='same'?[]:[name+(kind==='device-changed'?':device':':remount')]})};
 const kinds=[['original',compareIdentity(prior.originalFP,a)],['review',compareIdentity(prior.reviewFP,b)]];
 if(kinds.every(([,kind])=>['same','ctime-changed'].includes(kind))&&kinds.some(([,kind])=>kind==='ctime-changed'))return {recheck:'verify',changes:kinds.filter(([,kind])=>kind==='ctime-changed').map(([name])=>name+':ctime')};
 return {recheck:null,changes:[]};
}
// A changed item whose recorded identity cannot be read is blocked with its own reason.
export function unreadableIdentity(prior){
 return !!prior&&[prior.originalFP,prior.reviewFP].some(fp=>compareIdentity(fp,fp)==='invalid');
}
export function durationException(info){
 return info.durationMismatch===true&&Number.isFinite(info.durationA)&&Number.isFinite(info.durationB)&&info.durationA>0&&info.durationB>0&&Math.abs(info.durationA-info.durationB)<=2&&Math.abs(info.durationB/info.durationA*100-100)<=0.1;
}

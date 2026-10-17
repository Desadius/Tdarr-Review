import {compareIdentity} from '../recovery/file-identity.mjs';
// A remount changes only the device; every other identity field must still match.
export function remountOnly(prior,a,b){
 return !!prior&&[[prior.originalFP,a],[prior.reviewFP,b]].every(([x,y])=>['same','device-changed'].includes(compareIdentity(x,y)));
}
export function durationException(info){
 return info.durationMismatch===true&&Number.isFinite(info.durationA)&&Number.isFinite(info.durationB)&&info.durationA>0&&info.durationB>0&&Math.abs(info.durationA-info.durationB)<=2&&Math.abs(info.durationB/info.durationA*100-100)<=0.1;
}

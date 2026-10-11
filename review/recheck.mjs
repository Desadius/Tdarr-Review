export function remountOnly(prior,a,b){
 return !!prior&&[[prior.originalFP,a],[prior.reviewFP,b]].every(([x,y])=>typeof x==='string'&&typeof y==='string'&&x.split(':').length===5&&y.split(':').length===5&&x.split(':').slice(1).join(':')===y.split(':').slice(1).join(':'));
}
export function durationException(info){
 return info.durationMismatch===true&&Number.isFinite(info.durationA)&&Number.isFinite(info.durationB)&&info.durationA>0&&info.durationB>0&&Math.abs(info.durationA-info.durationB)<=2&&Math.abs(info.durationB/info.durationA*100-100)<=0.1;
}

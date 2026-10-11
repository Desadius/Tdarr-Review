const dv=require('./dv81.cjs');
const MARKER='tdarr-dv81-hdr10plus-crf21-v1';
function withoutPlus(p){
 const q=JSON.parse(JSON.stringify(p));
 for(const x of [...(q.streams||[]),...(q.frames||[])])x.side_data_list=(x.side_data_list||[]).filter(s=>!/2094|HDR10\+/i.test(s.side_data_type));
 return q;
}
function signature(p){
 if(!p.frames?.length||p.frames.some(f=>!f.side_data_list?.some(s=>/2094|HDR10\+/i.test(s.side_data_type))))throw Error('Dual HDR requires HDR10+ metadata on every sampled frame');
 return {...dv.signature(withoutPlus(p)),hdr10plus:true};
}
function params(p){signature(p);return dv.params(withoutPlus(p))}
function compare(a,b){if(JSON.stringify(signature(a))!==JSON.stringify(signature(b)))throw Error('Dual HDR profile, static metadata or dimensions changed')}
module.exports={MARKER,signature,params,compare};

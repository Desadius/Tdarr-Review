import {normalizePreviewLanguage} from './preview-plan.mjs';
export const defaultPreviewSettings=()=>({enabled:true,maxMiB:4096,maxFilms:5,retentionDays:7,preferredAudioLanguages:['ces'],fallbackAudioLanguages:['eng','slk'],allowOtherAudioLanguages:true});
export function validatePreviewSettings(value){
 const keys=Object.keys(defaultPreviewSettings());
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!(k in value)))throw Error('Neplatná pole nastavení ukázek.');
 if(typeof value.enabled!=='boolean'||typeof value.allowOtherAudioLanguages!=='boolean')throw Error('Přípravu a záložní výběr zapni nebo vypni.');
 for(const [key,min,max] of [['maxMiB',32,20480],['maxFilms',1,20],['retentionDays',1,30]])if(!Number.isInteger(value[key])||value[key]<min||value[key]>max)throw Error('Neplatný limit přípravy: '+key);
 const languages={};
 for(const key of ['preferredAudioLanguages','fallbackAudioLanguages']){
  if(!Array.isArray(value[key])||value[key].length>10||value[key].some(language=>typeof language!=='string'||!normalizePreviewLanguage(language)))throw Error('Neplatný seznam jazyků. Použij známé jazykové kódy.');
  languages[key]=[...new Set(value[key].map(normalizePreviewLanguage))];
 }
 languages.fallbackAudioLanguages=languages.fallbackAudioLanguages.filter(language=>!languages.preferredAudioLanguages.includes(language));
 return {...value,...languages};
}
export const previewLimits=c=>({maxBytes:c.maxMiB*1024**2,maxEntries:Math.max(200,c.maxFilms*24),maxEntryBytes:128*1024**2,ttlMs:c.retentionDays*86400000});

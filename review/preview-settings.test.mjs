import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultPreviewSettings,validatePreviewSettings,previewLimits} from './preview-settings.mjs';

test('preview preferences preserve ordered primary and fallback languages and canonical aliases',()=>{
 const result=validatePreviewSettings({...defaultPreviewSettings(),preferredAudioLanguages:['cs','cze','ja'],fallbackAudioLanguages:['en','ces','sk','eng']});
 assert.deepEqual(result.preferredAudioLanguages,['ces','jpn']);assert.deepEqual(result.fallbackAudioLanguages,['eng','slk']);
 const limits=previewLimits(result);assert.equal(limits.maxBytes,4*1024**3);assert.equal(limits.maxEntryBytes,128*1024**2);assert.equal(limits.ttlMs,7*86400000);
});
test('preview settings reject unbounded budgets, unknown fields and malformed language selections',()=>{
 for(const change of [{enabled:'true'},{maxMiB:31},{maxMiB:20481},{maxFilms:21},{retentionDays:0},{preferredAudioLanguages:['und']},{fallbackAudioLanguages:['not-a-language']},{allowOtherAudioLanguages:'true'},{unknown:1}])assert.throws(()=>validatePreviewSettings({...defaultPreviewSettings(),...change}));
 const result=validatePreviewSettings({...defaultPreviewSettings(),preferredAudioLanguages:[],fallbackAudioLanguages:[],allowOtherAudioLanguages:false});assert.deepEqual(result.preferredAudioLanguages,[]);
});

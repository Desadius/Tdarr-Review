import test from 'node:test';
import assert from 'node:assert/strict';
import {remountOnly,identityChange,unreadableIdentity,durationException} from './recheck.mjs';
import {identityVariants} from './test-helpers/identity-variants.mjs';
test('only the device or inode identity can differ',()=>{const p={originalFP:'48:123:400:500:600',reviewFP:'46:124:200:700:800'};assert(remountOnly(p,'47:123:400:500:600','45:124:200:700:800'));assert(remountOnly(p,'47:999:400:500:600','45:124:200:700:800'));for(const a of ['47:123:401:500:600','47:123:400:501:600','47:123:400:500:601','bad'])assert(!remountOnly(p,a,'45:124:200:700:800'));assert(!remountOnly(null,'x','y'))});
test('duration exception is narrow and explicitly flagged',()=>{assert(durationException({durationMismatch:true,durationA:7948.428,durationB:7947.488}));for(const info of [{durationA:7948,durationB:7945},{durationA:10,durationB:9},{durationA:NaN,durationB:5},{durationA:0,durationB:0}])assert(!durationException({durationMismatch:true,...info}));assert(!durationException({durationA:7948.428,durationB:7947.488}))});
test('a recorded identity counts as remounted only when the device or inode alone differs',()=>{
 const current='47:123:400:500:600',review='45:124:200:700:800';
 const expected={same:true,ctimeChanged:false,deviceChanged:true,deviceAndCtimeChanged:false,inodeChanged:true,remounted:true,remountedCtimeChanged:false,sizeChanged:false,mtimeChanged:false,fourFields:false,emptyCtime:false,textCtime:false,textDevice:false,sixFields:false,missing:false};
 for(const [variant,stored] of Object.entries(identityVariants(current))){
  assert.equal(remountOnly({originalFP:stored,reviewFP:review},current,review),expected[variant],'original '+variant);
  assert.equal(remountOnly({originalFP:current,reviewFP:stored},current,current),expected[variant],'review '+variant);
 }
});
test('an unreadable recorded identity is named as such',()=>{
 const valid='47:123:400:500:600',invalid=new Set(['fourFields','emptyCtime','textCtime','textDevice','sixFields','missing']);
 for(const [variant,stored] of Object.entries(identityVariants(valid))){
  assert.equal(unreadableIdentity({originalFP:stored,reviewFP:valid}),invalid.has(variant),'original '+variant);
  assert.equal(unreadableIdentity({originalFP:valid,reviewFP:stored}),invalid.has(variant),'review '+variant);
 }
 assert.equal(unreadableIdentity(null),false);assert.equal(unreadableIdentity(undefined),false);
});

test('a ctime-only change needs verification; a device or inode change is a remount; anything else cannot be verified',()=>{
 const current='47:123:400:500:600',review='45:124:200:700:800';
 const expected={same:null,ctimeChanged:'verify',deviceChanged:'remount',deviceAndCtimeChanged:null,inodeChanged:'remount',remounted:'remount',remountedCtimeChanged:null,sizeChanged:null,mtimeChanged:null,fourFields:null,emptyCtime:null,textCtime:null,textDevice:null,sixFields:null,missing:null};
 for(const [variant,stored] of Object.entries(identityVariants(current))){
  if(variant==='same')continue;
  assert.equal(identityChange({originalFP:stored,reviewFP:review},current,review).recheck,expected[variant],'original '+variant);
  assert.equal(identityChange({originalFP:current,reviewFP:stored},current,current).recheck,expected[variant],'review '+variant);
 }
 assert.deepEqual(identityChange({originalFP:'47:123:400:500:599',reviewFP:review},current,review),{recheck:'verify',changes:['original:ctime']});
 assert.deepEqual(identityChange({originalFP:'47:123:400:500:599',reviewFP:'45:124:200:700:799'},current,review).changes,['original:ctime','review:ctime']);
 assert.deepEqual(identityChange({originalFP:'46:123:400:500:600',reviewFP:review},current,review),{recheck:'remount',changes:['original:device']});
 assert.deepEqual(identityChange({originalFP:'46:99:400:500:600',reviewFP:'44:98:200:700:800'},current,review),{recheck:'remount',changes:['original:remount','review:remount']});
 assert.equal(identityChange({originalFP:'47:123:400:500:599',reviewFP:'45:124:201:700:800'},current,review).recheck,null,'a ctime change beside a real change');
 assert.deepEqual(identityChange(undefined,current,review),{recheck:null,changes:[]});
});

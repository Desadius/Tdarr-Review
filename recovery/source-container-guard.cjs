module.exports=async(args)=>{
 const f=args.inputFileObj;
 if(!/\.mkv$/i.test(f._id))return {outputFileObj:f,outputNumber:1,variables:args.variables};
 const fs=require('fs/promises'),h=await fs.open(f._id,'r');let b=Buffer.alloc(64),n;
 try{n=(await h.read(b,0,b.length,0)).bytesRead;}finally{await h.close();}
 b=b.subarray(0,n);
 if(n<4||!b.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))){
  const terminal=/^\x1b\[[0-9;]*[A-Za-z]/.test(b.toString('latin1'));
  throw Error((terminal?'SOURCE_CONTAINER_CORRUPT':'SOURCE_CONTAINER_REVIEW')+': MKV EBML header missing'+(terminal?'; terminal control bytes detected':'')+'. Original unchanged; do not mark Not required.');
 }
 if(!(f.ffProbeData?.streams||[]).some(s=>s.codec_type==='video'&&!s.disposition?.attached_pic))throw Error('SOURCE_CONTAINER_REVIEW: No main video detected. Original unchanged.');
 return {outputFileObj:f,outputNumber:1,variables:args.variables};
};

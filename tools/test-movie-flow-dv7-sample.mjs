// Manual check of the movie flow's DV7 -> DV 8.1 restore on a short copied sample with real tools.
// Usage: node tools/test-movie-flow-dv7-sample.mjs <dv7-source.mkv> <encoded.mkv>
// Env: FFMPEG (ffprobe is found beside it, as on a Tdarr node), DOVI_TOOL, MKVMERGE.
// Use a copy of a few minutes of film, never the library file itself: the node writes its result and temporary
// files in a dv7to81-* directory beside the encoded file. See docs/MOVIE-FLOW.md.
import fs from 'node:fs';
import path from 'node:path';
import {Module} from 'node:module';
import {fileURLToPath} from 'node:url';

const [source,encoded]=process.argv.slice(2);
const tools={ffmpeg:process.env.FFMPEG,dovi:process.env.DOVI_TOOL,mkvmerge:process.env.MKVMERGE};
if(!source||!encoded||Object.values(tools).some(x=>!x)){
 console.error('Usage: FFMPEG=… DOVI_TOOL=… MKVMERGE=… node tools/test-movie-flow-dv7-sample.mjs <dv7-source.mkv> <encoded.mkv>');process.exit(2);
}
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.join(repo,'templates/tdarr/movie-flow/HDRextraPost.cjs');
const node=new Module(file);node.filename=file;node.paths=Module._nodeModulePaths(repo);node._compile(fs.readFileSync(file,'utf8'),file);
const st=fs.statSync(source);
const args={inputFileObj:{_id:path.resolve(encoded)},ffmpegPath:tools.ffmpeg,jobLog:line=>console.log(new Date().toISOString().slice(11,19),line),
 variables:{user:{dv7to81:{path:path.resolve(source),size:st.size,mtime:st.mtimeMs,tool:tools.dovi,mkvmerge:tools.mkvmerge}}}};
try{const result=await node.exports(args);console.log('Restored:',result.outputFileObj._id)}
catch(error){console.error('Failed:',error.message);process.exitCode=1}

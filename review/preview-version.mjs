import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const rendererFiles=Object.freeze(['preview-render.mjs','av-preview.mjs','audio-compare.mjs','audio-listen.mjs','frames.mjs','preview-process.mjs','preview-diagnostics.mjs','preview-version.mjs']);

// Diagnostic acceptance is part of the renderer's contract, including cache reuse.
export async function previewCodeVersion(readSource=file=>fs.readFile(new URL(file,import.meta.url),'utf8')){
 const sources=await Promise.all(rendererFiles.map(file=>readSource(file)));
 return crypto.createHash('sha256').update(sources.join('\n')).digest('hex');
}

// A Matroska cue warning emitted by input seeking is not a decoder failure.
// Accept it only after successful exit and separately validated complete output.
export function previewErrors(stderr){
 if(String(stderr).length>=16384)return 'Příliš mnoho diagnostických zpráv při přípravě náhledu.';
 return String(stderr).split(/\r?\n/).filter(line=>line.trim()&&!/^\[matroska,webm @ 0x[0-9a-f]+\] File is broken, keyframes not correctly marked!\s*$/i.test(line)).join('\n');
}

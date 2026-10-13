import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));

export function dockerTestArguments(root=repositoryRoot){
  return ['run','--rm','--pull=never','--platform','linux/amd64',
    '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--volume',`${path.resolve(root)}:/workspace:ro`,'--workdir','/workspace',
    // Docker mounts tmpfs noexec unless asked. The HTTP fixtures write stand-in
    // ffprobe/ffmpeg scripts there and Review checks them with access(X_OK).
    '--tmpfs','/tmp:rw,exec,nosuid,nodev','--env','NPM_CONFIG_CACHE=/tmp/npm-cache',
    'node:24','sh','-c','npm run check && npm test'];
}

export function runDockerTests({root=repositoryRoot,spawn=spawnSync,report=console.error}={}){
  const result=spawn('docker',dockerTestArguments(root),{stdio:'inherit',shell:false});
  if(result.error){
    report(`Unable to start Docker: ${result.error.message}. Install Docker with Linux containers and preload node:24 (see docs/DEVELOPMENT.md).`);
    return 1;
  }
  return result.status??1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exit(runDockerTests());

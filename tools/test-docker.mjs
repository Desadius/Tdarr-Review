import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const testImage='node:24',platform='linux/amd64';

export function dockerTestArguments(root=repositoryRoot){
  return ['run','--rm','--pull=never','--platform',platform,
    '--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--volume',`${path.resolve(root)}:/workspace:ro`,'--workdir','/workspace',
    // Docker mounts tmpfs noexec unless asked. The HTTP fixtures write stand-in
    // ffprobe/ffmpeg scripts there and Review checks them with access(X_OK).
    '--tmpfs','/tmp:rw,exec,nosuid,nodev','--env','NPM_CONFIG_CACHE=/tmp/npm-cache',
    testImage,'sh','-c','npm run check && npm test'];
}

// The test container has no network, so a missing image is fetched on the host first.
export function runDockerTests({root=repositoryRoot,spawn=spawnSync,report=console.error}={}){
  const options={stdio:'inherit',shell:false};
  const docker=(args,spawnOptions=options)=>{
    const result=spawn('docker',args,spawnOptions);
    if(result.error)report(`Unable to start Docker: ${result.error.message}. Install Docker with Linux containers (see docs/DEVELOPMENT.md).`);
    return result;
  };
  const inspected=docker(['image','inspect','--format','{{.Id}}',testImage],{stdio:'ignore',shell:false});
  if(inspected.error)return 1;
  if(inspected.status!==0){
    report(`${testImage} is not present locally; downloading it once with docker pull --platform ${platform} ${testImage}.`);
    const pulled=docker(['pull','--platform',platform,testImage]);
    if(pulled.error)return 1;
    if(pulled.status!==0){
      report(`Unable to download ${testImage}. Check network access to Docker Hub, then run docker pull --platform ${platform} ${testImage} and npm run test:docker again.`);
      return pulled.status??1;
    }
  }
  const result=docker(dockerTestArguments(root));
  if(result.error)return 1;
  return result.status??1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exit(runDockerTests());

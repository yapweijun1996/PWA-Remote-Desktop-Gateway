import {lstat,open,rename,unlink} from 'node:fs/promises';import path from 'node:path';import {randomBytes} from 'node:crypto';
export async function writeArtifact(target,data,{beforeRename}={}){
  async function validate(){try{const existing=await lstat(target);if(!existing.isFile()||existing.isSymbolicLink())throw new Error('Unsafe artifact target');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await validate();const temp=path.join(path.dirname(target),`.rdg-artifact-${randomBytes(16).toString('hex')}`);let handle;
  try{
    handle=await open(temp,'wx',0o600);await handle.writeFile(data);await handle.chmod(0o600);await handle.sync();await handle.close();handle=null;
    if(beforeRename)await beforeRename();await validate();await rename(temp,target);
    const dir=await open(path.dirname(target),'r');try{await dir.sync();}catch(e){if(!['EINVAL','ENOTSUP'].includes(e.code))throw e;}finally{await dir.close();}
  }finally{if(handle)await handle.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}

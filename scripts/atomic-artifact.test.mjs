import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,stat,symlink,readdir,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {writeArtifact} from './atomic-artifact.mjs';
test('Artifact replacement is private, atomic on failure and refuses symlinks',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'rdg-artifact-'));try{
    const target=path.join(dir,'report.json');await writeArtifact(target,'original');assert.equal((await stat(target)).mode&0o777,0o600);
    await assert.rejects(writeArtifact(target,'incomplete',{beforeRename:()=>{throw new Error('injected');}}));assert.equal(await readFile(target,'utf8'),'original');
    await writeArtifact(target,'complete');assert.equal(await readFile(target,'utf8'),'complete');const link=path.join(dir,'link');await symlink(target,link);await assert.rejects(writeArtifact(link,'unwanted'));assert.equal(await readFile(target,'utf8'),'complete');assert.deepEqual((await readdir(dir)).sort(),['link','report.json']);
  }finally{await rm(dir,{recursive:true});}
});

import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import path from 'node:path';import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const lock=JSON.parse(await readFile(path.join(root,'gateway/dependencies.lock.json')));
const resolved=(await readFile(path.join(root,'gateway/target/dependencies.txt'),'utf8')).split('\n').map(line=>line.trim().match(/^([^:]+):([^:]+):jar:([^:]+):(compile|runtime):/)).filter(Boolean).map(m=>`${m[1]}:${m[2]}:${m[3]}`).sort();
const expected=lock.runtime.map(d=>`${d.group}:${d.artifact}:${d.version}`).sort();
if(JSON.stringify(resolved)!==JSON.stringify(expected))throw new Error('Resolved runtime differs from dependency lock');
const hash=data=>createHash('sha256').update(data).digest('hex');
for(const dependency of lock.runtime){
  const file=path.join(process.env.RDG_MAVEN_REPOSITORY??path.join(os.homedir(),'.m2/repository'),dependency.group.replaceAll('.','/'),dependency.artifact,dependency.version,`${dependency.artifact}-${dependency.version}.jar`);
  if(hash(await readFile(file))!==dependency.sha256)throw new Error('Dependency digest mismatch: '+dependency.artifact);
}
for(const [file,digest] of Object.entries(lock.sqliteNative)){
  if(hash(await readFile(path.join(root,'gateway/target/sqlite-native',file)))!==digest)throw new Error('Extracted SQLite native digest mismatch');
}
const provenance=JSON.parse(await readFile(path.join(root,'web/vendor/provenance.json')));
if(hash(await readFile(path.join(root,'web/vendor/all.min.js')))!==provenance.sha256['all.min.js'])throw new Error('Guacamole browser artifact changed');
const nativeProvenance=JSON.parse(await readFile(path.join(root,'deployment/guacd-provenance.json')));
let osArtifacts=0;
for(const entry of Object.values(nativeProvenance.packageLocks)){
  if(!/^deployment\/deb-locks\/[a-z0-9-]+\.lock$/.test(entry.path))throw new Error('Unsafe OS lock path');
  const data=await readFile(path.join(root,entry.path));
  if(hash(data)!==entry.sha256)throw new Error('OS package lock digest mismatch');
  const rows=data.toString('utf8').trim().split('\n');
  if(rows.length!==entry.artifacts||rows.some(row=>!/^([a-f0-9]{64}) ([A-Za-z0-9_.+~%:-]+\.deb) ([a-z0-9+.-]+) ([A-Za-z0-9.+:~_-]+)$/.test(row)))throw new Error('Invalid OS package lock');
  osArtifacts+=rows.length;
}
console.log(`Verified ${lock.runtime.length} runtime JAR digests, extracted SQLite natives, official browser artifact and ${osArtifacts} pinned Ubuntu package records in six locks. Image installation hashes are checked during Docker builds.`);

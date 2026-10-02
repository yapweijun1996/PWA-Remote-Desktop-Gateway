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
console.log(`Verified ${lock.runtime.length} runtime JAR digests, extracted SQLite natives and official browser artifact.`);

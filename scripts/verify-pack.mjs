/** Verify shipped file hashes. Run on the untouched handoff before modifying it. */
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
let count=0;const errors=[];
try{
 const manifest=await readFile(path.join(root,'MANIFEST.sha256'),'utf8');
 for(const line of manifest.trim().split('\n')){
  const match=/^([0-9a-f]{64})  (.+)$/.exec(line);
  if(!match){errors.push('Malformed manifest entry');continue;}
  const [,expected,rel]=match;
  if(path.isAbsolute(rel)||rel.split(/[\\/]/).some(v=>v==='..')||rel.includes('\0')){errors.push('Unsafe manifest path');continue;}
  try{const actual=createHash('sha256').update(await readFile(path.join(root,rel))).digest('hex');if(actual!==expected)errors.push(`Mismatch: ${rel}`);else count++;}
  catch{errors.push(`Missing/unreadable: ${rel}`);}
 }
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
 else console.log(`PASS: ${count} shipped files match MANIFEST.sha256. This verifies integrity, not remote-desktop readiness.`);
}catch(e){console.error(`Cannot verify handoff: ${e.message}`);process.exitCode=1;}

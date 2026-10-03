import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const ledgerPath=process.argv[2]??'qa/implementation/artifacts.json';
if(process.argv.length>3||!/^qa\/implementation\/[a-z0-9-]+\.json$/.test(ledgerPath))throw new Error('Invalid artifact ledger path');
const ledger=JSON.parse(await readFile(path.join(root,ledgerPath),'utf8'));
let checked=0;
for(const group of ['sources','outputs','evidence']){
  if(!ledger[group]||Array.isArray(ledger[group])||typeof ledger[group]!=='object'||Object.keys(ledger[group]).length===0)throw new Error('Empty or invalid artifact group: '+group);
  for(const [relative,expected] of Object.entries(ledger[group])){
    if(path.isAbsolute(relative)||relative.split('/').includes('..')||!/^([a-f0-9]{64})$/.test(expected))throw new Error('Invalid artifact ledger');
    const actual=createHash('sha256').update(await readFile(path.join(root,relative))).digest('hex');
    if(actual!==expected)throw new Error('Artifact digest mismatch: '+relative);
    checked++;
  }
}
console.log(`Verified ${checked} recorded source/output/evidence digests. OCI identities are recorded separately; this does not establish target readiness.`);

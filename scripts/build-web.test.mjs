import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {release} from '../web/src/release.mjs';

test('Build identity is reproducible, injected consistently and never cached as private data',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'rdg-web-build-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const folder of ['scripts','web/src','web/public','web/vendor'])await mkdir(path.join(root,folder),{recursive:true});
  const fixture={
    'scripts/build-web.mjs':await readFile(new URL('./build-web.mjs',import.meta.url),'utf8'),
    'web/src/release.mjs':await readFile(new URL('../web/src/release.mjs',import.meta.url),'utf8'),
    'web/src/app.mjs':"import {release} from './release.mjs';import {label} from './transitive.mjs';document.title=label+release.version;\n",
    'web/src/offline.mjs':"import {release} from './release.mjs';document.title='Offline '+release.version;\n",
    'web/src/transitive.mjs':"export const label='Fixture';\n",
    'web/public/styles.css':'body{color:#111;background:#fff}\n',
    'web/vendor/all.min.js':'/* Disposable public vendor fixture. */\n',
    'web/public/index.html':'<link href="__STYLE__"><script src="__GUAC__"></script><script type="module" src="__APP__"></script><img src="__ICON192__">',
    'web/public/offline.html':'<link href="__STYLE__"><script type="module" src="__OFFLINE__"></script><img src="__ICON192__">',
    'web/public/sw.template.js':await readFile(new URL('../web/public/sw.template.js',import.meta.url),'utf8')
  };
  for(const [file,content]of Object.entries(fixture))await writeFile(path.join(root,file),content);
  const build=()=>execFileSync(process.execPath,[path.join(root,'scripts/build-web.mjs')],{cwd:root,encoding:'utf8'});
  async function snapshot(){const files=new Map();async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else files.set(path.relative(root,file),await readFile(file,'base64'));}}await walk(path.join(root,'web/dist'));return files;}
  build();const before=await snapshot();const identity=JSON.parse(await readFile(path.join(root,'web/dist/build.json'),'utf8'));
  assert.equal(identity.version,release.version);assert.match(identity.build,/^[a-f0-9]{16}$/);
  const manifest=JSON.parse(await readFile(path.join(root,'web/dist/asset-manifest.json'),'utf8'));
  assert.deepEqual(manifest['/build.json'],{type:'application/json',immutable:false});assert.equal(identity.assets,Object.keys(manifest).length);
  const releasePath=Object.keys(manifest).find(file=>file.startsWith('/assets/release.'));
  assert.ok(releasePath);assert.ok((await readFile(path.join(root,'web/dist',releasePath),'utf8')).includes(identity.build));
  const worker=await readFile(path.join(root,'web/dist/sw.js'),'utf8');assert.ok(worker.includes(JSON.stringify({version:identity.version,build:identity.build})));
  assert.equal(worker.includes('"/build.json":'),false);assert.equal(worker.includes('__RELEASE__'),false);
  const offline=await readFile(path.join(root,'web/dist/offline.html'),'utf8');assert.match(offline,/\/assets\/offline\.[a-f0-9]{16}\.js/);assert.equal(offline.includes('__'),false);
  build();assert.deepEqual(await snapshot(),before);
  await writeFile(path.join(root,'web/src/transitive.mjs'),"export const label='Changed fixture';\n");build();
  assert.notEqual(JSON.parse(await readFile(path.join(root,'web/dist/build.json'),'utf8')).build,identity.build);
});

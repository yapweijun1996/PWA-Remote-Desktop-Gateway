#!/usr/bin/env python3
"""Optional QA harness, not needed for npm test/preview.
Requires a separately installed Python Playwright and local Chromium browser.
Start npm run preview in another terminal, then run python qa/render-and-check-prototype.py.
Optional RDG_TEST_CHROMIUM points to an installed executable; never disable managed policy.
This uses an offline in-memory DOM fixture and separate Python HTTP probes, not
browser HTTP navigation. It changes QA results/screenshots, so verify original
archive hashes first. No remote desktop or Cloudflare requests are made.
"""
from pathlib import Path
import json, urllib.request, urllib.error, os, shutil
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
shots=root/'qa/screenshots'; shots.mkdir(parents=True,exist_ok=True)
results=[]
def passed(name,detail=''):
 results.append({'test':name,'status':'PASS','detail':detail})
with sync_playwright() as pw:
 executable=os.environ.get('RDG_TEST_CHROMIUM') or shutil.which('chromium') or pw.chromium.executable_path
 browser=pw.chromium.launch(executable_path=executable,headless=True)
 version=browser.version
 page=browser.new_page(viewport={'width':1440,'height':1024},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 # Offline DOM render of authored sources: no navigation or policy override.
 html=(root/'prototype/index.html').read_text()
 css=(root/'prototype/styles.css').read_text()
 engine=(root/'reference/keyboard-state.mjs').read_text().replace('export const ', 'const ').replace('export function ', 'function ').replace('export class ', 'class ')
 app=(root/'prototype/app.mjs').read_text().replace("import {KeyboardState} from '/reference/keyboard-state.mjs';",'')
 html=html.replace('<link rel="stylesheet" href="/prototype/styles.css">','<style>'+css+'</style>')
 html=html.replace('<script type="module" src="/prototype/app.mjs"></script>','<script type="module">'+engine+'\n'+app+'</script>')
 page.set_content(html,wait_until='load')
 page.wait_for_function("document.getElementById('mappingList').children.length === 3")
 assert page.get_by_role('heading',name='A workspace within reach.').is_visible()
 assert page.get_by_text('Unverified',exact=True).count()==2
 passed('Honest prototype and unverified device labels')
 page.screenshot(path=str(shots/'01-devices-desktop.png'),full_page=True)
 page.locator('.open-workspace').first.click()
 assert page.locator('#workspace').is_visible()
 assert page.get_by_text('Not connected',exact=True).is_visible()
 passed('Workspace navigation does not claim a live connection')
 page.locator('#profile').select_option('windows-alt-command')
 assert 'Opt-in for left Alt' in page.locator('#profileDescription').inner_text()
 page.locator('#inputSurface').focus()
 # Browser-dispatched DOM input verifies our adapter, NOT physical OS shortcut delivery.
 page.locator('#inputSurface').dispatch_event('keydown',{'key':'Alt','code':'AltLeft','altKey':True,'bubbles':True,'cancelable':True})
 assert 'DOWN  CommandLeft' in page.locator('#eventLog').inner_text()
 page.locator('#inputSurface').dispatch_event('keyup',{'key':'Alt','code':'AltLeft','bubbles':True})
 assert 'UP    CommandLeft' in page.locator('#eventLog').inner_text()
 passed('Synthetic LeftAlt profile emits paired logical Command events','Not Windows-to-Mac interoperability')
 page.locator('#clearBtn').click()
 page.locator('#inputSurface').focus()
 page.locator('#inputSurface').dispatch_event('keydown',{'key':'Control','code':'ControlLeft','ctrlKey':True,'bubbles':True,'cancelable':True})
 page.locator('#inputSurface').dispatch_event('keyup',{'key':'Control','code':'ControlLeft','bubbles':True})
 assert 'ControlLeft' in page.locator('#eventLog').inner_text()
 assert 'CommandLeft' not in page.locator('#eventLog').inner_text()
 passed('Control is not remapped by the prototype')
 page.locator('#clearBtn').click()
 latch=page.locator('[data-latch="CommandLeft"]')
 latch.click();assert latch.get_attribute('aria-pressed')=='true'
 page.locator('#releaseBtn').click();assert latch.get_attribute('aria-pressed')=='false'
 passed('Virtual modifier latch releases')
 page.locator('[data-chord="CommandLeft,c"]').click()
 trace=page.locator('#eventLog').inner_text()
 assert 'DOWN  c' in trace and 'UP    c' in trace
 passed('Virtual shortcut produces local paired transitions')
 page.locator('#clearBtn').click()
 page.locator('#inputSurface').focus()
 page.keyboard.press('Tab')
 assert not page.locator('#inputSurface').evaluate('(el)=>el===document.activeElement')
 passed('Tab can leave the keyboard tester')
 page.locator('#notice').evaluate('(el)=>el.hidden=true')
 page.screenshot(path=str(shots/'02-workspace-desktop.png'),full_page=True)
 for width,height in [(390,844),(430,932),(768,1024),(1440,1024)]:
  page.set_viewport_size({'width':width,'height':height})
  for view in ['workspace','overview']:
   if view=='overview': page.locator('#endBtn').click()
   dims=page.evaluate('({w:innerWidth,scroll:document.documentElement.scrollWidth})')
   assert dims['scroll']<=dims['w'],(width,view,dims)
   passed(f'No horizontal overflow: {view} {width}x{height}',str(dims))
   if width==390:page.screenshot(path=str(shots/f'0{3 if view=="overview" else 4}-{view}-mobile.png'),full_page=True)
  if width!=1440:page.locator('.open-workspace').first.click()
 assert page.locator('#eventLog').inner_text()=='No events yet.'
 passed('End preview clears local trace')
 page.locator('#helpBtn').click();assert page.locator('#helpPanel').is_visible()
 page.locator('#closeHelp').click();assert page.locator('#helpPanel').is_hidden()
 passed('Help opens and closes')
 assert not errors,errors
 passed('No JavaScript page errors',json.dumps(errors))
 # Static check only: opaque-origin offline fixture has no application origin storage.
 assert all(token not in app for token in ['localStorage','sessionStorage','indexedDB','serviceWorker.register','fetch('])
 passed('Prototype source has no persistence or network calls','Static source check, not an application-origin storage audit')
 browser.close()
# Explicit preview-server boundary probes.
for path,status in [('/AGENTS.md',404),('/deployment/.env.example',404),('/api/devices',404),('/prototype/?token=example',404)]:
 try:urllib.request.urlopen('http://127.0.0.1:4173'+path);got=200
 except urllib.error.HTTPError as e:got=e.code
 assert got==status,(path,got)
 passed('Preview refuses nonallowlisted path '+path,str(got))
for method,status in [('POST',405)]:
 try:urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4173/prototype/',method=method));got=200
 except urllib.error.HTTPError as e:got=e.code
 assert got==status
 passed('Preview refuses '+method,str(got))
try:urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:4173/prototype/',headers={'Host':'evil.example'}));got=200
except urllib.error.HTTPError as e:got=e.code
assert got==403;passed('Preview rejects unexpected Host',str(got))
report={'scope':'LOCAL_UI: in-memory HTML/CSS/module render in Linux Chromium, plus separate Python HTTP boundary probes. Browser localhost navigation was blocked by environment policy; original policy unchanged. Not HTTP browser integration, Safari, Windows or live Mac acceptance','browser':version,'tests':results,'pass':len(results),'fail':0}
(root/'qa/prototype-browser-results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'browser':version,'pass':len(results),'screenshots':list(p.name for p in shots.iterdir())},indent=2))

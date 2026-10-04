import {mkdir} from 'node:fs/promises';
import {openWorkspaceControls,endWorkspace} from './workspace-controls-helper.mjs';

/** Production viewer against local simulated APIs/Guacamole only. */
export async function checkWorkspaceUI({page,check,pass}){
 const record=(test,metadata={})=>pass(test,{scope:'LOCAL_SIDEBAR_UI_FIXTURE',simulatedAPI:true,simulatedGuacamole:true,realMac:false,...metadata});
 const state=value=>page.waitForFunction(value=>document.getElementById('status').dataset.state===value,value);
 const paused=async()=>check((await page.locator('#inputStatus').innerText()).includes('paused'),'SIDEBAR_INPUT_NOT_PAUSED');
 const focus=id=>page.waitForFunction(id=>document.activeElement.id===id,id);
 const geometry=()=>page.evaluate(()=>{const rect=id=>{const {x,y,width,height,right,bottom}=document.getElementById(id).getBoundingClientRect();return {x,y,width,height,right,bottom};};return {viewport:{width:innerWidth,height:innerHeight},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},surface:rect('surface'),trigger:rect('moreBtn'),panel:rect('workspaceMenu'),header:document.querySelector('header.bar').getBoundingClientRect().height,heading:document.querySelector('#workspaceMenu .dialog-heading').getBoundingClientRect().toJSON(),footer:document.querySelector('#workspaceMenu .workspace-panel-footer').getBoundingClientRect().toJSON()};});
 const closed=async()=>{check(!await page.locator('#workspaceMenu').isVisible(),'SIDEBAR_NOT_CLOSED');check(await page.locator('#moreBtn').getAttribute('aria-expanded')==='false','SIDEBAR_EXPANDED_STALE');};
 await closed();await state('CONNECTED');await mkdir('output/playwright',{recursive:true});
 const sizes=[{width:320,height:850},{width:390,height:850},{width:430,height:850},{width:768,height:850},{width:862,height:844},{width:1024,height:850},{width:1440,height:1000},{width:850,height:390},{width:320,height:390}];
 for(const theme of ['light','dark']){
  await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();await page.locator('#themePreference').selectOption(theme);await page.locator('#preferencesDialog .dialog-footer [data-close]').click();await page.locator('#closeWorkspacePanel').click();
  for(const viewport of sizes){
   await page.setViewportSize(viewport);await page.evaluate(()=>document.fonts.ready);const before=await geometry(),suffix=theme+'_'+viewport.width+'x'+viewport.height;
   check(before.header===0&&before.surface.x===0&&before.surface.y===0&&before.surface.width===viewport.width&&before.surface.height===viewport.height,'SIDEBAR_DESKTOP_NOT_FULL_VIEWPORT_'+suffix);
   check(before.document.width<=viewport.width+1&&before.document.height<=viewport.height+1,'SIDEBAR_DOCUMENT_OVERFLOW_'+suffix);
   check(before.trigger.width>=44&&before.trigger.height>=44&&before.trigger.right<=viewport.width+1&&before.trigger.x>=0,'SIDEBAR_TRIGGER_BOUNDS_'+suffix);
   await openWorkspaceControls(page);await paused();const after=await geometry();
   check(JSON.stringify(before.surface)===JSON.stringify(after.surface),'SIDEBAR_OPEN_RESIZED_DESKTOP_'+suffix);
   check(after.panel.x>=0&&after.panel.right<=viewport.width+1&&after.panel.height<=viewport.height+1,'SIDEBAR_PANEL_BOUNDS_'+suffix);
   check(after.panel.width<=322,'SIDEBAR_COMPACT_WIDTH_'+suffix);
   check(await page.locator('#end').isVisible()&&await page.locator('#closeWorkspacePanel').isVisible(),'SIDEBAR_SAFETY_ACTIONS_HIDDEN_'+suffix);
   const scroll=await page.evaluate(()=>{const middle=document.querySelector('.workspace-panel-content');const points=[0,(middle.scrollHeight-middle.clientHeight)/2,middle.scrollHeight];return points.map(point=>{middle.scrollTop=point;return {top:middle.scrollTop,heading:document.querySelector('#workspaceMenu .dialog-heading').getBoundingClientRect().toJSON(),footer:document.querySelector('#workspaceMenu .workspace-panel-footer').getBoundingClientRect().toJSON(),panel:document.getElementById('workspaceMenu').scrollTop};});});
   if(viewport.height===390)check(scroll.at(-1).top>0,'SIDEBAR_LANDSCAPE_CONTENT_NOT_SCROLLABLE_'+suffix);
   check(scroll.every(p=>p.panel===0&&p.heading.top>=0&&p.footer.bottom<=viewport.height+1),'SIDEBAR_SCROLL_MOVES_SAFETY_CONTROLS_'+suffix);
   check(scroll.every(p=>p.heading.top===scroll[0].heading.top&&p.footer.top===scroll[0].footer.top),'SIDEBAR_HAS_TWO_SCROLL_OWNERS_'+suffix);
   if(viewport.width===390||viewport.width===1440){await page.locator('.workspace-panel-content').evaluate(node=>node.scrollTop=0);await page.screenshot({path:'output/playwright/sidebar-'+theme+'-'+viewport.width+'-open.png'});}
   await page.keyboard.press('Escape');await closed();await focus('moreBtn');await paused();
   if(viewport.width===1440&&theme==='dark')await page.screenshot({path:'output/playwright/sidebar-desktop-closed.png'});
  }
 }
 record('Full viewport desktop and modal controls fit nine mobile/desktop sizes in both themes without reflow; only panel content scrolls',{viewports:sizes,themes:['light','dark'],realSafeAreas:false});
 await page.setViewportSize({width:862,height:844});
 // A resize pauses input by design; let its handler run before focusing, or the status can read paused.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.locator('.capture').focus();check((await page.locator('#inputStatus').innerText()).includes('active'),'SIDEBAR_CAPTURE_NOT_ACTIVE');
 await page.locator('#moreBtn').focus();await page.keyboard.press('Enter');await focus('closeWorkspacePanel');await paused();
 for(let i=0;i<24;i++){await page.keyboard.press('Tab');check(await page.evaluate(()=>document.getElementById('workspaceMenu').contains(document.activeElement)),'SIDEBAR_FOCUS_ESCAPED_MODAL');}
 await page.keyboard.press('Escape');await closed();await focus('moreBtn');await paused();await page.keyboard.press('Space');await focus('closeWorkspacePanel');
 await page.mouse.click(20,200);await closed();await focus('moreBtn');await paused();
 record('Enter/Space open the modal, Tab stays inside, Escape/backdrop restore local focus and input stays paused');
 await openWorkspaceControls(page);await page.locator('#scale').selectOption('actual');await paused();await page.locator('#scale').selectOption('fit');
 await page.locator('#workspaceProfileBtn').click();await page.locator('#keysDialog').waitFor({state:'visible'});await page.locator('#liveProfile').selectOption('windows-alt-command');await page.keyboard.press('Escape');await focus('workspaceProfileBtn');check(await page.locator('#workspaceMenu').isVisible(),'SIDEBAR_NESTED_ESCAPE_CLOSED_PARENT');
 await page.locator('#workspaceDiagnostics').click();await page.locator('#diagnosticsDialog').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('diagnostics').textContent.includes('nodeId'));await page.keyboard.press('Escape');await focus('workspaceDiagnostics');
 await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('zh-CN');await page.keyboard.press('Escape');check(await page.locator('#workspacePanelTitle').innerText()==='远控工具','SIDEBAR_ZH_TITLE_MISSING');await page.setViewportSize({width:320,height:390});const originalName=await page.locator('#workspaceName').textContent();await page.locator('#workspaceName').evaluate(node=>node.textContent='Synthetic long label fixture '+('very long desktop name '.repeat(20)));const localized=await geometry();check(localized.panel.right<=321&&localized.heading.height<200&&localized.footer.bottom<=391,'SIDEBAR_LOCALIZED_LONG_LABEL_BREAKS_CONTROLS');check(await page.locator('#closeWorkspacePanel').isVisible()&&await page.locator('#end').isVisible(),'SIDEBAR_LONG_LABEL_HIDES_EXIT');await page.locator('#workspaceName').evaluate((node,text)=>node.textContent=text,originalName);await page.setViewportSize({width:862,height:844});await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('en');await page.keyboard.press('Escape');await paused();
 record('Scale, keyboard, diagnostics and language dialogs retain the parent controls panel and release input');
 await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);await closed();check(await page.locator('#moreBtn').isVisible(),'SIDEBAR_FULLSCREEN_ENTRY_HIDDEN');await openWorkspaceControls(page);check(await page.locator('#end').isVisible(),'SIDEBAR_FULLSCREEN_END_HIDDEN');await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===null);await closed();
 record('Native Chromium fullscreen retains the overlay entry and reachable End action',{nativeFullscreen:true,realSafari:false});
 await endWorkspace(page);await state('READY');await closed();check(await page.locator('#logout').evaluate(node=>node.parentElement.id)==='launcherAccount','SIDEBAR_END_ACCOUNT_NOT_RETURNED');check(await page.locator('header.bar').isVisible()&&await page.locator('#preferencesBtn').isVisible(),'SIDEBAR_END_LAUNCHER_CONTROLS_NOT_RETURNED');
 await page.locator('#mode').selectOption('view');await page.locator('#clipboardConsent').check();await page.locator('#connect').click();await state('CONNECTED');await closed();await openWorkspaceControls(page);check(await page.locator('#keysBtn').isDisabled()&&await page.locator('#clipboardBtn').isDisabled(),'SIDEBAR_VIEW_INPUT_ENABLED');check(await page.locator('#inputStatus').innerText()==='View only','SIDEBAR_VIEW_STATUS_INCORRECT');
 record('End returns shared controls to launcher; view-only reconnect keeps input and clipboard disabled');
 await page.locator('#logout').click();await state('AUTH_REQUIRED');await closed();check(await page.locator('#surface canvas').count()===0&&await page.locator('#launcher').isVisible(),'SIDEBAR_SIGNOUT_PRIVATE_UI_REMAINS');
 record('Sign-out closes controls and clears the simulated display');
}

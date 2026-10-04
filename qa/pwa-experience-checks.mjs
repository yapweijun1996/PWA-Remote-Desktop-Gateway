import {release} from '../web/src/release.mjs';
import {openWorkspaceControls} from './workspace-controls-helper.mjs';
import {mkdir} from 'node:fs/promises';

/** Local UI fixtures; neither generated screenshots nor installed mode prove real Mac/iOS acceptance. */
export async function checkPwaExperience({page,check,pass,connected=false}) {
  const record=(test,details={})=>pass(test,{scope:'LOCAL_PWA_UI_FIXTURE',realMac:false,realIOS:false,...details});
  await mkdir('output/playwright',{recursive:true});
  if(!connected){
    check(await page.locator('#connect').isDisabled(),'PWA_CONSENT_NOT_REQUIRED_BY_UI');
    check((await page.locator('#versionLabel').innerText()).includes('v'+release.version),'PWA_CURRENT_VERSION_MISSING');
  }
  const initial=await page.evaluate(()=>({state:document.getElementById('status').dataset.state,canvas:document.querySelectorAll('#surface canvas').length,locale:document.documentElement.lang}));
  await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();
  await page.locator('#preferencesDialog').waitFor({state:'visible'});
  check(await page.locator('#themePreference').isVisible()&&await page.locator('#languagePreference').isVisible(),'PWA_PREFERENCES_NOT_VISIBLE');
  for(const theme of ['light','dark']){
    await page.locator('#themePreference').selectOption(theme);
    const surface=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,meta:[...document.querySelectorAll('meta[name="theme-color"]')].map(n=>n.content),background:getComputedStyle(document.body).backgroundColor}));
    check(surface.theme===theme&&surface.scheme===theme&&surface.meta.every(value=>value===(theme==='light'?'#f3f6f5':'#111d23')),'PWA_THEME_CHROME_MISMATCH');
  }
  await page.locator('#themePreference').selectOption('system');await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  record('Light, dark and live system theme changes keep opaque chrome and controls coherent');
  await page.locator('#languagePreference').selectOption('zh-CN');
  check(await page.locator('html').getAttribute('lang')==='zh-CN','PWA_DOCUMENT_LANGUAGE_MISSING');
  check(await page.locator('#preferencesTitle').innerText()==='应用偏好','PWA_CHINESE_DIALOG_MISSING');
  check((await page.locator('#profile option[value="mac-native"]').innerText()).includes('原生'),'PWA_CHINESE_PROFILE_MISSING');
  if(connected){
    check((await page.locator('#inputStatus').innerText()).includes('暂停'),'PWA_LOCALE_CHANGE_NOT_PAUSING_INPUT');
    check(await page.locator('#workspace').isVisible()&&await page.locator('#surface canvas').count()===initial.canvas,'PWA_LOCALE_CHANGE_ENDED_DESKTOP');
  }
  await page.locator('#preferencesDialog .dialog-footer [data-close]').click();
  check(await page.evaluate(()=>document.activeElement.id==='preferencesBtn'),'PWA_PREFERENCES_FOCUS_NOT_RESTORED');
  for(const width of [320,390,430,713,768,1024,1440]){
    await page.setViewportSize({width,height:850});
    const size=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
    check(size.width<=size.viewport+1,'PWA_CHINESE_HORIZONTAL_OVERFLOW_'+width);
    await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();
    const rect=await page.locator('#preferencesDialog').boundingBox();
    check(rect&&rect.x>=0&&rect.x+rect.width<=width+1,'PWA_DIALOG_OUTSIDE_VIEWPORT_'+width);
    await page.locator('#preferencesDialog .dialog-footer [data-close]').click();
  }
  record('Simplified Chinese launcher and preferences fit phone, tablet and desktop; language changes preserve session ownership');
  if(!connected){
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'output/playwright/pwa-launcher-dark-zh.png',fullPage:true});
    await page.setViewportSize({width:390,height:850});
    await page.screenshot({path:'output/playwright/pwa-launcher-mobile-zh.png',fullPage:true});
    await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();
    await page.screenshot({path:'output/playwright/pwa-preferences-mobile-zh.png',fullPage:true});
    await page.keyboard.press('Escape');
    check(!await page.locator('#preferencesDialog').isVisible(),'PWA_PREFERENCES_ESCAPE_FAILED');
    await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('en');await page.locator('#themePreference').selectOption('light');
    await page.locator('#preferencesDialog .dialog-footer [data-close]').click();await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'output/playwright/pwa-launcher-light-en.png',fullPage:true});
    await page.reload();
    await page.waitForFunction(()=>document.getElementById('status').dataset.state==='READY');
    check(await page.locator('html').getAttribute('lang')==='en'&&await page.evaluate(()=>document.documentElement.dataset.theme==='light'),'PWA_PREFERENCE_RESTORE_FAILED');
    const stored=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key==='rdg:theme'||key==='rdg:locale').map(key=>[key,localStorage.getItem(key)])));
    check(stored['rdg:theme']==='light'&&stored['rdg:locale']==='en','PWA_PREFERENCES_STORAGE_MISMATCH');
    record('Preferences persist only nonsecret theme/locale values and restore after reload');
  }else{
    await openWorkspaceControls(page);await page.locator('#preferencesBtn').click();await page.locator('#languagePreference').selectOption('en');await page.locator('#preferencesDialog .dialog-footer [data-close]').click();
    check(await page.locator('#workspace').isVisible()&&await page.locator('#surface canvas').count()===initial.canvas,'PWA_PREFERENCE_RESET_ENDED_DESKTOP');
    check(await page.locator('#status').innerText()==='CONNECTED','PWA_PREFERENCES_CHANGED_CONNECTION_STATE');
    await page.locator('#closeWorkspacePanel').click();
    record('Theme and locale controls release input without terminating or recapturing the active fixture desktop');
  }
}

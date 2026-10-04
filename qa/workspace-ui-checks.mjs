import {mkdir} from 'node:fs/promises';

/** Production layout against simulated loopback APIs/Guacamole, never real desktop evidence. */
export async function checkWorkspaceUI({page,check,pass}) {
  const scope='LOCAL_UI_ROUTE_FIXTURE';
  const record=(test,metadata={})=>pass(test,{scope,simulatedAPI:true,simulatedGuacamole:true,realMac:false,...metadata});
  const waitState=value=>page.waitForFunction(value=>document.getElementById('status')?.textContent===value,value);
  const waitFocus=id=>page.waitForFunction(id=>document.activeElement?.id===id,id);
  const paused=async()=>check((await page.locator('#inputStatus').innerText()).includes('paused'),'WORKSPACE_INPUT_NOT_PAUSED');
  const menuClosed=async()=>{
    check(!await page.locator('#workspaceMenu').isVisible(),'WORKSPACE_MENU_NOT_CLOSED');
    check(await page.locator('#moreBtn').getAttribute('aria-expanded')==='false','WORKSPACE_MENU_EXPANDED_STATE_STALE');
  };
  const openMenu=async()=>{
    await page.locator('#moreBtn').click();
    check(await page.locator('#workspaceMenu').isVisible(),'WORKSPACE_MENU_DID_NOT_OPEN');
    check(await page.locator('#moreBtn').getAttribute('aria-expanded')==='true','WORKSPACE_MENU_EXPANDED_STATE_MISSING');
    await waitFocus('scale');
  };
  const geometry=()=>page.evaluate(()=>{
    const rectangle=node=>{
      const {x,y,width,height,bottom,right}=node.getBoundingClientRect();
      return {x,y,width,height,bottom,right};
    };
    return {
      viewport:{width:innerWidth,height:innerHeight},
      document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      header:rectangle(document.querySelector('header.bar')),
      surface:rectangle(document.getElementById('surface')),
      actions:['keysBtn','clipboardBtn','moreBtn','release','end'].map(id=>({id,...rectangle(document.getElementById(id))})),
      oldToolbar:document.querySelectorAll('#workspace .toolbar').length
    };
  });
  const assertGeometry=async(viewport,compact=false)=>{
    await page.setViewportSize(viewport);
    await page.evaluate(()=>document.fonts.ready);
    const measurements=await geometry();
    const suffix=viewport.width+'x'+viewport.height;
    check(measurements.document.width<=viewport.width+1,'WORKSPACE_HORIZONTAL_OVERFLOW_'+suffix);
    check(measurements.document.height<=viewport.height+1,'WORKSPACE_VERTICAL_OVERFLOW_'+suffix);
    check(measurements.surface.height>=viewport.height*.55,'WORKSPACE_SURFACE_TOO_SHORT_'+suffix);
    check(measurements.surface.width>=viewport.width-2,'WORKSPACE_SURFACE_TOO_NARROW_'+suffix);
    check(measurements.surface.bottom<=viewport.height+1,'WORKSPACE_SURFACE_OUTSIDE_VIEWPORT_'+suffix);
    check(measurements.oldToolbar===0,'WORKSPACE_DUPLICATE_TOOLBAR');
    if(compact)check(measurements.header.height<=85,'WORKSPACE_COMPACT_HEADER_TOO_TALL');
    for(const action of measurements.actions){
      check(action.width>=44&&action.height>=44,'WORKSPACE_ACTION_BELOW_44PX_'+action.id+'_'+suffix);
      check(action.x>=0&&action.right<=viewport.width+1&&action.y>=0&&action.bottom<=viewport.height+1,'WORKSPACE_ACTION_OUTSIDE_VIEWPORT_'+action.id+'_'+suffix);
    }
    return measurements;
  };

  check(await page.locator('#status').innerText()==='CONNECTED','WORKSPACE_UI_REQUIRES_CONNECTED_FIXTURE');
  check(await page.locator('#workspace').isVisible(),'WORKSPACE_UI_REQUIRES_VISIBLE_WORKSPACE');
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await mkdir('output/playwright',{recursive:true});
  const requested=await assertGeometry({width:862,height:844},true);
  await page.screenshot({path:'output/playwright/workspace-refined-862.png',fullPage:false});
  record('Requested 862x844 workspace uses one compact header and visible 44px safety controls',{viewport:requested.viewport,headerHeight:requested.header.height,surfaceHeight:requested.surface.height});

  const viewports=[{width:320,height:850},{width:390,height:850},{width:430,height:850},{width:760,height:850},{width:761,height:850},{width:768,height:850},{width:780,height:850},{width:800,height:850},{width:820,height:850},{width:840,height:850},{width:841,height:850},{width:1024,height:850},{width:1440,height:1000},{width:850,height:390}];
  const measurements=[];
  for(const viewport of viewports){
    measurements.push(await assertGeometry(viewport));
    if(viewport.width===390)await page.screenshot({path:'output/playwright/workspace-refined-mobile.png',fullPage:false});
  }
  record('Connected layout fits mobile portrait, landscape, tablet and desktop without document overflow',{viewports:measurements.map(({viewport,header,surface})=>({...viewport,headerHeight:header.height,surfaceHeight:surface.height})),realSafeAreaVerified:false});

  const originalText=await page.evaluate(()=>({name:document.getElementById('workspaceName').textContent,input:document.getElementById('inputStatus').textContent}));
  // Synthetic DOM text stresses layout without replacing server-owned device configuration.
  await page.evaluate(()=>{
    document.getElementById('workspaceName').textContent='Synthetic layout fixture: '+('Long personal desktop label '.repeat(12));
    document.getElementById('inputStatus').textContent='Synthetic layout fixture: '+('Input paused; click the desktop to resume. '.repeat(12));
  });
  for(const viewport of [{width:862,height:844},...viewports])await assertGeometry(viewport,viewport.width===862);
  await page.evaluate(text=>{document.getElementById('workspaceName').textContent=text.name;document.getElementById('inputStatus').textContent=text.input;},originalText);
  record('Synthetic long device and input labels preserve action visibility and viewport bounds',{syntheticDOMText:true});

  await page.setViewportSize({width:862,height:844});
  await page.locator('.capture').focus();
  check((await page.locator('#inputStatus').innerText()).includes('active'),'WORKSPACE_CAPTURE_FOCUS_DID_NOT_ACTIVATE');
  await page.locator('#moreBtn').focus();
  await page.keyboard.press('Enter');
  check(await page.locator('#workspaceMenu').isVisible(),'WORKSPACE_MENU_ENTER_DID_NOT_OPEN');
  await waitFocus('scale');
  await paused();
  await page.screenshot({path:'output/playwright/workspace-refined-menu.png',fullPage:false});
  await page.keyboard.press('Escape');
  await menuClosed();await waitFocus('moreBtn');await paused();
  await page.keyboard.press('Space');
  check(await page.locator('#workspaceMenu').isVisible(),'WORKSPACE_MENU_SPACE_DID_NOT_OPEN');
  await waitFocus('scale');
  await page.keyboard.press('Escape');await menuClosed();await waitFocus('moreBtn');
  record('Workspace disclosure supports Enter, Space and Escape with focus restoration and paused input',{inputPayloadVerified:false});

  await openMenu();
  await page.locator('#scale').selectOption('actual');
  check(await page.locator('#scale').inputValue()==='actual','WORKSPACE_ACTUAL_SCALE_SELECTION_FAILED');
  await paused();
  await page.locator('#scale').selectOption('fit');
  check(await page.locator('#scale').inputValue()==='fit','WORKSPACE_FIT_SCALE_SELECTION_FAILED');
  await page.locator('#workspaceDiagnostics').click();
  await page.locator('#diagnosticsDialog').waitFor({state:'visible'});
  await menuClosed();
  await page.waitForFunction(()=>{try{return typeof JSON.parse(document.getElementById('diagnostics').textContent).nodeId==='string';}catch{return false;}});
  await page.locator('#diagnosticsDialog [data-close]').click();await waitFocus('moreBtn');await paused();
  await openMenu();await page.locator('#workspaceProfileBtn').click();
  await page.locator('#keysDialog').waitFor({state:'visible'});await menuClosed();
  await page.locator('#liveProfile').selectOption('windows-alt-command');
  check(await page.locator('#profile').inputValue()==='windows-alt-command','WORKSPACE_PROFILE_SELECTION_NOT_SHARED');
  check((await page.locator('#workspaceProfile').innerText()).includes('Left Alt'),'WORKSPACE_PROFILE_LABEL_NOT_UPDATED');
  await page.locator('#keysDialog [data-close]').click();await waitFocus('moreBtn');await paused();
  record('Scale selection and workspace diagnostics/profile dialogs preserve paused input and return focus',{actualScaleRenderingVerified:false,remoteKeyboardMappingVerified:false});

  await openMenu();await page.locator('#workspaceName').click();await menuClosed();
  check(await page.evaluate(()=>!document.getElementById('workspaceMenu').contains(document.activeElement)&&!document.activeElement?.classList.contains('capture')),'WORKSPACE_OUTSIDE_DISMISS_LEFT_HIDDEN_OR_REMOTE_FOCUS');
  await paused();
  record('Outside click dismisses workspace options without resuming remote input');

  check(await page.evaluate(()=>document.fullscreenEnabled),'WORKSPACE_NATIVE_FULLSCREEN_UNSUPPORTED');
  await openMenu();await page.locator('#fullscreen').click();
  await page.waitForFunction(()=>Boolean(document.fullscreenElement));
  check(await page.evaluate(()=>document.fullscreenElement===document.documentElement),'WORKSPACE_FULLSCREEN_EXCLUDES_HEADER');
  await menuClosed();
  check(await page.locator('header.bar').isVisible()&&await page.locator('#release').isVisible()&&await page.locator('#end').isVisible(),'WORKSPACE_FULLSCREEN_SAFETY_CONTROLS_HIDDEN');
  const fullscreenGeometry=await geometry();
  check(fullscreenGeometry.actions.every(action=>action.width>=44&&action.height>=44&&action.right<=fullscreenGeometry.viewport.width+1&&action.bottom<=fullscreenGeometry.viewport.height+1),'WORKSPACE_FULLSCREEN_ACTION_OUTSIDE_VIEWPORT');
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>document.fullscreenElement===null);await paused();
  record('Native Chromium fullscreen contains the compact safety header',{nativeFullscreen:true,realSafari:false});

  await openMenu();await page.locator('#end').click();await waitState('READY');
  await page.waitForLoadState('networkidle');await menuClosed();
  check(!await page.locator('#workspace').isVisible()&&await page.locator('#surface canvas').count()===0,'WORKSPACE_END_DID_NOT_CLEAR_DISPLAY');
  check(await page.locator('#logout').evaluate(button=>button.parentElement.id)==='launcherAccount','WORKSPACE_END_DID_NOT_RESTORE_LAUNCHER_SIGNOUT');
  check(await page.locator('#logout').isVisible(),'WORKSPACE_LAUNCHER_SIGNOUT_UNAVAILABLE');
  await page.locator('#mode').selectOption('view');
  await page.locator('#clipboardConsent').check();
  await page.locator('#connect').click();await waitState('CONNECTED');await menuClosed();
  check(await page.locator('#keysBtn').isDisabled()&&await page.locator('#clipboardBtn').isDisabled(),'WORKSPACE_VIEW_MODE_INPUT_CONTROLS_ENABLED');
  check(await page.locator('#inputStatus').innerText()==='View only','WORKSPACE_VIEW_MODE_STATUS_INCORRECT');
  check(await page.locator('#logout').evaluate(button=>button.parentElement.id)==='workspaceAccount','WORKSPACE_RECONNECT_SIGNOUT_NOT_IN_OPTIONS');
  record('Disconnect resets options and returns signout to the launcher; view-only reconnect disables keys and clipboard',{clipboardConsentSelected:true,remoteInputPayloadVerified:false});

  await openMenu();check(await page.locator('#logout').isVisible(),'WORKSPACE_SIGNOUT_NOT_REACHABLE');
  await page.locator('#logout').click();await waitState('AUTH_REQUIRED');await menuClosed();
  check(await page.locator('#launcher').isVisible()&&!await page.locator('#workspace').isVisible(),'WORKSPACE_SIGNOUT_DID_NOT_RETURN_TO_LAUNCHER');
  check(await page.locator('#logout').evaluate(button=>button.parentElement.id)==='launcherAccount','WORKSPACE_SIGNOUT_CONTROL_NOT_RETURNED_TO_LAUNCHER');
  check(await page.locator('#surface canvas').count()===0&&!await page.locator('#logout').isVisible(),'WORKSPACE_SIGNOUT_DID_NOT_CLEAR_PRIVATE_UI');
  record('Workspace signout clears the simulated session display and resets launcher layout',{realRevocationVerified:false});
}

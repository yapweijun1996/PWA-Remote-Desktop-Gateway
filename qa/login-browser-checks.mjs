/** Actual HTTPS Chromium navigation against signed, disposable local enrollment fixtures. */
import https from 'node:https';import http from 'node:http';import {writeArtifact} from '../scripts/atomic-artifact.mjs';
import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),directory=process.argv[2],edgePort=Number(process.argv[3]);
if(!directory||!Number.isInteger(edgePort)||edgePort<1024||edgePort>65535)throw new Error('LOGIN_BROWSER_FIXTURE_ARGUMENTS_REFUSED');
const {chromium}=require(process.env.RDG_PLAYWRIGHT_MODULE??'playwright');
const tls={key:await readFile(directory+'/key.pem'),cert:await readFile(directory+'/cert.pem')};
const fixture=JSON.parse(await readFile(directory+'/proxy.json','utf8'));
if(!Number.isInteger(fixture.port)||typeof fixture.assertion!=='string')throw new Error('LOGIN_BROWSER_FIXTURE_CONFIG_REFUSED');
const edgeOrigin='https://127.0.0.1:'+edgePort,results=[],observations=[],manifestRequests=[];
const artifactFile=process.env.RDG_LOGIN_BROWSER_MANIFEST_RESULTS==='true'?'qa/implementation/manifest-browser-results.json':'qa/implementation/login-browser-results.json';
let priorNullFormFailureObserved=false;
try{const prior=JSON.parse(await readFile('qa/implementation/login-browser-results.json','utf8'));priorNullFormFailureObserved=prior.scope==='LOCAL_HTTPS_LOGIN_BROWSER_FIXTURE'&&prior.status==='FAIL'&&prior.loginObservations?.some(item=>item.method==='POST'&&item.origin==='NULL'&&item.status===403&&!item.deviceCookieIssued)===true;}catch{}
let edgeAssertionEnabled=true,browser,providerOrigin,providerReturnPost,webSockets=0,pageErrors=0,unexpectedConsoleErrors=0,expectedConsoleErrors=0,intentionalDenial=false,manifestBaselineActive=false,expectedManifestConsoleErrors=0,observedBrowserPages=0,gatewayCsp,manifestEvidence;
const exceptionCategories=[];
const observePage=(page,stage)=>{observedBrowserPages++;page.on('pageerror',error=>{
  pageErrors++;const names=['Error','TypeError','SecurityError','SyntaxError','ReferenceError','RangeError'];
  const source=error.stack?.match(/https:\/\/127\.0\.0\.1:\d+(\/assets\/[a-z-]+\.[a-f0-9]{16}\.(?:mjs|js)):(\d+):(\d+)/);
  const missing=error.message?.match(/^([A-Za-z_$][A-Za-z0-9_$]{0,40}) is not defined$/);
  const sandboxProperties=['cookie','localStorage','sessionStorage'].filter(property=>error.message?.includes("'"+property+"'"));
  const sandboxFlag=error.message?.includes("sandboxed and lacks the 'allow-same-origin' flag")===true;
  const utilitySource=/UtilityScript|InjectedScript|injectedScript/.test(error.stack??'');
  const opaquePostsAtError=observations.filter(item=>item.method==='POST'&&item.origin==='NULL').length;
  exceptionCategories.push({stage,name:names.includes(error.name)?error.name:'OTHER',sourceFilename:source?.[1]??'UNCLASSIFIED',line:source?Number(source[2]):null,category:missing?'UNDEFINED_IDENTIFIER':sandboxFlag?'SANDBOX_SAME_ORIGIN_FLAG_ABSENT':'UNCLASSIFIED',sandboxProperties,utilitySource,opaquePostsAtError,...(missing?{undefinedIdentifier:missing[1]}:{})});
});page.on('console',message=>{
  if(message.type()!=='error')return;
  if(manifestBaselineActive){
    const text=message.text();
    const expectedManifestCsp=stage==='MANIFEST_WITHOUT_ATTRIBUTE_BASELINE'&&/^Loading a manifest from /.test(text)&&text.includes('violates the following Content Security Policy directive')&&/manifest-src|default-src/.test(text);
    if(expectedManifestCsp)expectedManifestConsoleErrors++;else unexpectedConsoleErrors++;
  }else if(intentionalDenial)expectedConsoleErrors++;else unexpectedConsoleErrors++;
});};
const originCategory=origin=>origin===undefined?'ABSENT':origin==='null'?'NULL':origin===edgeOrigin?'SAME_ORIGIN':'CROSS_ORIGIN';
const edge=https.createServer(tls,(request,response)=>{
  const url=new URL(request.url,edgeOrigin),path=url.pathname;
  if(path==='/manifest-baseline'){
    if(!gatewayCsp){response.writeHead(503);response.end('MANIFEST_BROWSER_FIXTURE_CSP_UNAVAILABLE');return;}
    response.writeHead(200,{'Content-Type':'text/html; charset=UTF-8','Cache-Control':'no-store','Content-Security-Policy':gatewayCsp});
    response.end('<!doctype html><html lang="en"><head><title>Local manifest credential baseline</title><link rel="manifest" href="/manifest.webmanifest?fixture=without-credentials"></head><body>Local manifest credential baseline</body></html>');return;
  }
  const manifestObservation=path==='/manifest.webmanifest'?{case:url.searchParams.get('fixture')==='without-credentials'?'WITHOUT_ATTRIBUTE':'WITH_USE_CREDENTIALS',nativeManifestDestination:request.headers['sec-fetch-dest']==='manifest',cookieIncluded:/(?:^|;\s*)__Host-rdg-device=/.test(request.headers.cookie??''),status:0}:null;
  if(manifestObservation){
    manifestRequests.push(manifestObservation);
    if(!manifestObservation.cookieIncluded){manifestObservation.status=302;response.writeHead(302,{'Location':providerOrigin+'/manifest-auth-required','Cache-Control':'no-store'});response.end();return;}
  }
  const observation=path==='/login'?{method:request.method,queryPresent:request.url.includes('?'),origin:originCategory(request.headers.origin),status:0,referrerPolicy:'UNCLASSIFIED',deviceCookieIssued:false}:null;
  if(observation)observations.push(observation);
  const headers={...request.headers,host:'127.0.0.1:'+edgePort};delete headers['cf-access-jwt-assertion'];
  if(path==='/login'&&edgeAssertionEnabled)headers['cf-access-jwt-assertion']=fixture.assertion;
  const upstream=http.request({host:'127.0.0.1',port:fixture.port,path:request.url,method:request.method,headers},reply=>{
    if(path==='/'&&typeof reply.headers['content-security-policy']==='string')gatewayCsp=reply.headers['content-security-policy'];
    if(manifestObservation)manifestObservation.status=reply.statusCode;
    if(observation){observation.status=reply.statusCode;observation.referrerPolicy=reply.headers['referrer-policy']==='same-origin'?'SAME_ORIGIN':reply.headers['referrer-policy']==='no-referrer'?'NO_REFERRER':'UNCLASSIFIED';observation.deviceCookieIssued=(reply.headers['set-cookie']??[]).some(header=>header.startsWith('__Host-rdg-device=')&&!header.includes('Max-Age=0'));}
    response.writeHead(reply.statusCode,reply.headers);reply.pipe(response);
  });
  upstream.on('error',()=>{response.writeHead(503);response.end('LOGIN_BROWSER_FIXTURE_UPSTREAM_REFUSED');});request.pipe(upstream);
});
edge.on('upgrade',(_request,socket)=>{webSockets++;socket.end('HTTP/1.1 403 Denied\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');});
const fixedForm=(action,label)=>'<form method="post" action="'+action+'"><input type="hidden" name="nonce" value="'+'N'.repeat(43)+'"><button type="submit">'+label+'</button></form>';
const provider=https.createServer(tls,(request,response)=>{
  request.resume();response.setHeader('Cache-Control','no-store');
  if(request.method==='POST'&&request.url==='/return'){providerReturnPost={method:'POST',origin:originCategory(request.headers.origin),status:302};response.writeHead(302,{Location:edgeOrigin+'/login?benign=fixture'});response.end();return;}
  if(request.method!=='GET'){response.writeHead(405);response.end();return;}
  let body;
  if(request.url==='/hostile-post')body=fixedForm(edgeOrigin+'/login','Submit cross-origin fixture');
  else if(request.url==='/null-post'){response.setHeader('Referrer-Policy','no-referrer');body=fixedForm(edgeOrigin+'/login','Submit native null-origin fixture');}
  else body='<form method="post" action="/return"><button type="submit">Return from local provider</button></form>';
  response.writeHead(200,{'Content-Type':'text/html; charset=UTF-8'});response.end('<!doctype html><html lang="en"><title>Local login navigation fixture</title>'+body+'</html>');
});
const listen=(server,port)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
const check=(condition,label)=>{if(!condition)throw new Error(label);};
const pass=test=>results.push({test,status:'PASS',level:'LOCAL_HTTPS_LOGIN_BROWSER_FIXTURE'});
let cleanupPromise;
const cleanup=()=>cleanupPromise??=(async()=>{
  if(browser)await browser.close().catch(()=>{});
  for(const server of [provider,edge]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})();
const deadline=setTimeout(()=>{console.error(JSON.stringify({status:'FAIL',scope:'LOCAL_HTTPS_LOGIN_BROWSER_FIXTURE',reason:'LOGIN_BROWSER_DEADLINE',results}));void cleanup().finally(()=>process.exit(1));},45000);
process.once('SIGTERM',()=>{void cleanup().finally(()=>process.exit(124));});
try{
  await listen(edge,edgePort);await listen(provider,0);providerOrigin='https://127.0.0.1:'+provider.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.RDG_TEST_CHROMIUM,args:['--ignore-certificate-errors']});
  const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),page=await context.newPage();
  page.setDefaultTimeout(10000);observePage(page,'ENROLLMENT_AND_LANDING');
  await page.goto(providerOrigin);await page.getByRole('button',{name:'Return from local provider',exact:true}).click();
  await page.waitForURL(edgeOrigin+'/login');await page.getByRole('heading',{name:'Trust this browser',exact:true}).waitFor();
  const returnGet=observations.find(item=>item.method==='GET'&&item.queryPresent);
  check(providerReturnPost?.status===302&&returnGet?.status===303&&['ABSENT','NULL','CROSS_ORIGIN'].includes(returnGet.origin),'Actual cross-origin provider redirect canonicalizes; browsers may omit GET Origin');
  check(observations.some(item=>item.method==='GET'&&!item.queryPresent&&item.status===200&&item.referrerPolicy==='SAME_ORIGIN'),'Canonical login renders enrollment HTML');
  check(observations.every(item=>!item.deviceCookieIssued),'GET navigation never enrolls a trusted browser');
  check((await context.cookies(edgeOrigin)).filter(cookie=>cookie.name==='__Host-rdg-device').length===0,'Navigation does not set trusted cookie');
  pass('Cross-origin provider POST and 302 GET canonicalize a benign login query and render the signed enrollment form without issuing trust');
  await page.getByRole('button',{name:'Trust this browser and continue',exact:true}).click();
  await page.waitForURL(edgeOrigin+'/');await page.waitForFunction(()=>document.getElementById('status')?.textContent==='CREDENTIAL_REQUIRED');
  const issued=observations.find(item=>item.method==='POST'&&item.status===303&&item.deviceCookieIssued);
  check(issued?.origin==='SAME_ORIGIN','Only explicit same-origin enrollment issues browser trust');
  const trustedCookies=(await context.cookies(edgeOrigin)).filter(cookie=>cookie.name==='__Host-rdg-device');
  check(trustedCookies.length===1&&trustedCookies.every(cookie=>cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Lax'&&cookie.path==='/'&&cookie.domain==='127.0.0.1'&&Math.abs(cookie.expires-Date.now()/1000-31536000)<=60),'Protected host-only trusted cookie attributes');
  const devices=await page.evaluate(async()=>{const response=await fetch('/api/trusted-devices',{cache:'no-store'});if(response.status!==200)return -1;const body=await response.json();return Array.isArray(body.devices)?body.devices.length:-1;});
  check(devices===1&&await page.getByLabel('Screen Sharing VNC password',{exact:true}).isVisible(),'Real trusted store permits landing and application APIs without an edge assertion');
  pass('Explicit same-origin form enrollment sets a protected host-only cookie and the real trusted-store landing/API work without desktop authentication');
  // CDP invokes Chromium's native manifest manager; this is not a JavaScript fetch.
  check(await page.locator('link[rel="manifest"]').getAttribute('crossorigin')==='use-credentials','Production manifest explicitly includes credentials');
  const manifestSession=await context.newCDPSession(page),nativeManifest=await manifestSession.send('Page.getAppManifest');
  const parsedManifest=JSON.parse(nativeManifest.data??'null'),positiveRequests=manifestRequests.filter(item=>item.case==='WITH_USE_CREDENTIALS');
  check(Array.isArray(nativeManifest.errors)&&nativeManifest.errors.length===0&&parsedManifest?.name==='Remote Desktop Gateway'&&parsedManifest.start_url==='/'&&parsedManifest.scope==='/'&&Array.isArray(parsedManifest.icons)&&parsedManifest.icons.length===2,'Chromium recognizes the actual production manifest');
  check(positiveRequests.length>0&&positiveRequests.every(item=>item.nativeManifestDestination&&item.cookieIncluded&&item.status===200),'Native authenticated manifest requests include the fixture HttpOnly cookie and return 200');
  check(pageErrors===0&&unexpectedConsoleErrors===0,'Positive manifest page has no unexpected browser errors');
  await manifestSession.detach();
  pass('Native Chromium manifest request with use-credentials includes the actual fixture HttpOnly cookie and recognizes the production manifest at 200');
  manifestBaselineActive=true;
  const baselinePage=await context.newPage();observePage(baselinePage,'MANIFEST_WITHOUT_ATTRIBUTE_BASELINE');
  await baselinePage.addInitScript(()=>{globalThis.__rdgManifestPolicyViolations=0;document.addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='manifest-src'||event.effectiveDirective==='default-src')globalThis.__rdgManifestPolicyViolations++;});});
  await baselinePage.goto(edgeOrigin+'/manifest-baseline');
  const baselineSession=await context.newCDPSession(baselinePage);let baselineManifest,baselineProtocolRejected=false;
  try{baselineManifest=await baselineSession.send('Page.getAppManifest');}catch{baselineProtocolRejected=true;}
  await baselinePage.waitForFunction(()=>globalThis.__rdgManifestPolicyViolations>0);
  const baselineRequests=manifestRequests.filter(item=>item.case==='WITHOUT_ATTRIBUTE'),cspViolationCount=await baselinePage.evaluate(()=>globalThis.__rdgManifestPolicyViolations);
  const baselineNativeRejected=baselineProtocolRejected||!baselineManifest?.data||baselineManifest?.errors?.some(item=>item.critical===true)===true;
  check(baselineRequests.length>0&&baselineRequests.every(item=>item.nativeManifestDestination&&!item.cookieIncluded&&item.status===302)&&baselineNativeRejected&&cspViolationCount>0,'Missing crossorigin omits the available HttpOnly cookie; redirected native manifest is blocked by the unchanged gateway CSP');
  check(expectedManifestConsoleErrors===1&&pageErrors===0&&unexpectedConsoleErrors===0,'Only the baseline native manifest CSP denial is expected; all other browser errors remain failures');
  check((await context.cookies(edgeOrigin)).some(cookie=>cookie.name==='__Host-rdg-device'&&cookie.httpOnly),'The baseline context still has its actual fixture HttpOnly cookie');
  manifestEvidence={scope:'LOCAL_NATIVE_MANIFEST_COOKIE_FIXTURE',realAccess:false,nativeBrowserManager:true,manualManifestFetch:false,fixtureHttpOnlyCookie:true,productionCspReused:true,positive:{attribute:'use-credentials',nativeRequestCount:positiveRequests.length,cookieIncluded:true,status:200,recognized:true,manifestErrorCount:nativeManifest.errors.length},baseline:{attributeAbsent:true,nativeRequestCount:baselineRequests.length,cookieIncluded:false,status:302,nativeRejected:baselineNativeRejected,cspViolationCount,expectedConsoleErrors:expectedManifestConsoleErrors}};
  await baselineSession.detach();await baselinePage.close();manifestBaselineActive=false;
  pass('Native Chromium manifest without crossorigin omits the available fixture cookie and its cross-origin redirect is blocked by the original CSP');
  await context.close();
  const literalNull=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',extraHTTPHeaders:{Origin:'null'}}),literalNullPage=await literalNull.newPage();observePage(literalNullPage,'EXPLICIT_NULL_GET');
  const nullGet=await literalNullPage.goto(edgeOrigin+'/login');
  check(nullGet.status()===200&&observations.at(-1).origin==='NULL'&&!observations.at(-1).deviceCookieIssued,'Explicit test null-Origin GET remains navigation-only');
  await literalNullPage.getByRole('button',{name:'Trust this browser and continue',exact:true}).waitFor();
  check((await literalNull.cookies(edgeOrigin)).every(cookie=>cookie.name!=='__Host-rdg-device'),'Null-Origin GET alone issues no trust');
  pass('A separately declared test Origin:null HTTPS GET renders enrollment without issuing trust; this header is not claimed as natural Chromium behavior');
  await literalNull.close();
  edgeAssertionEnabled=false;intentionalDenial=true;
  const unauthorized=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),unauthorizedPage=await unauthorized.newPage();
  observePage(unauthorizedPage,'UNAUTHORIZED_HTML');const denied=await unauthorizedPage.goto(edgeOrigin+'/login');
  check(denied.status()===401&&denied.headers()['content-type']?.startsWith('text/html'),'Absent synthetic edge assertion returns unauthorized HTML');
  await unauthorizedPage.getByRole('heading',{name:'Sign-in unavailable',exact:true}).waitFor();
  check(await unauthorizedPage.locator('input[name="nonce"]').count()===0&&(await unauthorized.cookies(edgeOrigin)).every(cookie=>cookie.name!=='__Host-rdg-device'),'Unauthorized HTML exposes no enrollment challenge or trusted cookie');
  pass('A fresh browser without a signed edge assertion receives friendly 401 HTML without an enrollment form');
  await unauthorized.close();edgeAssertionEnabled=true;
  for(const nullOrigin of [false,true]){
    const hostile=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block'}),hostilePage=await hostile.newPage();
    observePage(hostilePage,nullOrigin?'NATIVE_NULL_POST':'HOSTILE_POST');await hostilePage.goto(providerOrigin+(nullOrigin?'/null-post':'/hostile-post'));
    const responsePromise=hostilePage.waitForResponse(response=>response.url()===edgeOrigin+'/login'&&response.request().method()==='POST');
    await hostilePage.getByRole('button',{name:nullOrigin?'Submit native null-origin fixture':'Submit cross-origin fixture',exact:true}).click();
    const response=await responsePromise,observation=observations.at(-1);
    check(response.status()===403&&observation.origin===(nullOrigin?'NULL':'CROSS_ORIGIN')&&!observation.deviceCookieIssued,'Nonlocal enrollment POST remains denied before trust issuance');
    check((await hostile.cookies(edgeOrigin)).every(cookie=>cookie.name!=='__Host-rdg-device'),'Denied POST issues no browser trust');
    pass(nullOrigin?'Native null-Origin POST under no-referrer remains denied':'Cross-origin enrollment POST remains denied');
    await hostile.close();
  }
  check(pageErrors===0&&unexpectedConsoleErrors===0&&webSockets===0,'Observed fixture pages have no unexpected browser errors or desktop upgrade');
  const evidence={status:'PASS',scope:'LOCAL_HTTPS_LOGIN_BROWSER_FIXTURE',browser:browser.version(),signedFixtureIdentity:true,realAccess:false,realMac:false,realSafari:false,desktopAuthenticated:false,selfSignedLoopbackTLS:true,resolvedFixtureExpectation:{naturalReturnGetOrigin:returnGet.origin,priorNonlocalOriginAssumptionRemoved:true},preFixRegression:{priorMetadataObserved:priorNullFormFailureObserved,samePageFormOriginNull403Resolved:priorNullFormFailureObserved&&issued.origin==='SAME_ORIGIN'},fixtureAdjustment:{opaqueIframeRemoved:true,priorOpaqueSecurityErrorCause:'UNKNOWN_FIXTURE_ONLY',replacement:'NATIVE_TOP_LEVEL_FORM_NO_REFERRER'},results,providerReturnPost,loginObservations:observations,manifestEvidence,manifestRequests,expectedManifestConsoleErrors,observedBrowserPages,pageErrors,exceptionCategories,unexpectedConsoleErrors,expectedConsoleErrors,webSockets};
  await writeArtifact(artifactFile,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch{
  const evidence={status:'FAIL',scope:'LOCAL_HTTPS_LOGIN_BROWSER_FIXTURE',reason:'LOGIN_BROWSER_CHECK_FAILED',results,providerReturnPost,loginObservations:observations,manifestEvidence,manifestRequests,expectedManifestConsoleErrors,observedBrowserPages,pageErrors,exceptionCategories,unexpectedConsoleErrors,expectedConsoleErrors,webSockets};
  console.error(JSON.stringify(evidence));process.exitCode=1;
}finally{clearTimeout(deadline);await cleanup();}

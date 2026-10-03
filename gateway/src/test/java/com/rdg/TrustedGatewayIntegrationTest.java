package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.nimbusds.jose.jwk.JWKSet;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;
import static org.junit.jupiter.api.Assertions.*;

/** Actual loopback gateway and encrypted trust store with disposable signed enrollment identities. */
class TrustedGatewayIntegrationTest {
    @TempDir Path directory;
    Config c;Fixtures.Time time;TrustedDeviceStore trusted;Main.Runtime runtime;GuacdFixture upstream;
    HttpClient client;String access,deviceCookie,appCookie,csrf;
    @BeforeEach void setup()throws Exception {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");java.util.logging.LogManager.getLogManager().reset();
        c=Fixtures.ownerSetupConfig(directory,"https://gateway.fixture.test");time=new Fixtures.Time();time.now=Instant.now();
        upstream=new GuacdFixture();
        c=new Config(c.nodeId(),c.origin(),c.issuer(),c.audience(),c.ownerEmail(),c.ownerSubject(),c.deviceId(),c.label(),c.targetHost(),c.targetPort(),c.secret(),c.guacdHost(),upstream.server.getLocalPort(),c.listenAddress(),c.listenPort(),c.stateDir(),c.webDir(),c.bookmarks(),c.keysyms(),c.desktopPolicy(),c.credentialStore());
        var key=Fixtures.key("trusted-gateway-fixture");
        trusted=new TrustedDeviceStore(c.stateDir().resolve("trusted-devices"),c.credentialStore().keyFile(),c.nodeId(),c.ownerEmail(),c.ownerSubject(),time);
        runtime=new Main.Runtime(c,new AccessVerifier(c,time,()->new JWKSet(key.toPublicJWK()).toString()),new GuacdConnector(c),time,time.nano::get,trusted);
        access=Fixtures.token(c,key,time.instant(),3600,Map.of());client=HttpClient.newHttpClient();
    }
    @AfterEach void close()throws Exception {if(runtime!=null)runtime.close();if(upstream!=null)upstream.close();}
    HttpResponse<String> request(String method,String path,String body,String assertion,String cookies,String csrfValue,String origin,String host,String type)throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+runtime.port()+path)).header("Host",host).header("Content-Type",type);
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(cookies!=null)b.header("Cookie",cookies);
        if(csrfValue!=null)b.header("X-RDG-CSRF",csrfValue);if(origin!=null)b.header("Origin",origin);
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<String> api(String method,String path,String body,String cookies,String csrfValue,String origin)throws Exception {return request(method,path,body,null,cookies,csrfValue,origin,"gateway.fixture.test","application/json");}
    String cookie(HttpResponse<?> r,String name){return r.headers().allValues("Set-Cookie").stream().filter(v->v.startsWith(name+"=")).findFirst().orElseThrow().split(";")[0];}
    String nonce(HttpResponse<String> r){var m=Pattern.compile("name=\"nonce\" value=\"([A-Za-z0-9_-]{43})\"").matcher(r.body());assertTrue(m.find());return m.group(1);}
    HttpResponse<String> login(String method,String body,String cookies,String origin)throws Exception {return request(method,"/login",body,access,cookies,null,origin,"gateway.fixture.test","application/x-www-form-urlencoded");}
    void enroll()throws Exception {
        var get=login("GET",null,null,null);assertEquals(200,get.statusCode());
        var post=login("POST","nonce="+nonce(get),cookie(get,"__Host-rdg-enroll"),c.origin());assertEquals(303,post.statusCode());
        String header=post.headers().allValues("Set-Cookie").stream().filter(v->v.startsWith(TrustedDeviceCookies.NAME+"=")).findFirst().orElseThrow();
        assertTrue(header.contains("Secure; HttpOnly; SameSite=Lax; Max-Age=31536000"));assertFalse(post.body().contains(header.split(";")[0]));deviceCookie=header.split(";")[0];
        bootstrap();
    }
    void bootstrap()throws Exception {
        var r=api("POST","/api/session/bootstrap","{}",deviceCookie,null,c.origin());assertEquals(200,r.statusCode());
        appCookie=cookie(r,"__Host-rdg");csrf=Config.JSON.readTree(r.body()).path("csrfToken").asText();
    }
    String cookies(){return deviceCookie+"; "+appCookie;}
    @Test void signedAccessAndOneTimeSameOriginEnrollmentAreRequired()throws Exception {
        assertEquals(401,request("GET","/login",null,null,null,null,null,"gateway.fixture.test","application/json").statusCode());
        assertEquals(401,request("GET","/login",null,"forged",null,null,null,"gateway.fixture.test","application/json").statusCode());
        assertEquals(403,request("GET","/login",null,access,null,null,null,"evil.fixture.test","application/json").statusCode());
        var get=login("GET",null,null,null);String nonce=nonce(get),cookie=cookie(get,"__Host-rdg-enroll");
        assertEquals(403,login("POST","nonce="+nonce,cookie,"https://evil.fixture.test").statusCode());
        assertEquals(403,login("POST","nonce="+nonce,null,c.origin()).statusCode());
        assertEquals(401,login("POST","nonce="+nonce,cookie+"; __Host-rdg=malformed",c.origin()).statusCode());
        assertEquals(303,login("POST","nonce="+nonce,cookie,c.origin()).statusCode());
        assertEquals(403,login("POST","nonce="+nonce,cookie,c.origin()).statusCode());
        var expired=login("GET",null,null,null);time.advance(301);
        assertEquals(403,login("POST","nonce="+nonce(expired),cookie(expired,"__Host-rdg-enroll"),c.origin()).statusCode());
    }
    @Test void rememberedBrowserAccessDoesNotDependOnAnEdgeAssertion()throws Exception {
        assertEquals(303,api("GET","/",null,null,null,null).statusCode());
        enroll();
        assertEquals(200,api("GET","/",null,deviceCookie,null,null).statusCode());
        assertEquals(200,api("GET","/api/devices",null,cookies(),null,null).statusCode());
        assertTrue(Config.JSON.readTree(api("GET","/api/diagnostics",null,cookies(),null,null).body()).path("trustedDevicesEnabled").booleanValue());
        time.advance(3601);bootstrap(); // Access JWT has expired; trusted browser obtains a fresh bounded app lease.
        assertEquals(200,api("GET","/api/session",null,cookies(),null,null).statusCode());
    }
    @Test void missingForgedAndMismatchedBrowserProofRejectApiAndWebsocket()throws Exception {
        enroll();
        assertEquals(401,request("GET","/api/devices",null,access,appCookie,null,null,"gateway.fixture.test","application/json").statusCode());
        assertEquals(401,api("GET","/api/devices",null,TrustedDeviceCookies.NAME+"="+Sessions.random()+"; "+appCookie,null,null).statusCode());
        var other=trusted.issue(new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600)));
        assertEquals(403,api("GET","/api/devices",null,TrustedDeviceCookies.NAME+"="+other.token()+"; "+appCookie,null,null).statusCode());
        assertEquals(401,api("GET","/ws/sessions/"+Sessions.random(),null,appCookie,null,c.origin()).statusCode());
        assertEquals(403,api("POST","/api/desktop/credential","{\"password\":\"fixture-secret\"}",cookies(),"wrong",c.origin()).statusCode());
        assertEquals(403,api("POST","/api/desktop/credential","{\"password\":\"fixture-secret\"}",cookies(),csrf,"https://evil.fixture.test").statusCode());
        assertEquals(0,upstream.connections.get());
    }
    @Test void validTrustIsReusedWithoutExtensionAndReenrollmentClearsPriorApp()throws Exception {
        enroll();String raw=deviceCookie.substring(deviceCookie.indexOf('=')+1);var first=trusted.verify(raw);
        var reused=login("GET",null,cookies(),null);assertEquals(303,reused.statusCode());assertTrue(reused.headers().allValues("Set-Cookie").isEmpty());
        assertEquals(first.identity().expiresAt(),trusted.verify(raw).identity().expiresAt());
        trusted.revokeToken(raw);
        var get=login("GET",null,cookies(),null);
        var post=login("POST","nonce="+nonce(get),cookie(get,"__Host-rdg-enroll")+"; "+cookies(),c.origin());
        assertEquals(303,post.statusCode());assertTrue(post.headers().allValues("Set-Cookie").stream().anyMatch(v->v.startsWith("__Host-rdg=;")&&v.contains("Max-Age=0")));
        deviceCookie=cookie(post,TrustedDeviceCookies.NAME);bootstrap();assertEquals(200,api("GET","/api/devices",null,cookies(),null,null).statusCode());
    }
    @Test void revocationClosesAnExistingOfficialTransportAndDeniesStaleProof()throws Exception {
        enroll();assertEquals(200,api("POST","/api/desktop/credential","{\"password\":\"fixture-only-password\"}",cookies(),csrf,c.origin()).statusCode());
        var intent=api("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\"control\",\"keyboardProfile\":\"mac-native\"}",cookies(),csrf,c.origin());assertEquals(201,intent.statusCode());
        String id=Config.JSON.readTree(intent.body()).path("intentId").asText();
        WebSocket live=client.newWebSocketBuilder().subprotocols("guacamole").header("Host","gateway.fixture.test").header("Cookie",cookies()).header("Origin",c.origin()).buildAsync(URI.create("ws://127.0.0.1:"+runtime.port()+"/ws/sessions/"+id),new WebSocket.Listener(){public void onOpen(WebSocket ws){ws.request(Long.MAX_VALUE);}public CompletionStage<?> onText(WebSocket ws,CharSequence text,boolean last){ws.request(1);return null;}}).get(4,TimeUnit.SECONDS);
        GatewayIntegrationTest.until(()->upstream.parameters.containsKey("password"));
        var devices=Config.JSON.readTree(api("GET","/api/trusted-devices",null,cookies(),null,null).body()).path("devices");assertEquals(1,devices.size());assertTrue(devices.get(0).path("current").booleanValue());
        String deviceId=devices.get(0).path("id").asText();assertEquals(403,api("DELETE","/api/trusted-devices/"+deviceId,null,cookies(),"wrong",c.origin()).statusCode());
        var revoked=api("DELETE","/api/trusted-devices/"+deviceId,null,cookies(),csrf,c.origin());assertEquals(200,revoked.statusCode());assertTrue(Config.JSON.readTree(revoked.body()).path("reauthenticate").booleanValue());
        GatewayIntegrationTest.until(()->upstream.closed.get()==1&&live.isInputClosed());
        assertEquals(401,request("GET","/api/devices",null,access,cookies(),null,null,"gateway.fixture.test","application/json").statusCode());assertEquals(0,upstream.keys.get());
    }
    @Test void removingAnotherBrowserPreservesTheManagingBrowserSession()throws Exception {
        enroll();var owner=new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600));var other=trusted.issue(owner);
        String otherCookie=TrustedDeviceCookies.NAME+"="+other.token();
        var boot=api("POST","/api/session/bootstrap","{}",otherCookie,null,c.origin());assertEquals(200,boot.statusCode());
        String otherApp=cookie(boot,"__Host-rdg");
        assertEquals(200,api("DELETE","/api/trusted-devices/"+other.id(),null,cookies(),csrf,c.origin()).statusCode());
        assertEquals(200,api("GET","/api/trusted-devices",null,cookies(),null,null).statusCode());
        assertEquals(200,api("GET","/api/session",null,cookies(),null,null).statusCode());
        assertEquals(401,api("GET","/api/session",null,otherCookie+"; "+otherApp,null,null).statusCode());
    }
    @Test void logoutRevokesRememberedBrowser()throws Exception {
        enroll();assertEquals(204,api("DELETE","/api/session",null,cookies(),csrf,c.origin()).statusCode());
        assertEquals(401,api("POST","/api/session/bootstrap","{}",deviceCookie,null,c.origin()).statusCode());
    }
    @Test void changedPinnedSubjectInvalidatesPersistedBrowserAndLiveAuthority()throws Exception {
        var issue=trusted.issue(new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600)));
        // Separate store instance uses the same authenticated encrypted database and master, with the new pin.
        try(var next=new TrustedDeviceStore(c.stateDir().resolve("trusted-devices"),c.credentialStore().keyFile(),c.nodeId(),c.ownerEmail(),"new-owner",time)) {
            assertThrows(Failure.class,()->next.verify(issue.token()));assertThrows(Failure.class,()->next.verifyDevice(issue.id()));
            assertThrows(Failure.class,()->next.issue(new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600))));
            var renewed=next.issue(new AccessVerifier.Identity("new-owner",time.instant().plusSeconds(3600)));assertEquals("new-owner",next.verify(renewed.token()).identity().subject());
        }
    }
}

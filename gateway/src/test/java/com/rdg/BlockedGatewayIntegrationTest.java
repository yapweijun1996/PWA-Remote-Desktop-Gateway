package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.nimbusds.jose.jwk.JWKSet;
import org.apache.guacamole.net.GuacamoleTunnel;
import java.net.*;
import java.net.http.*;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Loopback API/WS policy checks; no VNC/guacd, real credentials or Cloudflare account. */
class BlockedGatewayIntegrationTest {
    @TempDir Path directory;
    Config config;
    Main.Runtime runtime;
    HttpClient client;
    String token,cookie,csrf,wrongOwner;
    AtomicInteger upstreamCalls=new AtomicInteger();

    @BeforeEach void setup() throws Exception {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");
        java.util.logging.LogManager.getLogManager().reset();
        config=Fixtures.blockedConfig(directory,"https://gateway.fixture.test");
        var clock=new Fixtures.Time();clock.now=Instant.now();var key=Fixtures.key("blocked-fixture");
        var connector=new GuacdConnector(config) {
            @Override GuacamoleTunnel open(Sessions.Desktop desktop) {
                upstreamCalls.incrementAndGet();throw new AssertionError("Blocked policy reached upstream connector");
            }
        };
        runtime=new Main.Runtime(config,new AccessVerifier(config,clock,()->new JWKSet(key.toPublicJWK()).toString()),connector,clock,clock.nano::get);
        client=HttpClient.newHttpClient();token=Fixtures.token(config,key,clock.instant(),3600,Map.of());
        wrongOwner=Fixtures.token(config,key,clock.instant(),3600,Map.of("email","other@fixture.test"));
        var bootstrap=request("POST","/api/session/bootstrap","{}",token,null,null,config.origin());
        assertEquals(200,bootstrap.statusCode());cookie=bootstrap.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
        csrf=Config.JSON.readTree(bootstrap.body()).path("csrfToken").asText();
    }
    @AfterEach void close() throws Exception {if(runtime!=null)runtime.close();assertEquals(0,upstreamCalls.get());}
    HttpResponse<String> request(String method,String path,String body,String assertion,String appCookie,String csrfValue,String origin) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+runtime.port()+path))
            .header("Host","gateway.fixture.test").header("Content-Type","application/json");
        if(assertion!=null)builder.header("Cf-Access-Jwt-Assertion",assertion);
        if(appCookie!=null)builder.header("Cookie",appCookie);if(csrfValue!=null)builder.header("X-RDG-CSRF",csrfValue);
        if(origin!=null)builder.header("Origin",origin);
        return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    CompletableFuture<WebSocket> websocket(String assertion,String origin) {
        var builder=client.newWebSocketBuilder().subprotocols("guacamole").header("Host","gateway.fixture.test").header("Cookie",cookie);
        if(assertion!=null)builder.header("Cf-Access-Jwt-Assertion",assertion);if(origin!=null)builder.header("Origin",origin);
        return builder.buildAsync(URI.create("ws://127.0.0.1:"+runtime.port()+"/ws/sessions/"+"A".repeat(43)),new WebSocket.Listener() {});
    }
    void rejectedWebsocket(String assertion,String origin,int status) {
        ExecutionException failure=assertThrows(ExecutionException.class,()->websocket(assertion,origin).get(4,TimeUnit.SECONDS));
        var handshake=assertInstanceOf(WebSocketHandshakeException.class,failure.getCause());
        assertEquals(status,handshake.getResponse().statusCode());
    }
    @Test void authenticatedStatusReportsBlockedWithoutDesktopPrerequisites() throws Exception {
        var device=Config.JSON.readTree(request("GET","/api/devices",null,token,cookie,null,null).body()).get(0);
        assertEquals("BLOCKED",device.path("status").asText());assertFalse(device.path("desktopEnabled").booleanValue());
        assertEquals("BLOCKED",device.path("desktopPolicy").asText());
        assertEquals(Config.DESKTOP_BLOCKED_REASON,device.path("blockedReason").asText());
        assertFalse(device.toString().contains("host.docker.internal"));assertFalse(device.toString().contains("credentialRef"));
        assertFalse(device.path("credentialSetupEnabled").booleanValue());assertFalse(device.path("credentialConfigured").booleanValue());
        var diagnostic=Config.JSON.readTree(request("GET","/api/diagnostics",null,token,cookie,null,null).body());
        assertFalse(diagnostic.path("desktopEnabled").booleanValue());assertEquals("BLOCKED",diagnostic.path("desktopPolicy").asText());
        assertTrue(diagnostic.path("keysyms").isObject());assertTrue(diagnostic.path("keysyms").isEmpty());
    }
    @Test void blockedIntentsAndClipboardRemainBehindIdentityOriginAndCsrf() throws Exception {
        String body="{\"deviceId\":\"fixture-mac\",\"mode\":\"view\",\"keyboardProfile\":\"mac-native\"}";
        assertEquals(401,request("POST","/api/connect-intents",body,null,cookie,csrf,config.origin()).statusCode());
        assertEquals(401,request("GET","/api/devices",null,"forged",cookie,null,null).statusCode());
        assertEquals(403,request("GET","/api/devices",null,wrongOwner,cookie,null,null).statusCode());
        assertEquals(403,request("POST","/api/connect-intents",body,token,cookie,"wrong",config.origin()).statusCode());
        assertEquals(403,request("POST","/api/connect-intents",body,token,cookie,csrf,"https://other.fixture.test").statusCode());
        var refused=request("POST","/api/connect-intents",body,token,cookie,csrf,config.origin());
        assertEquals(503,refused.statusCode());assertEquals(Config.DESKTOP_BLOCKED_REASON,Config.JSON.readTree(refused.body()).path("code").asText());
        assertEquals(503,request("POST","/api/connect-intents",body.replace("view","control"),token,cookie,csrf,config.origin()).statusCode());
        assertEquals(503,request("POST","/api/clipboard-consent","{\"enabled\":true}",token,cookie,csrf,config.origin()).statusCode());
        assertEquals(200,request("POST","/api/clipboard-consent","{\"enabled\":false}",token,cookie,csrf,config.origin()).statusCode());
        assertEquals(204,request("DELETE","/api/session",null,token,cookie,csrf,config.origin()).statusCode());
    }
    @Test void rawWebsocketStillValidatesSignedIdentityAndOriginBeforeBlockedRefusal() {
        rejectedWebsocket(null,config.origin(),401);rejectedWebsocket("forged",config.origin(),401);
        rejectedWebsocket(wrongOwner,config.origin(),403);rejectedWebsocket(token,"https://other.fixture.test",403);
        rejectedWebsocket(token,config.origin(),503);
    }
}

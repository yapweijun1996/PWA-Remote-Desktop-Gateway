package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.nimbusds.jose.jwk.*;
import java.nio.file.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class GatewayIntegrationTest {
    @TempDir Path dir;GuacdFixture upstream;Main.Runtime runtime;Config c;String token,cookie,csrf;HttpClient client;Fixtures.Time time;
    @BeforeEach void setup() throws Exception {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");java.util.logging.LogManager.getLogManager().reset();
        upstream=new GuacdFixture();c=Fixtures.config(dir,upstream.server.getLocalPort(),"https://gateway.fixture.test");var key=Fixtures.key("fixture");
        time=new Fixtures.Time();time.now=Instant.now();runtime=new Main.Runtime(c,new AccessVerifier(c,time,()->new JWKSet(key.toPublicJWK()).toString()),new GuacdConnector(c),time,time.nano::get);
        token=Fixtures.token(c,key,time.instant(),3600,Map.of());client=HttpClient.newHttpClient();
        var response=request("POST","/api/session/bootstrap","{}",token,null,null,c.origin());assertEquals(200,response.statusCode(),response.body());
        cookie=response.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];csrf=Config.JSON.readTree(response.body()).path("csrfToken").asText();
        assertTrue(response.headers().firstValue("Set-Cookie").orElse("").contains("Secure; HttpOnly; SameSite=Lax"));
    }
    @AfterEach void close() throws Exception {if(runtime!=null)runtime.close();if(upstream!=null)upstream.close();}
    HttpResponse<String> request(String method,String path,String body,String assertion,String cookie,String csrf,String origin) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+runtime.port()+path)).header("Host","gateway.fixture.test").header("Content-Type","application/json");
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(cookie!=null)b.header("Cookie",cookie);if(csrf!=null)b.header("X-RDG-CSRF",csrf);if(origin!=null)b.header("Origin",origin);
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    String intent(String mode) throws Exception {
        var r=request("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\""+mode+"\",\"keyboardProfile\":\"windows-native\"}",token,cookie,csrf,c.origin());assertEquals(201,r.statusCode(),r.body());return Config.JSON.readTree(r.body()).path("intentId").asText();
    }
    CompletableFuture<WebSocket> ws(String id,String assertion,String appCookie,String origin) {
        var b=client.newWebSocketBuilder().subprotocols("guacamole").header("Host","gateway.fixture.test");
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(appCookie!=null)b.header("Cookie",appCookie);if(origin!=null)b.header("Origin",origin);
        return b.buildAsync(URI.create("ws://127.0.0.1:"+runtime.port()+"/ws/sessions/"+id+"?"),new WebSocket.Listener(){
            @Override public void onOpen(WebSocket ws){ws.request(Long.MAX_VALUE);}
            @Override public CompletionStage<?> onText(WebSocket ws,CharSequence data,boolean last){ws.request(1);return null;}
        });
    }
    static void until(java.util.function.BooleanSupplier condition) throws Exception {long end=System.nanoTime()+Duration.ofSeconds(4).toNanos();while(!condition.getAsBoolean()&&System.nanoTime()<end)Thread.sleep(20);assertTrue(condition.getAsBoolean());}
    String scopedBody(String intentId) throws Exception {return Config.JSON.writeValueAsString(Map.of("intentId",intentId));}
    void websocketFailure(int expectedStatus,CompletableFuture<WebSocket> attempt) {
        var failure=assertThrows(ExecutionException.class,()->attempt.get(4,TimeUnit.SECONDS));
        var handshake=assertInstanceOf(WebSocketHandshakeException.class,failure.getCause());assertEquals(expectedStatus,handshake.getResponse().statusCode());
    }
    void assertSingleDesktopOpen(WebSocket live) throws Exception {
        var status=request("GET","/api/session",null,token,cookie,null,null);assertEquals(200,status.statusCode());
        var body=Config.JSON.readTree(status.body());assertTrue(body.path("activeDesktop").booleanValue());assertEquals(1,body.path("nodeActiveDesktops").intValue());
        assertEquals(1,upstream.connections.get());assertEquals(0,upstream.closed.get());assertFalse(live.isInputClosed());assertFalse(live.isOutputClosed());
    }
    @Test void scopedLosingTabCancellationKeepsWinningWebsocketAndUpstreamAlive() throws Exception {
        String winner=intent("control"),loser=intent("control");var live=ws(winner,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);
        until(()->upstream.parameters.containsKey("read-only"));websocketFailure(409,ws(loser,token,cookie,c.origin()));
        assertEquals(204,request("DELETE","/api/desktop-session",scopedBody(loser),token,cookie,csrf,c.origin()).statusCode());
        assertSingleDesktopOpen(live);websocketFailure(410,ws(loser,token,cookie,c.origin()));
        live.sendText("3.key,2.99,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.keys.get()==1);
        assertEquals(204,request("DELETE","/api/desktop-session",scopedBody(winner),token,cookie,csrf,c.origin()).statusCode());
        until(()->upstream.closed.get()==1 && live.isInputClosed());
        var status=Config.JSON.readTree(request("GET","/api/session",null,token,cookie,null,null).body());assertFalse(status.path("activeDesktop").booleanValue());assertEquals(0,status.path("nodeActiveDesktops").intValue());
    }
    @Test void scopedPendingCancellationAndUnknownIntentAreIdempotent() throws Exception {
        String cancelled=intent("control"),retained=intent("control");
        assertEquals(204,request("DELETE","/api/desktop-session",scopedBody(cancelled),token,cookie,csrf,c.origin()).statusCode());
        websocketFailure(410,ws(cancelled,token,cookie,c.origin()));assertEquals(0,upstream.connections.get());
        var live=ws(retained,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        for(String id:List.of("A".repeat(43),cancelled,"A".repeat(43))) {
            assertEquals(204,request("DELETE","/api/desktop-session",scopedBody(id),token,cookie,csrf,c.origin()).statusCode());assertSingleDesktopOpen(live);
        }
        live.sendText("3.key,2.99,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.keys.get()==1);
    }
    @Test void scopedForeignAppIsDeniedBeforeAndAfterConsumedIntentExpiry() throws Exception {
        String id=intent("control");var foreign=request("POST","/api/session/bootstrap","{}",token,null,null,c.origin());assertEquals(200,foreign.statusCode());
        String foreignCookie=foreign.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];String foreignCsrf=Config.JSON.readTree(foreign.body()).path("csrfToken").asText();
        assertEquals(403,request("DELETE","/api/desktop-session",scopedBody(id),token,foreignCookie,foreignCsrf,c.origin()).statusCode());assertEquals(0,upstream.connections.get());
        var live=ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        time.advance(31);runtime.sessions.tick();assertSingleDesktopOpen(live);
        assertEquals(403,request("DELETE","/api/desktop-session",scopedBody(id),token,foreignCookie,foreignCsrf,c.origin()).statusCode());assertSingleDesktopOpen(live);
        assertEquals(204,request("DELETE","/api/desktop-session",scopedBody(id),token,cookie,csrf,c.origin()).statusCode());until(()->upstream.closed.get()==1 && live.isInputClosed());
    }
    @Test void malformedScopedCancellationCannotEndAnActiveDesktop() throws Exception {
        String id=intent("control");var live=ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        for(String body:List.of("{}","[]","{", "{\"intentId\":null}","{\"intentId\":7}","{\"intentId\":\"short\"}",
            "{\"intentId\":\""+"A".repeat(42)+"\"}","{\"intentId\":\""+"A".repeat(44)+"\"}","{\"intentId\":\""+"+".repeat(43)+"\"}",
            "{\"intentId\":\""+id+"\",\"all\":true}")) {
            var response=request("DELETE","/api/desktop-session",body,token,cookie,csrf,c.origin());assertEquals(400,response.statusCode(),body);assertSingleDesktopOpen(live);
        }
        live.sendText("3.key,2.99,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.keys.get()==1);
    }
    @Test void scopedCancellationPreservesIdentityOriginAndCsrfGuards() throws Exception {
        String id=intent("control");String body=scopedBody(id);var live=ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        assertEquals(401,request("DELETE","/api/desktop-session",body,null,cookie,csrf,c.origin()).statusCode());
        assertEquals(401,request("DELETE","/api/desktop-session",body,"forged",cookie,csrf,c.origin()).statusCode());
        assertEquals(401,request("DELETE","/api/desktop-session",body,token,null,csrf,c.origin()).statusCode());
        assertEquals(403,request("DELETE","/api/desktop-session",body,token,cookie,csrf,null).statusCode());
        assertEquals(403,request("DELETE","/api/desktop-session",body,token,cookie,csrf,"https://evil.test").statusCode());
        assertEquals(403,request("DELETE","/api/desktop-session",body,token,cookie,null,c.origin()).statusCode());
        assertEquals(403,request("DELETE","/api/desktop-session",body,token,cookie,"wrong",c.origin()).statusCode());
        assertSingleDesktopOpen(live);live.sendText("3.key,2.99,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.keys.get()==1);
    }
    @Test void identityOriginCsrfAndTargetInjectionBeforeUpstream() throws Exception {
        assertEquals(401,request("GET","/api/devices",null,null,cookie,null,null).statusCode());
        assertEquals(401,request("GET","/api/devices",null,"forged",cookie,null,null).statusCode());
        assertEquals(403,request("POST","/api/connect-intents","{}",token,cookie,csrf,"https://evil.test").statusCode());
        assertEquals(403,request("POST","/api/connect-intents","{}",token,cookie,"wrong",c.origin()).statusCode());
        assertEquals(400,request("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\"control\",\"keyboardProfile\":\"windows-native\",\"host\":\"evil\"}",token,cookie,csrf,c.origin()).statusCode());
        assertEquals(0,upstream.connections.get());
        String projection=request("GET","/api/devices",null,token,cookie,null,null).body();assertFalse(projection.contains("password"));assertFalse(projection.contains("127.0.0.1"));assertTrue(projection.contains("GATEWAY_REACHABLE"));
    }
    @Test void websocketRejectsMissingIdentityHostileOriginAndReplay() throws Exception {
        String id=intent("control");assertThrows(ExecutionException.class,()->ws(id,null,cookie,c.origin()).get(4,TimeUnit.SECONDS));
        assertThrows(ExecutionException.class,()->ws(id,token,cookie,"https://evil.test").get(4,TimeUnit.SECONDS));assertEquals(0,upstream.connections.get());
        WebSocket live=ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("password"));
        assertEquals("fixture-only-password",upstream.parameters.get("password"));assertEquals("127.0.0.1",upstream.parameters.get("hostname"));
        assertThrows(ExecutionException.class,()->ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS));
        live.sendText("3.key,5.65507,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.keys.get()==1);
        assertEquals(204,request("DELETE","/api/session",null,token,cookie,csrf,c.origin()).statusCode());until(()->upstream.closed.get()==1);
    }
    @Test void rawViewInputClosesBothResources() throws Exception {
        var live=ws(intent("view"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        assertEquals("true",upstream.parameters.get("read-only"));assertEquals("true",upstream.parameters.get("disable-paste"));
        live.sendText("3.key,2.99,1.1;",true).get(4,TimeUnit.SECONDS);until(()->upstream.closed.get()==1);assertEquals(0,upstream.keys.get());
    }
    @Test void unavailableUpstreamClosesBrowserBeforeHandshakeAndReleasesLease() throws Exception {
        upstream.close();
        var live=ws(intent("control"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);
        until(live::isInputClosed);
        var status=request("GET","/api/session",null,token,cookie,null,null);
        assertEquals(200,status.statusCode());var body=Config.JSON.readTree(status.body());
        assertFalse(body.path("activeDesktop").booleanValue());assertEquals(0,body.path("nodeActiveDesktops").intValue());
        assertNotNull(intent("control"));assertEquals(0,upstream.connections.get());
    }
    @Test void terminalUpstreamErrorClosesNonResponsiveBrowserAndUpstream() throws Exception {
        upstream.terminalError=true;
        var live=ws(intent("control"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);
        until(()->live.isInputClosed()&&upstream.closed.get()==1);
        var body=Config.JSON.readTree(request("GET","/api/session",null,token,cookie,null,null).body());
        assertFalse(body.path("activeDesktop").booleanValue());assertEquals(0,body.path("nodeActiveDesktops").intValue());
        assertEquals(0,upstream.keys.get());assertNotNull(intent("control"));
    }
    @Test void liveIdleExpiryClosesBrowserAndUpstreamDespiteHeartbeat() throws Exception {
        var live=ws(intent("control"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        live.sendText("0.,4.ping,1.1;",true).get(4,TimeUnit.SECONDS);time.advance(901);
        until(()->upstream.closed.get()==1 && live.isInputClosed());assertEquals(0,upstream.keys.get());
    }
    @Test void liveAbsoluteExpiryClosesBothEvenWithRecentInput() throws Exception {
        var live=ws(intent("control"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.parameters.containsKey("read-only"));
        for(int n=0;n<4;n++){time.advance(800);live.sendText("3.key,2.99,1.1;3.key,2.99,1.0;",true).get(4,TimeUnit.SECONDS);int expected=(n+1)*2;until(()->upstream.keys.get()==expected);}
        time.advance(401);until(()->upstream.closed.get()==1 && live.isInputClosed());
    }
    @Test void pendingIntentBlocksUpdateBoundaryAndEndCancelsIt() throws Exception {
        String id=intent("control");assertEquals(409,request("POST","/api/update-boundary","{}",token,cookie,csrf,c.origin()).statusCode());
        assertEquals(204,request("DELETE","/api/desktop-session",null,token,cookie,csrf,c.origin()).statusCode());
        assertEquals(200,request("POST","/api/update-boundary","{}",token,cookie,csrf,c.origin()).statusCode());
        assertThrows(ExecutionException.class,()->ws(id,token,cookie,c.origin()).get(4,TimeUnit.SECONDS));assertEquals(0,upstream.connections.get());
    }
    @Test void oversizedFrameAndMalformedInstructionEndTransport() throws Exception {
        var live=ws(intent("control"),token,cookie,c.origin()).get(4,TimeUnit.SECONDS);until(()->upstream.connections.get()==1);
        live.sendText("3.key,2147483647.x;",true).get(4,TimeUnit.SECONDS);until(()->upstream.closed.get()==1);assertEquals(0,upstream.keys.get());
    }
}

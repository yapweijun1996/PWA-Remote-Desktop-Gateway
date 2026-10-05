package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.JsonNode;
import com.nimbusds.jose.jwk.*;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real gateway runtime, real HTTP/WebSocket stack, disposable agent peer (docs/19). No Mac, no real capture. */
class AgentGatewayIntegrationTest {
    @TempDir Path dir;AgentFixture agent;GuacdFixture guacd;Main.Runtime runtime;Config c;JWKSet jwks;com.nimbusds.jose.jwk.RSAKey key;
    String token,cookie,csrf,agentToken;HttpClient client;Fixtures.Time time;int port;

    @BeforeEach void setup() throws Exception {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");java.util.logging.LogManager.getLogManager().reset();
        Path tokenFile=Fixtures.agentTokenFile(dir);agentToken=Files.readString(tokenFile).strip();
        agent=new AgentFixture(dir.resolve("agent"),agentToken);guacd=new GuacdFixture();key=Fixtures.key("fixture");client=HttpClient.newHttpClient();
        c=Fixtures.agentConfig(dir,guacd.server.getLocalPort(),"https://gateway.fixture.test",agent.port,tokenFile);
        start(c);
    }
    void start(Config config) throws Exception {
        time=new Fixtures.Time();time.now=Instant.now();
        runtime=new Main.Runtime(config,new AccessVerifier(config,time,()->new JWKSet(key.toPublicJWK()).toString()),new GuacdConnector(config),time,time.nano::get);
        port=runtime.port();token=Fixtures.token(config,key,time.instant(),3600,Map.of());
        var response=request("POST","/api/session/bootstrap","{}",token,null,null,config.origin());assertEquals(200,response.statusCode(),response.body());
        cookie=response.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];csrf=Config.JSON.readTree(response.body()).path("csrfToken").asText();
    }
    @AfterEach void close() throws Exception {if(runtime!=null)runtime.close();if(agent!=null)agent.close();if(guacd!=null)guacd.close();}

    HttpResponse<String> request(String method,String path,String body,String assertion,String cookie,String csrf,String origin) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Host","gateway.fixture.test").header("Content-Type","application/json");
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(cookie!=null)b.header("Cookie",cookie);if(csrf!=null)b.header("X-RDG-CSRF",csrf);if(origin!=null)b.header("Origin",origin);
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<String> call(String method,String path,String body) throws Exception {return request(method,path,body,token,cookie,csrf,c.origin());}
    String intent(String mode,String backend) throws Exception {
        var r=call("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\""+mode+"\",\"keyboardProfile\":\"windows-native\""+(backend==null?"":",\"backend\":\""+backend+"\"")+"}");
        assertEquals(201,r.statusCode(),r.body());return Config.JSON.readTree(r.body()).path("intentId").asText();
    }
    void consent() throws Exception {assertEquals(200,call("POST","/api/clipboard-consent","{\"enabled\":true}").statusCode());}

    /** The browser end: collects what the gateway sends and can stall reading to model a slow link. */
    static final class Browser implements WebSocket.Listener {
        final List<String> texts=new CopyOnWriteArrayList<>();final AtomicLong binaries=new AtomicLong(),bytes=new AtomicLong();
        final AtomicBoolean closed=new AtomicBoolean();volatile WebSocket socket;volatile CompletableFuture<Void> gate=CompletableFuture.completedFuture(null);
        private final StringBuilder partial=new StringBuilder();
        @Override public void onOpen(WebSocket ws){socket=ws;ws.request(1);}
        @Override public CompletionStage<?> onText(WebSocket ws,CharSequence data,boolean last){
            partial.append(data);if(last){texts.add(partial.toString());partial.setLength(0);}ws.request(1);return null;
        }
        @Override public CompletionStage<?> onBinary(WebSocket ws,ByteBuffer data,boolean last){
            bytes.addAndGet(data.remaining());if(last)binaries.incrementAndGet();
            // The JDK client delivers on demand, not on the returned stage: withhold request(1) until resumed to model a slow reader.
            gate.thenRun(()->ws.request(1));return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket ws,int code,String reason){closed.set(true);return null;}
        @Override public void onError(WebSocket ws,Throwable t){closed.set(true);}
        void send(String text) throws Exception {socket.sendText(text,true).get(4,TimeUnit.SECONDS);}
        void pause(){gate=new CompletableFuture<>();}
        void resume(){gate.complete(null);}
        List<JsonNode> messages() {return texts.stream().map(t->{try{return Config.JSON.readTree(t);}catch(Exception e){throw new AssertionError(e);}}).toList();}
        boolean has(String type) {return messages().stream().anyMatch(m->type.equals(m.path("t").asText()));}
        String errorCode() {return messages().stream().filter(m->"error".equals(m.path("t").asText())).map(m->m.path("code").asText()).findFirst().orElse(null);}
    }
    CompletableFuture<WebSocket> open(String path,String protocol,String assertion,String appCookie,String origin,Browser browser) {
        var b=client.newWebSocketBuilder().header("Host","gateway.fixture.test");if(protocol!=null)b.subprotocols(protocol);
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(appCookie!=null)b.header("Cookie",appCookie);if(origin!=null)b.header("Origin",origin);
        return b.buildAsync(URI.create("ws://127.0.0.1:"+port+path),browser);
    }
    Browser connect(String intentId) throws Exception {
        var browser=new Browser();open("/ws/agent/"+intentId,AgentPolicy.PROTOCOL,token,cookie,c.origin(),browser).get(4,TimeUnit.SECONDS);return browser;
    }
    static void until(java.util.function.BooleanSupplier condition) throws Exception {
        long end=System.nanoTime()+Duration.ofSeconds(5).toNanos();while(!condition.getAsBoolean()&&System.nanoTime()<end)Thread.sleep(20);assertTrue(condition.getAsBoolean());
    }
    void handshakeFailure(int status,CompletableFuture<WebSocket> attempt) {
        var failure=assertThrows(ExecutionException.class,()->attempt.get(4,TimeUnit.SECONDS));
        assertEquals(status,assertInstanceOf(WebSocketHandshakeException.class,failure.getCause()).getResponse().statusCode());
    }

    @Test void streamsReadyConfigVideoAndRelaysValidatedInput() throws Exception {
        var browser=connect(intent("control","agent"));
        until(()->browser.has("ready")&&browser.has("config")&&browser.binaries.get()>=1);
        var ready=browser.messages().get(0);assertEquals("ready",ready.path("t").asText());assertTrue(ready.path("control").asBoolean());assertFalse(ready.path("clipboard").asBoolean());
        var hello=Config.JSON.readTree(agent.hellos.get(0));assertEquals(agentToken,hello.path("token").asText());assertTrue(hello.path("control").asBoolean());assertFalse(hello.path("clipboard").asBoolean());
        until(()->!agent.received.isEmpty());assertEquals("{\"t\":\"rate\",\"kbps\":4000}",agent.received.get(0));   // Balanced picture mode, server-owned
        browser.send("{ \"t\":\"k\", \"s\":99, \"d\":true }");until(()->agent.received.contains("{\"t\":\"k\",\"s\":99,\"d\":true}"));
        long before=browser.binaries.get();browser.send("{\"t\":\"kf\"}");until(()->browser.binaries.get()>before);
        assertEquals(1,agent.connections.get());
        var session=Config.JSON.readTree(call("GET","/api/session",null).body());assertTrue(session.path("activeDesktop").asBoolean());
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());
        until(()->browser.closed.get()&&agent.closed.get()==1);
    }

    @Test void auditAndDiagnosticsNeverRecordTypedTextOrTheToken() throws Exception {
        consent();var browser=connect(intent("control","agent"));until(()->browser.has("ready"));
        browser.send("{\"t\":\"type\",\"text\":\"typed-sentinel-91\"}");browser.send("{\"t\":\"clip\",\"text\":\"clip-sentinel-92\"}");
        until(()->agent.received.contains("{\"t\":\"type\",\"text\":\"typed-sentinel-91\"}")&&agent.received.contains("{\"t\":\"clip\",\"text\":\"clip-sentinel-92\"}"));
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());until(()->agent.closed.get()==1);
        String history=call("GET","/api/history",null).body(),diagnostics=call("GET","/api/diagnostics",null).body();
        for(String body:List.of(history,diagnostics)){assertFalse(body.contains("sentinel"));assertFalse(body.contains(agentToken));}
        assertTrue(history.contains("CONNECT"));assertTrue(Config.JSON.readTree(diagnostics).path("backends").toString().equals("[\"vnc\",\"agent\"]"));
        try(var files=Files.walk(c.stateDir())){for(Path f:files.filter(Files::isRegularFile).toList()){String text=Files.readString(f,java.nio.charset.StandardCharsets.ISO_8859_1);assertFalse(text.contains("sentinel"),f.toString());assertFalse(text.contains(agentToken),f.toString());}}
    }

    @Test void clipboardFlowsBothWaysOnlyWithRecordedConsent() throws Exception {
        consent();var browser=connect(intent("control","agent"));until(()->browser.has("ready"));
        assertTrue(Config.JSON.readTree(agent.hellos.get(0)).path("clipboard").asBoolean());assertTrue(browser.messages().get(0).path("clipboard").asBoolean());
        agent.push("{\"t\":\"clip\",\"text\":\"from the mac\"}");until(()->browser.has("clip"));
    }

    @Test void macClipboardIsDroppedWithoutConsentAndNeverReachesTheBrowser() throws Exception {
        var browser=connect(intent("control","agent"));until(()->browser.has("ready"));
        assertFalse(Config.JSON.readTree(agent.hellos.get(0)).path("clipboard").asBoolean());
        agent.push("{\"t\":\"clip\",\"text\":\"leak\"}");agent.push("{\"t\":\"status\",\"secureInput\":false,\"sent\":1,\"dropped\":0,\"bytes\":9}");
        until(()->browser.has("status"));assertFalse(browser.has("clip"));
        browser.send("{\"t\":\"clip\",\"text\":\"to the mac\"}");until(()->"INPUT_DENIED".equals(browser.errorCode()));until(()->browser.closed.get());
        assertTrue(agent.received.stream().noneMatch(m->m.contains("to the mac")));
    }

    @Test void viewOnlySessionNeverForwardsInput() throws Exception {
        var browser=connect(intent("view","agent"));until(()->browser.has("ready"));
        assertFalse(Config.JSON.readTree(agent.hellos.get(0)).path("control").asBoolean());assertFalse(browser.messages().get(0).path("control").asBoolean());
        browser.send("{\"t\":\"k\",\"s\":99,\"d\":true}");until(()->"READ_ONLY".equals(browser.errorCode()));until(()->browser.closed.get()&&agent.closed.get()==1);
        assertTrue(agent.received.stream().noneMatch(m->m.contains("\"t\":\"k\"")));
    }

    @Test void invalidBrowserMessageEndsTheSessionWithAFixedCodeAndClosesTheAgent() throws Exception {
        var browser=connect(intent("control","agent"));until(()->browser.has("ready"));
        browser.send("{\"t\":\"exec\",\"cmd\":\"id\"}");until(()->"INPUT_DENIED".equals(browser.errorCode()));until(()->browser.closed.get()&&agent.closed.get()==1);
        assertTrue(agent.received.stream().noneMatch(m->m.contains("exec")));
        var status=Config.JSON.readTree(call("GET","/api/session",null).body());assertFalse(status.path("activeDesktop").asBoolean());
    }

    @Test void agentErrorsBecomeFixedCodesForTheBrowser() throws Exception {
        agent.mode=AgentFixture.Mode.ERROR_AFTER_HELLO;
        var denied=connect(intent("control","agent"));until(()->denied.closed.get());assertEquals("SCREEN_RECORDING_NOT_PERMITTED",denied.errorCode());assertFalse(denied.has("ready"));
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());
        agent.mode=AgentFixture.Mode.CLOSE_AFTER_HELLO;
        var closedEarly=connect(intent("control","agent"));until(()->closedEarly.closed.get());assertEquals("AGENT_AUTH_FAILED",closedEarly.errorCode());
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());
        var wrong=Files.writeString(dir.resolve("other-token"),Sessions.random());Files.setPosixFilePermissions(wrong,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
        runtime.close();c=Fixtures.agentConfig(dir.resolve("again"),guacd.server.getLocalPort(),"https://gateway.fixture.test",agent.port,wrong);agent.mode=AgentFixture.Mode.NORMAL;start(c);
        var rejected=connect(intent("control","agent"));until(()->rejected.closed.get());assertEquals("AGENT_AUTH_FAILED",rejected.errorCode());   // wrong token: the agent answers nothing
    }

    @Test void unreachableAgentIsReportedAsUnavailable() throws Exception {
        agent.close();
        var browser=connect(intent("control","agent"));until(()->browser.closed.get());assertEquals("AGENT_UNAVAILABLE",browser.errorCode());
        assertFalse(Config.JSON.readTree(call("GET","/api/session",null).body()).path("activeDesktop").asBoolean());
        agent=null;
    }

    @Test void aMisbehavingAgentEndsTheSessionWithProtocolError() throws Exception {
        agent.mode=AgentFixture.Mode.OVERSIZED_STATUS;
        var big=connect(intent("control","agent"));until(()->big.closed.get());assertEquals("AGENT_PROTOCOL",big.errorCode());until(()->agent.closed.get()==1);
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());
        agent.mode=AgentFixture.Mode.BAD_VIDEO;
        var bad=connect(intent("control","agent"));until(()->bad.closed.get());assertEquals("AGENT_PROTOCOL",bad.errorCode());until(()->agent.closed.get()==2);
    }

    @Test void routeAndSubprotocolBelongToTheirBackend() throws Exception {
        String vnc=intent("view","vnc");
        handshakeFailure(400,open("/ws/agent/"+vnc,AgentPolicy.PROTOCOL,token,cookie,c.origin(),new Browser()));   // wrong backend, refused before consumption
        handshakeFailure(400,open("/ws/agent/"+vnc,"guacamole",token,cookie,c.origin(),new Browser()));
        handshakeFailure(400,open("/ws/agent/"+vnc,null,token,cookie,c.origin(),new Browser()));
        var guac=open("/ws/sessions/"+vnc,"guacamole",token,cookie,c.origin(),new Browser()).get(4,TimeUnit.SECONDS);   // the intent is still unused
        until(()->guacd.parameters.containsKey("read-only"));assertEquals(0,agent.connections.get());
        assertEquals(204,call("DELETE","/api/desktop-session",null).statusCode());until(()->guac.isInputClosed());
        String forAgent=intent("view","agent");
        handshakeFailure(400,open("/ws/sessions/"+forAgent,"guacamole",token,cookie,c.origin(),new Browser()));
        var browser=new Browser();open("/ws/agent/"+forAgent,AgentPolicy.PROTOCOL,token,cookie,c.origin(),browser).get(4,TimeUnit.SECONDS);until(()->browser.has("ready"));
    }

    @Test void agentRouteKeepsTheGatewayGuards() throws Exception {
        String id=intent("view","agent");
        handshakeFailure(401,open("/ws/agent/"+id,AgentPolicy.PROTOCOL,null,cookie,c.origin(),new Browser()));      // no signed identity
        handshakeFailure(401,open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,null,c.origin(),new Browser()));       // no app cookie
        handshakeFailure(403,open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,cookie,"https://evil.test",new Browser()));
        handshakeFailure(403,open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,cookie,null,new Browser()));
        handshakeFailure(400,open("/ws/agent/short",AgentPolicy.PROTOCOL,token,cookie,c.origin(),new Browser()));
        assertEquals(0,agent.connections.get());
        var browser=new Browser();open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,cookie,c.origin(),browser).get(4,TimeUnit.SECONDS);until(()->browser.has("ready"));
        handshakeFailure(409,open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,cookie,c.origin(),new Browser()));          // intent already consumed
    }

    @Test void agentIntentsAreRefusedWhenTheServerFlagIsOff() throws Exception {
        runtime.close();c=Fixtures.config(dir.resolve("off"),guacd.server.getLocalPort(),"https://gateway.fixture.test");start(c);
        var r=call("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\"view\",\"keyboardProfile\":\"windows-native\",\"backend\":\"agent\"}");
        assertEquals(503,r.statusCode());assertEquals("AGENT_DISABLED",Config.JSON.readTree(r.body()).path("code").asText());
        assertEquals("[\"vnc\"]",Config.JSON.readTree(call("GET","/api/diagnostics",null).body()).path("backends").toString());
        handshakeFailure(503,open("/ws/agent/"+"A".repeat(43),AgentPolicy.PROTOCOL,token,cookie,c.origin(),new Browser()));
        assertEquals(0,agent.connections.get());
        var unknown=call("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\"view\",\"keyboardProfile\":\"windows-native\",\"backend\":\"rdp\"}");assertEquals(400,unknown.statusCode());
        assertEquals(201,call("POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\"view\",\"keyboardProfile\":\"windows-native\"}").statusCode());   // default stays VNC
    }

    @Test void ending_the_app_session_or_the_idle_deadline_closes_the_agent_connection() throws Exception {
        var first=connect(intent("control","agent"));until(()->first.has("ready"));
        time.advance(Sessions.IDLE_NANOS/1_000_000_000L+1);runtime.sessions.tick();
        until(()->first.closed.get()&&agent.closed.get()==1);
        var second=connect(intent("control","agent"));until(()->second.has("ready"));
        assertEquals(204,call("DELETE","/api/session",null).statusCode());
        until(()->second.closed.get()&&agent.closed.get()==2);
    }

    @Test void aStalledBrowserBackPressuresTheAgentWithoutQueueingAndInputStillFlows() throws Exception {
        agent.mode=AgentFixture.Mode.BLAST;
        String id=intent("control","agent");var browser=new Browser();browser.pause();
        open("/ws/agent/"+id,AgentPolicy.PROTOCOL,token,cookie,c.origin(),browser).get(4,TimeUnit.SECONDS);
        until(()->browser.has("ready")&&agent.framesSent.get()>2);
        Thread.sleep(1200);long plateau=agent.framesSent.get();Thread.sleep(800);long later=agent.framesSent.get();
        assertTrue(later-plateau<=1,"the agent must stall while the browser does not read: "+plateau+" -> "+later);
        // 512 KiB frames: socket buffers on two hops hold a bounded number; an unbounded gateway queue would let this run away.
        assertTrue(later*agent.blastBytes<256L*1024*1024,"frames the agent could push: "+later);
        // A stalled video send must not block input in the other direction.
        long start=System.nanoTime();browser.send("{\"t\":\"k\",\"s\":65,\"d\":true}");until(()->agent.received.contains("{\"t\":\"k\",\"s\":65,\"d\":true}"));
        assertTrue(Duration.ofNanos(System.nanoTime()-start).toMillis()<1500);
        long delivered=browser.binaries.get();browser.resume();
        until(()->agent.framesSent.get()>later+20&&browser.binaries.get()>delivered+20);
        assertFalse(browser.closed.get());
    }
}

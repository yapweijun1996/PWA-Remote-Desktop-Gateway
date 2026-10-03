package com.rdg;

import com.nimbusds.jose.jwk.JWKSet;
import org.apache.guacamole.io.*;
import org.apache.guacamole.protocol.GuacamoleInstruction;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

/** Test classpath only: official daemon interoperability and unreachable-target cleanup. */
public final class OfficialGuacdCheckMain {
    private static final String ORIGIN="https://official-guacd.fixture.test";
    private static void require(boolean condition,String reason) {
        if(!condition)throw new IllegalStateException(reason);
    }
    private static void probe() throws Exception {
        long deadline=System.nanoTime()+Duration.ofSeconds(10).toNanos();
        while(true) {
            try(Socket raw=new Socket()) {
                raw.connect(new InetSocketAddress("127.0.0.1",4822),500);raw.setSoTimeout(5000);
                var writer=new WriterGuacamoleWriter(new OutputStreamWriter(raw.getOutputStream(),StandardCharsets.UTF_8));
                var reader=new ReaderGuacamoleReader(new InputStreamReader(raw.getInputStream(),StandardCharsets.UTF_8));
                writer.writeInstruction(new GuacamoleInstruction("select","vnc"));
                var args=reader.readInstruction();
                require(args!=null&&args.getOpcode().equals("args")&&args.getArgs().containsAll(List.of("hostname","port","password","read-only","disable-copy","disable-paste")),"OFFICIAL_VNC_ARGUMENTS_MISSING");
                return;
            }catch(ConnectException e) {
                if(System.nanoTime()>=deadline)throw e;Thread.sleep(100);
            }
        }
    }
    private static HttpResponse<String> request(HttpClient client,int port,String token,String cookie,String csrf,String method,String path,String body) throws Exception {
        var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(Duration.ofSeconds(10))
            .header("Host","official-guacd.fixture.test").header("Origin",ORIGIN).header("Cf-Access-Jwt-Assertion",token).header("Content-Type","application/json");
        if(cookie!=null)builder.header("Cookie",cookie);if(csrf!=null)builder.header("X-RDG-CSRF",csrf);
        return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    public static void main(String[] args) throws Exception {
        java.util.logging.LogManager.getLogManager().reset();System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");
        probe();System.out.println("PASS: official guacd VNC plugin exposes the expected maintained-library argument contract.");
        // This namespace has no network interface except loopback and no VNC listener.
        try(ServerSocket unused=new ServerSocket(5900,1,InetAddress.getLoopbackAddress())){}
        Path dir=Files.createTempDirectory("rdg-official-guacd-");
        var config=Fixtures.config(dir,4822,ORIGIN,Path.of("/app/web"));var key=Fixtures.key("ephemeral-official-guacd");
        String token=Fixtures.token(config,key,Instant.now(),3600,Map.of());
        try(var runtime=new Main.Runtime(config,new AccessVerifier(config,Clock.systemUTC(),()->new JWKSet(key.toPublicJWK()).toString()),new GuacdConnector(config))) {
            var client=HttpClient.newHttpClient();
            var bootstrap=request(client,runtime.port(),token,null,null,"POST","/api/session/bootstrap","{}");
            require(bootstrap.statusCode()==200,"SIGNED_BOOTSTRAP_FAILED");
            String cookie=bootstrap.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
            String csrf=Config.JSON.readTree(bootstrap.body()).path("csrfToken").asText();
            for(String mode:List.of("control","view")) {
                var intent=request(client,runtime.port(),token,cookie,csrf,"POST","/api/connect-intents","{\"deviceId\":\"fixture-mac\",\"mode\":\""+mode+"\",\"keyboardProfile\":\"windows-native\"}");
                require(intent.statusCode()==201,"LEASE_NOT_AVAILABLE");
                String id=Config.JSON.readTree(intent.body()).path("intentId").asText();
                var closed=new CompletableFuture<String>();
                var socket=client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(10)).subprotocols("guacamole")
                    .header("Host","official-guacd.fixture.test").header("Origin",ORIGIN).header("Cf-Access-Jwt-Assertion",token).header("Cookie",cookie)
                    .buildAsync(URI.create("ws://127.0.0.1:"+runtime.port()+"/ws/sessions/"+id+"?"),new WebSocket.Listener() {
                        public void onOpen(WebSocket ws){ws.request(Long.MAX_VALUE);}
                        public CompletionStage<?> onText(WebSocket ws,CharSequence message,boolean last){ws.request(1);return null;}
                        public CompletionStage<?> onClose(WebSocket ws,int status,String reason){closed.complete(reason);return null;}
                        public void onError(WebSocket ws,Throwable failure){closed.completeExceptionally(failure);}
                    }).get(12,TimeUnit.SECONDS);
                String reason=closed.get(15,TimeUnit.SECONDS);
                require(Set.of("TARGET_UNAVAILABLE","DISCONNECTED").contains(reason),"UNEXPECTED_CLOSE_REASON");
                require(socket.isInputClosed(),"BROWSER_NOT_CLOSED");
                var state=request(client,runtime.port(),token,cookie,null,"GET","/api/session",null);
                var body=Config.JSON.readTree(state.body());
                require(state.statusCode()==200&&body.path("activeDesktop").isBoolean()&&!body.path("activeDesktop").booleanValue()
                    &&body.path("nodeActiveDesktops").isInt()&&body.path("nodeActiveDesktops").intValue()==0,"UPSTREAM_FAILURE_LEAKED_LEASE");
                System.out.println("PASS: "+mode+" request through the production HTTP/WebSocket gateway closes after official guacd target failure and releases its lease.");
            }
        }
        System.out.println("SCOPE: official guacd failure path only; no real VNC desktop, Mac, Cloudflare account or public port.");
    }
}

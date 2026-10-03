package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.nimbusds.jose.jwk.JWKSet;
import org.apache.guacamole.net.GuacamoleTunnel;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Real loopback HTTP security filter, disposable signer and encrypted fixture credential. */
class OwnerSetupGatewayIntegrationTest {
    @TempDir Path directory;
    Config config;Main.Runtime runtime;HttpClient client;
    String token,cookie,csrf,wrongOwner;AtomicInteger upstreamCalls=new AtomicInteger();
    @BeforeEach void setup() throws Exception {
        System.setProperty("jdk.httpclient.allowRestrictedHeaders","host");java.util.logging.LogManager.getLogManager().reset();
        config=Fixtures.ownerSetupConfig(directory,"https://gateway.fixture.test");var clock=new Fixtures.Time();clock.now=Instant.now();var key=Fixtures.key("owner-setup-fixture");
        var connector=new GuacdConnector(config) {
            @Override GuacamoleTunnel open(Sessions.Desktop desktop){upstreamCalls.incrementAndGet();throw new AssertionError("HTTP setup tests reached upstream");}
        };
        runtime=new Main.Runtime(config,new AccessVerifier(config,clock,()->new JWKSet(key.toPublicJWK()).toString()),connector,clock,clock.nano::get);
        client=HttpClient.newHttpClient();token=Fixtures.token(config,key,clock.instant(),3600,Map.of());
        wrongOwner=Fixtures.token(config,key,clock.instant(),3600,Map.of("email","other@fixture.test"));
        var response=request("POST","/api/session/bootstrap","{}",token,null,null,config.origin(),"gateway.fixture.test");assertEquals(200,response.statusCode());
        cookie=response.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];csrf=Config.JSON.readTree(response.body()).path("csrfToken").asText();
    }
    @AfterEach void close() throws Exception {if(runtime!=null)runtime.close();assertEquals(0,upstreamCalls.get());}
    HttpResponse<String> request(String method,String path,String body,String assertion,String appCookie,String csrfValue,String origin,String host) throws Exception {
        var b=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+runtime.port()+path)).header("Host",host).header("Content-Type","application/json");
        if(assertion!=null)b.header("Cf-Access-Jwt-Assertion",assertion);if(appCookie!=null)b.header("Cookie",appCookie);
        if(csrfValue!=null)b.header("X-RDG-CSRF",csrfValue);if(origin!=null)b.header("Origin",origin);
        return client.send(b.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());
    }
    HttpResponse<String> setupCredential(String body) throws Exception {return request("POST","/api/desktop/credential",body,token,cookie,csrf,config.origin(),"gateway.fixture.test");}
    @Test void credentialSetupRequiresSignedOwnerAppCsrfHostAndOrigin() throws Exception {
        String body="{\"password\":\"fixture-only-private-marker\"}";
        assertEquals(401,request("POST","/api/desktop/credential",body,null,cookie,csrf,config.origin(),"gateway.fixture.test").statusCode());
        assertEquals(401,request("POST","/api/desktop/credential",body,"forged",cookie,csrf,config.origin(),"gateway.fixture.test").statusCode());
        assertEquals(403,request("POST","/api/desktop/credential",body,wrongOwner,cookie,csrf,config.origin(),"gateway.fixture.test").statusCode());
        assertEquals(401,request("POST","/api/desktop/credential",body,token,null,csrf,config.origin(),"gateway.fixture.test").statusCode());
        assertEquals(403,request("POST","/api/desktop/credential",body,token,cookie,"wrong",config.origin(),"gateway.fixture.test").statusCode());
        assertEquals(403,request("POST","/api/desktop/credential",body,token,cookie,csrf,"https://other.fixture.test","gateway.fixture.test").statusCode());
        assertEquals(403,request("POST","/api/desktop/credential",body,token,cookie,csrf,config.origin(),"other.fixture.test").statusCode());
        assertFalse(config.credentialConfigured());
    }
    @Test void closedBodyAndBoundedPasswordRejectTargetInjectionAndMalformedValues() throws Exception {
        for(String body:List.of("{\"password\":\"fixture-only\",\"host\":\"evil\"}","{\"password\":\"fixture-only\",\"deviceId\":\"other\"}",
                "{\"password\":\"first\",\"password\":\"second\"}","{}","{\"password\":3}","{\"password\":\"\"}",
                "{\"password\":\"line\\nnext\"}","{\"password\":\""+"x".repeat(129)+"\"}")) {
            var response=setupCredential(body);assertEquals(400,response.statusCode());assertFalse(response.body().contains("fixture-only"));
        }
        assertFalse(config.credentialConfigured());
    }
    @Test void provisionEnablesIntentWithTruthfulStatusAndActiveReplaceRefusalWithoutSecretExposure() throws Exception {
        var before=Config.JSON.readTree(request("GET","/api/devices",null,token,cookie,null,null,"gateway.fixture.test").body()).get(0);
        assertEquals("BLOCKED",before.path("status").asText());assertEquals("VNC_CREDENTIAL_REQUIRED",before.path("blockedReason").asText());
        assertTrue(before.path("credentialSetupEnabled").booleanValue());assertFalse(before.path("credentialConfigured").booleanValue());
        assertEquals("UNVERIFIED_TEST_PROFILE",before.path("keyboardCalibration").asText());
        var provision=setupCredential("{\"password\":\"fixture-only-private-marker\"}");assertEquals(200,provision.statusCode());
        var result=Config.JSON.readTree(provision.body());assertTrue(result.path("desktopEnabled").booleanValue());assertEquals(5,result.size());
        assertEquals("UNVERIFIED_TEST_PROFILE",result.path("keyboardCalibration").asText());
        var device=Config.JSON.readTree(request("GET","/api/devices",null,token,cookie,null,null,"gateway.fixture.test").body()).get(0);
        assertEquals("GATEWAY_REACHABLE",device.path("status").asText());assertFalse(device.has("blockedReason"));
        String body="{\"deviceId\":\"fixture-mac\",\"mode\":\"control\",\"keyboardProfile\":\"mac-native\"}";
        assertEquals(201,request("POST","/api/connect-intents",body,token,cookie,csrf,config.origin(),"gateway.fixture.test").statusCode());
        var busy=setupCredential("{\"password\":\"fixture-only-replacement\"}");assertEquals(409,busy.statusCode());assertEquals("CONTROL_BUSY",Config.JSON.readTree(busy.body()).path("code").asText());
        var diagnostic=request("GET","/api/diagnostics",null,token,cookie,null,null,"gateway.fixture.test");
        var history=request("GET","/api/history",null,token,cookie,null,null,"gateway.fixture.test");
        for(String output:List.of(provision.body(),device.toString(),diagnostic.body(),history.body(),busy.body(),Files.readString(config.stateDir().resolve("credentials/vnc.json")))) {
            assertFalse(output.contains("fixture-only-private-marker"));assertFalse(output.contains("fixture-only-replacement"));
            assertFalse(output.contains(config.credentialStore().keyFile().toString()));
        }
    }
}

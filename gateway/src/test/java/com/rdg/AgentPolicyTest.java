package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.ByteBuffer;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class AgentPolicyTest {
    @TempDir Path dir;Fixtures.Time time;Audit audit;Sessions sessions;Sessions.App app;Config config;

    @BeforeEach void setup() throws Exception {
        time=new Fixtures.Time();config=Fixtures.agentConfig(dir,4822,"https://gateway.fixture.test",5960,Fixtures.agentTokenFile(dir));
        audit=new Audit(config.stateDir(),time,config.nodeId());sessions=new Sessions(config,time,time.nano::get,audit);
        app=sessions.bootstrap(new AccessVerifier.Identity("owner",time.instant().plusSeconds(3600)),null).getValue();
    }
    @AfterEach void close() throws Exception {sessions.close();audit.close();}

    AgentPolicy policy(String mode,boolean clipboard) {
        if(clipboard)sessions.clipboard(app,true);
        var intent=sessions.intent(app,"fixture-mac",mode,"windows-native",DisplayQuality.BALANCED.id,"agent");
        return new AgentPolicy(sessions.begin(app,intent.id,"agent"));
    }
    static Failure refused(int status,String code,org.junit.jupiter.api.function.Executable action) {
        Failure f=assertThrows(Failure.class,action);assertEquals(status,f.status);assertEquals(code,f.code);return f;
    }

    @Test void helloCarriesOnlyServerOwnedFields() throws Exception {
        var hello=Config.JSON.readTree(AgentPolicy.hello("T".repeat(43),true,false));
        assertEquals(5,hello.size());assertEquals("hello",hello.path("t").asText());assertEquals(1,hello.path("v").asInt());
        assertEquals("T".repeat(43),hello.path("token").asText());assertTrue(hello.path("control").asBoolean());assertFalse(hello.path("clipboard").asBoolean());
    }

    @Test void validInputIsReserialisedFromKnownFieldsOnly() {
        var p=policy("control",true);
        assertEquals("{\"t\":\"k\",\"s\":99,\"d\":true}",p.toAgent("{ \"t\":\"k\", \"s\":99, \"d\":true }"));
        assertEquals("{\"t\":\"m\",\"x\":10,\"y\":20,\"b\":1}",p.toAgent("{\"t\":\"m\",\"x\":10,\"y\":20,\"b\":1}"));
        assertEquals("{\"t\":\"w\",\"x\":5,\"y\":6,\"dy\":-120}",p.toAgent("{\"t\":\"w\",\"x\":5,\"y\":6,\"dy\":-120}"));
        assertEquals("{\"t\":\"clip\",\"text\":\"héllo \\\"q\\\"\"}",p.toAgent("{\"t\":\"clip\",\"text\":\"héllo \\\"q\\\"\"}"));
        assertEquals("{\"t\":\"type\",\"text\":\"你好\"}",p.toAgent("{\"t\":\"type\",\"text\":\"你好\"}"));
        assertEquals("{\"t\":\"release\"}",p.toAgent("{\"t\":\"release\"}"));
        assertEquals("{\"t\":\"kf\"}",p.toAgent("{\"t\":\"kf\"}"));
        assertEquals("{\"t\":\"rate\",\"kbps\":4000}",p.toAgent("{\"t\":\"rate\",\"kbps\":4000}"));
    }

    @Test void malformedUnknownAndOutOfRangeMessagesAreRefused() {
        var p=policy("control",true);
        for(String bad:new String[]{"not json","[]","{}","{\"t\":\"hello\",\"v\":1,\"token\":\"x\",\"control\":true,\"clipboard\":true}","{\"t\":\"exec\"}",
            "{\"t\":\"k\",\"s\":99,\"d\":true,\"x\":1}","{\"t\":\"k\",\"s\":99}","{\"t\":\"k\",\"s\":0,\"d\":true}","{\"t\":\"k\",\"s\":536870912,\"d\":true}","{\"t\":\"k\",\"s\":\"99\",\"d\":true}","{\"t\":\"k\",\"s\":99,\"d\":1}",
            "{\"t\":\"m\",\"x\":-1,\"y\":0,\"b\":0}","{\"t\":\"m\",\"x\":32768,\"y\":0,\"b\":0}","{\"t\":\"m\",\"x\":1.5,\"y\":0,\"b\":0}","{\"t\":\"m\",\"x\":0,\"y\":0,\"b\":32}",
            "{\"t\":\"w\",\"x\":0,\"y\":0,\"dy\":4001}","{\"t\":\"w\",\"x\":0,\"y\":0,\"dy\":-4001}","{\"t\":\"w\",\"x\":0,\"y\":0}",
            "{\"t\":\"rate\",\"kbps\":499}","{\"t\":\"rate\",\"kbps\":12001}","{\"t\":\"clip\",\"text\":\"\"}","{\"t\":\"type\",\"text\":\"a\\u0000b\"}","{\"t\":\"release\",\"x\":1}"})
            assertThrows(Failure.class,()->p.toAgent(bad),bad);
    }

    @Test void zeroScrollIsDenied() {refused(403,"INPUT_DENIED",()->policy("control",false).toAgent("{\"t\":\"w\",\"x\":0,\"y\":0,\"dy\":0}"));}

    @Test void viewOnlyAllowsOnlyKeyframeReleaseAndRate() {
        var p=policy("view",false);
        assertEquals("{\"t\":\"kf\"}",p.toAgent("{\"t\":\"kf\"}"));assertEquals("{\"t\":\"release\"}",p.toAgent("{\"t\":\"release\"}"));
        assertEquals("{\"t\":\"rate\",\"kbps\":2000}",p.toAgent("{\"t\":\"rate\",\"kbps\":2000}"));
        for(String input:new String[]{"{\"t\":\"k\",\"s\":99,\"d\":true}","{\"t\":\"m\",\"x\":1,\"y\":1,\"b\":0}","{\"t\":\"w\",\"x\":1,\"y\":1,\"dy\":10}","{\"t\":\"type\",\"text\":\"a\"}","{\"t\":\"clip\",\"text\":\"a\"}"})
            refused(403,"READ_ONLY",()->p.toAgent(input));
    }

    @Test void clipboardNeedsRecordedConsent() {
        refused(403,"INPUT_DENIED",()->policy("control",false).toAgent("{\"t\":\"clip\",\"text\":\"secret\"}"));
    }

    @Test void clipboardAndTypeSizeCapsAreInUtf8Bytes() {
        var p=policy("control",true);
        assertDoesNotThrow(()->p.toAgent("{\"t\":\"clip\",\"text\":\""+"a".repeat(AgentPolicy.CLIP)+"\"}"));
        assertThrows(Failure.class,()->p.toAgent("{\"t\":\"clip\",\"text\":\""+"a".repeat(AgentPolicy.CLIP+1)+"\"}"));
        assertThrows(Failure.class,()->p.toAgent("{\"t\":\"clip\",\"text\":\""+"é".repeat(AgentPolicy.CLIP/2+1)+"\"}"));   // 2 bytes each
        assertDoesNotThrow(()->p.toAgent("{\"t\":\"type\",\"text\":\""+"b".repeat(AgentPolicy.TYPE)+"\"}"));
        assertThrows(Failure.class,()->p.toAgent("{\"t\":\"type\",\"text\":\""+"b".repeat(AgentPolicy.TYPE+1)+"\"}"));
        assertThrows(Failure.class,()->p.toAgent("{\"t\":\"k\",\"s\":99,\"d\":true,\"pad\":\""+"x".repeat(AgentPolicy.RAW_MAX)+"\"}"));
    }

    @Test void messageRateAndScrollRateAreCapped() {
        var p=policy("control",false);
        for(int i=0;i<120;i++)p.toAgent("{\"t\":\"w\",\"x\":1,\"y\":1,\"dy\":3}");
        refused(429,"RATE_LIMITED",()->p.toAgent("{\"t\":\"w\",\"x\":1,\"y\":1,\"dy\":3}"));
        var q=policy2();
        for(int i=0;i<1000;i++)q.toAgent("{\"t\":\"kf\"}");
        refused(429,"RATE_LIMITED",()->q.toAgent("{\"t\":\"kf\"}"));
    }
    private AgentPolicy policy2() {
        sessions.endDesktop(app,"TEST");   // one desktop per app
        return policy("view",false);
    }

    @Test void inputKeepsTheIdleClockAliveButVideoDoesNot() {
        var intent=sessions.intent(app,"fixture-mac","control","windows-native",DisplayQuality.BALANCED.id,"agent");
        var desktop=sessions.begin(app,intent.id,"agent");var p=new AgentPolicy(desktop);
        time.advance(600);long before=desktop.lastInput;
        p.fromAgent("{\"t\":\"status\",\"secureInput\":false,\"sent\":1,\"dropped\":0,\"bytes\":5}");AgentPolicy.checkVideo(ByteBuffer.wrap(AgentFixture.frame(false,1,8)));
        assertEquals(before,desktop.lastInput);
        p.toAgent("{\"t\":\"k\",\"s\":99,\"d\":true}");assertTrue(desktop.lastInput>before);
        time.advance(Sessions.IDLE_NANOS/1_000_000_000L+1);
        refused(401,"SESSION_EXPIRED",()->p.toAgent("{\"t\":\"k\",\"s\":99,\"d\":false}"));
    }

    // ---- agent -> browser ----------------------------------------------------------------------------------------------

    @Test void readyIsPassedOnWithoutExtraFields() throws Exception {
        var p=policy("control",true);
        var out=Config.JSON.readTree(p.fromAgent("{\"t\":\"ready\",\"v\":1,\"width\":1920,\"height\":1080,\"control\":true,\"controlReason\":\"GRANTED\",\"clipboard\":true,\"encoder\":\"ll\",\"hostname\":\"leak\"}"));
        assertEquals(8,out.size());assertFalse(out.has("hostname"));assertEquals("ll",out.path("encoder").asText());
    }

    @Test void readyCannotGrantMoreAuthorityThanTheIntent() {
        refused(502,"AGENT_PROTOCOL",()->policy("view",false).fromAgent(AgentFixture.ready(true,false)));
        refused(502,"AGENT_PROTOCOL",()->policy2c().fromAgent(AgentFixture.ready(true,true)));   // clipboard without recorded consent
    }
    private AgentPolicy policy2c() {sessions.endDesktop(app,"TEST");return policy("control",false);}

    @Test void agentMessagesAreChecked() {
        var p=policy("control",false);
        for(String bad:new String[]{"nope","{\"t\":\"hello\"}","{\"t\":\"ready\",\"v\":2,\"width\":1,\"height\":1,\"control\":false,\"controlReason\":\"VIEW_ONLY\",\"clipboard\":false,\"encoder\":\"hw\"}",
            "{\"t\":\"ready\",\"v\":1,\"width\":0,\"height\":1,\"control\":false,\"controlReason\":\"VIEW_ONLY\",\"clipboard\":false,\"encoder\":\"hw\"}",
            "{\"t\":\"ready\",\"v\":1,\"width\":1,\"height\":1,\"control\":false,\"controlReason\":\"WHY\",\"clipboard\":false,\"encoder\":\"hw\"}",
            "{\"t\":\"config\",\"codec\":\"avc1.xx\",\"avcc\":\"AAAA\",\"width\":1,\"height\":1}","{\"t\":\"config\",\"codec\":\"avc1.4D0028\",\"avcc\":\"not base64!\",\"width\":1,\"height\":1}",
            "{\"t\":\"status\",\"secureInput\":false,\"sent\":-1,\"dropped\":0,\"bytes\":0}","{\"t\":\"status\",\"secureInput\":\"no\",\"sent\":1,\"dropped\":0,\"bytes\":0}"})
            refused(502,"AGENT_PROTOCOL",()->p.fromAgent(bad));
        refused(502,"AGENT_PROTOCOL",()->p.fromAgent("{\"t\":\"status\",\"secureInput\":false,\"sent\":1,\"dropped\":0,\"bytes\":"+"9".repeat(AgentPolicy.MAX_TEXT)+"}"));
        assertEquals("{\"t\":\"clip-result\",\"ok\":true}",p.fromAgent("{\"t\":\"clip-result\",\"ok\":true,\"x\":1}"));
    }

    @Test void macClipboardNeverReachesTheBrowserWithoutConsentAndControl() {
        assertNull(policy("control",false).fromAgent("{\"t\":\"clip\",\"text\":\"from the mac\"}"));
        sessions.endDesktop(app,"TEST");
        assertNull(policy("view",false).fromAgent("{\"t\":\"clip\",\"text\":\"from the mac\"}"));
        sessions.endDesktop(app,"TEST");
        assertEquals("{\"t\":\"clip\",\"text\":\"from the mac\"}",policy("control",true).fromAgent("{\"t\":\"clip\",\"text\":\"from the mac\"}"));
    }

    @Test void agentErrorCodesAreFixed() {
        var p=policy("control",false);
        assertEquals("{\"t\":\"error\",\"code\":\"NO_DISPLAY\"}",p.fromAgent("{\"t\":\"error\",\"code\":\"NO_DISPLAY\",\"detail\":\"/Users/x/secret\"}"));
        assertEquals("{\"t\":\"error\",\"code\":\"AGENT_PROTOCOL\"}",p.fromAgent("{\"t\":\"error\",\"code\":\"free text from the agent\"}"));
    }

    @Test void videoFramesAreHeaderAndSizeChecked() {
        AgentPolicy.checkVideo(ByteBuffer.wrap(AgentFixture.frame(true,1,1)));
        for(byte[] bad:new byte[][]{new byte[0],new byte[14],AgentFixture.frame(true,1,0),new byte[]{2,1,0,0,0,0,0,0,0,0,0,0,0,0,9},new byte[]{1,2,0,0,0,0,0,0,0,0,0,0,0,0,9}})
            refused(502,"AGENT_PROTOCOL",()->AgentPolicy.checkVideo(ByteBuffer.wrap(bad)));
        refused(502,"AGENT_PROTOCOL",()->AgentPolicy.checkVideo(ByteBuffer.wrap(AgentFixture.frame(false,1,AgentPolicy.MAX_VIDEO+1))));
        AgentPolicy.checkVideo(ByteBuffer.wrap(AgentFixture.frame(false,1,AgentPolicy.MAX_VIDEO)));
    }

    @Test void initialBitrateFollowsThePictureMode() {
        assertEquals(1500,AgentPolicy.initialKbps(DisplayQuality.LOW));assertEquals(4000,AgentPolicy.initialKbps(DisplayQuality.BALANCED));assertEquals(8000,AgentPolicy.initialKbps(DisplayQuality.CLEAR));
    }

    // ---- backend selection in the session store --------------------------------------------------------------------------

    @Test void agentIntentsRequireTheServerFlagAndAreExclusive() throws Exception {
        var disabled=new Sessions(Fixtures.config(dir.resolve("off"),4822,"https://gateway.fixture.test"),time,time.nano::get,audit);
        var other=disabled.bootstrap(new AccessVerifier.Identity("owner",time.instant().plusSeconds(3600)),null).getValue();
        refused(503,"AGENT_DISABLED",()->disabled.intent(other,"fixture-mac","control","windows-native",DisplayQuality.BALANCED.id,"agent"));
        refused(400,"INVALID_REQUEST",()->sessions.intent(app,"fixture-mac","control","windows-native",DisplayQuality.BALANCED.id,"rdp"));
        var vnc=sessions.intent(app,"fixture-mac","view","windows-native",DisplayQuality.BALANCED.id,"vnc");
        sessions.begin(app,vnc.id,"vnc");
        var second=sessions.bootstrap(new AccessVerifier.Identity("owner",time.instant().plusSeconds(3600)),null).getValue();
        refused(409,"CONTROL_BUSY",()->sessions.intent(second,"fixture-mac","view","windows-native",DisplayQuality.BALANCED.id,"agent"));
        disabled.close();
    }

    @Test void anIntentCannotBeUsedOnTheOtherBackendsRoute() {
        var agent=sessions.intent(app,"fixture-mac","view","windows-native",DisplayQuality.BALANCED.id,"agent");
        refused(400,"INVALID_REQUEST",()->sessions.begin(app,agent.id,"vnc"));
        assertFalse(agent.consumed);
        var desktop=sessions.begin(app,agent.id,"agent");assertEquals("agent",desktop.backend);
        sessions.endDesktop(app,"TEST");
        var vnc=sessions.intent(app,"fixture-mac","view","windows-native",DisplayQuality.BALANCED.id,"vnc");
        refused(400,"INVALID_REQUEST",()->sessions.begin(app,vnc.id,"agent"));assertFalse(vnc.consumed);
    }
}

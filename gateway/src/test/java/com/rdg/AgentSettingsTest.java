package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class AgentSettingsTest {
    @TempDir Path dir;

    static Map<String,String> env(String... pairs) {var m=new HashMap<String,String>();for(int i=0;i<pairs.length;i+=2)m.put(pairs[i],pairs[i+1]);return m;}
    Path tokenFile(String content,String permissions) throws Exception {
        Path file=dir.resolve("token-"+UUID.randomUUID());Files.writeString(file,content);Files.setPosixFilePermissions(file,PosixFilePermissions.fromString(permissions));return file;
    }

    @Test void disabledByDefaultAndExplicitFalse() {
        assertSame(Config.AgentSettings.DISABLED,Config.AgentSettings.load(env()));
        assertSame(Config.AgentSettings.DISABLED,Config.AgentSettings.load(env("RDG_AGENT_ENABLED","false")));
        assertFalse(Config.AgentSettings.DISABLED.enabled());
    }

    @Test void anythingOtherThanTrueOrFalseRefusesStartup() {
        for(String bad:new String[]{"TRUE","1","yes",""})assertThrows(IllegalArgumentException.class,()->Config.AgentSettings.load(env("RDG_AGENT_ENABLED",bad)),bad);
    }

    @Test void enabledAgentIsConfinedToTheLocalBoundaryAndFailsClosed() {
        String ok="/run/secrets/rdg_agent_token";
        assertThrows(IllegalArgumentException.class,()->Config.AgentSettings.load(env("RDG_AGENT_ENABLED","true","RDG_AGENT_HOST","10.0.0.7","RDG_AGENT_TOKEN_FILE",ok)));
        assertThrows(IllegalArgumentException.class,()->Config.AgentSettings.load(env("RDG_AGENT_ENABLED","true","RDG_AGENT_HOST","evil.example.com","RDG_AGENT_TOKEN_FILE",ok)));
        assertThrows(IllegalArgumentException.class,()->Config.AgentSettings.load(env("RDG_AGENT_ENABLED","true","RDG_AGENT_PORT","5961","RDG_AGENT_TOKEN_FILE",ok)));
        for(String path:new String[]{null,"","relative/token","/etc/passwd","/run/secrets/../etc/passwd","/run/secrets/Upper","/run/secrets/a/b"}) {
            var e=env("RDG_AGENT_ENABLED","true");if(path!=null)e.put("RDG_AGENT_TOKEN_FILE",path);
            assertThrows(IllegalArgumentException.class,()->Config.AgentSettings.load(e),String.valueOf(path));
        }
        // A well-formed setting whose secret cannot be read refuses startup rather than running without a token.
        assertThrows(Failure.class,()->Config.AgentSettings.load(env("RDG_AGENT_ENABLED","true","RDG_AGENT_TOKEN_FILE","/run/secrets/rdg_agent_token_absent")));
    }

    @Test void tokenFileMustBeARegularOwnerOnlyBase64UrlSecret() throws Exception {
        String good=Sessions.random();
        var settings=new Config.AgentSettings(true,"127.0.0.1",5960,tokenFile(good+"\n","rw-------"));assertEquals(good,settings.token());
        for(var bad:List.of(tokenFile(good,"rw-r-----"),tokenFile(good,"rw----rw-"),tokenFile(good.substring(1),"rw-------"),tokenFile(good+good,"rw-------"),tokenFile("not base64url!!"+good.substring(15),"rw-------"),tokenFile("","rw-------"))) {
            var failure=assertThrows(Failure.class,()->new Config.AgentSettings(true,"127.0.0.1",5960,bad).token(),bad.toString());
            assertEquals("AGENT_UNAVAILABLE",failure.code);
        }
        Path link=dir.resolve("link");Files.createSymbolicLink(link,tokenFile(good,"rw-------"));
        assertThrows(Failure.class,()->new Config.AgentSettings(true,"127.0.0.1",5960,link).token());
        assertThrows(Failure.class,()->new Config.AgentSettings(true,"127.0.0.1",5960,dir).token());
        assertThrows(Failure.class,()->Config.AgentSettings.DISABLED.token());
    }

    @Test void backendsAreAdvertisedWithoutAnyAgentDetail() throws Exception {
        var on=Fixtures.agentConfig(dir.resolve("on"),4822,"https://gateway.fixture.test",5960,Fixtures.agentTokenFile(dir.resolve("on")));
        var off=Fixtures.config(dir.resolve("off"),4822,"https://gateway.fixture.test");
        assertEquals(List.of("vnc","agent"),on.backends());assertEquals(List.of("vnc"),off.backends());
        assertTrue(on.agentEnabled());assertFalse(off.agentEnabled());
        // The credential/status payloads that already existed keep their exact shape.
        assertEquals(off.desktopStatus().keySet(),on.desktopStatus().keySet());
    }

    @Test void anOwnerBlockedDesktopStaysBlockedForTheAgentBackend() throws Exception {
        var blocked=Fixtures.blockedConfig(dir.resolve("blocked"),"https://gateway.fixture.test");
        var withAgent=new Config(blocked.nodeId(),blocked.origin(),blocked.issuer(),blocked.audience(),blocked.ownerEmail(),blocked.ownerSubject(),blocked.deviceId(),blocked.label(),
            blocked.targetHost(),blocked.targetPort(),blocked.secret(),blocked.guacdHost(),blocked.guacdPort(),blocked.listenAddress(),blocked.listenPort(),blocked.stateDir(),
            blocked.webDir(),blocked.bookmarks(),blocked.keysyms(),blocked.desktopPolicy(),blocked.credentialStore(),new Config.AgentSettings(true,"127.0.0.1",5960,Fixtures.agentTokenFile(dir)));
        var time=new Fixtures.Time();var audit=new Audit(withAgent.stateDir(),time,withAgent.nodeId());var sessions=new Sessions(withAgent,time,time.nano::get,audit);
        try {
            var app=sessions.bootstrap(new AccessVerifier.Identity("owner",time.instant().plusSeconds(3600)),null).getValue();
            var failure=assertThrows(Failure.class,()->sessions.intent(app,"fixture-mac","view","windows-native",DisplayQuality.BALANCED.id,"agent"));
            assertEquals(503,failure.status);assertEquals(Config.DESKTOP_BLOCKED_REASON,failure.code);
        }finally{sessions.close();audit.close();}
    }
}

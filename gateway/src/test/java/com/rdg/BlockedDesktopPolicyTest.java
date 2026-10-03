package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

/** Policy tests with no server, credentials or network connections. */
class BlockedDesktopPolicyTest {
    @TempDir Path directory;
    Config config;
    Audit audit;
    Sessions sessions;
    Sessions.App app;

    @BeforeEach void setup() throws Exception {
        config=Fixtures.blockedConfig(directory,"https://gateway.fixture.test");
        var clock=new Fixtures.Time();audit=new Audit(config.stateDir(),clock,config.nodeId());
        sessions=new Sessions(config,clock,clock.nano::get,audit);
        app=sessions.bootstrap(new AccessVerifier.Identity("fixture-owner",clock.instant().plusSeconds(3600)),null).getValue();
    }
    @AfterEach void close() throws Exception {if(sessions!=null)sessions.close();if(audit!=null)audit.close();}
    void requireBlocked(org.junit.jupiter.api.function.Executable operation) {
        Failure failure=assertThrows(Failure.class,operation);
        assertEquals(503,failure.status);assertEquals(Config.DESKTOP_BLOCKED_REASON,failure.code);
    }
    @Test void blockedIntentAndUpgradeDoNotAllocateDesktopLeases() {
        for(String mode:new String[]{"view","control"})
            requireBlocked(()->sessions.intent(app,config.deviceId(),mode,"mac-native"));
        requireBlocked(()->sessions.begin(app,"A".repeat(43)));
        assertEquals(false,sessions.status(app).get("activeDesktop"));
        assertEquals(0,sessions.status(app).get("nodeActiveDesktops"));
    }
    @Test void connectorRefusesBeforeItUsesDesktopOrMissingCredential() {
        assertNull(config.secret());
        requireBlocked(()->new GuacdConnector(config).open(null));
    }
    @Test void blockedClipboardCannotBeEnabledButCanBeCleared() {
        requireBlocked(()->sessions.clipboard(app,true));
        assertDoesNotThrow(()->sessions.clipboard(app,false));assertFalse(app.clipboard);
    }
}

package com.rdg;

import org.apache.guacamole.net.GuacamoleTunnel;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;

/** Pure local policy tests; no daemon, host probe, or real credential. */
class LocalMacViewTest {
    @TempDir Path directory;
    Config config;
    Audit audit;
    Sessions sessions;
    Sessions.App app;
    SpyConnector connector;

    static final class SpyConnector extends LocalMacViewMain.ViewOnlyConnector {
        boolean upstreamCalled;
        SpyConnector(Config config) { super(config); }
        @Override GuacamoleTunnel connectView(Sessions.Desktop desktop) {
            upstreamCalled = true;
            return null;
        }
    }

    @BeforeEach void setup() throws Exception {
        Path secret = directory.resolve("synthetic-test-secret");
        Files.writeString(secret, "local-pilot-fixture-only");
        Files.setPosixFilePermissions(secret, PosixFilePermissions.fromString("rw-------"));
        config = LocalMacViewMain.config(directory, secret, 4822, 32122);
        audit = new Audit(config.stateDir(), Clock.systemUTC(), config.nodeId());
        sessions = new Sessions(config, Clock.systemUTC(), System::nanoTime, audit);
        app = sessions.bootstrap(new AccessVerifier.Identity("localhost-pilot-owner", Instant.now().plusSeconds(90)), null).getValue();
        connector = new SpyConnector(config);
    }

    @AfterEach void close() throws Exception {
        if (sessions != null) sessions.close();
        if (audit != null) audit.close();
    }

    Sessions.Desktop desktop(String mode) {
        return sessions.begin(app, sessions.intent(app, config.deviceId(), mode, "mac-native").id);
    }


    @Test void automatedPilotRetainsItsSixtySecondDeadline() {
        assertEquals(60, LocalMacViewMain.pilotSeconds(new String[]{"directory", "4822", "32122"}));
    }

    @Test void manualPilotRequiresTheExplicitBoundedDuration() {
        assertEquals(900, LocalMacViewMain.pilotSeconds(new String[]{"directory", "4822", "32122", "900"}));
        for (String duration : new String[]{"0", "-1", "60", "901", "3600", "not-seconds"}) {
            assertThrows(IllegalArgumentException.class, () -> LocalMacViewMain.pilotSeconds(
                new String[]{"directory", "4822", "32122", duration}));
        }
        assertThrows(IllegalArgumentException.class, () -> LocalMacViewMain.pilotSeconds(new String[2]));
        assertThrows(IllegalArgumentException.class, () -> LocalMacViewMain.pilotSeconds(new String[5]));
    }

    @Test void configHasOnlyTheFixedLocalTargetAndNoInventedCalibration() {
        assertEquals("host.docker.internal", config.targetHost());
        assertEquals(5900, config.targetPort());
        assertEquals("127.0.0.1", config.guacdHost());
        assertEquals("127.0.0.1", config.listenAddress());
        assertEquals("https://127.0.0.1:32122", config.origin());
        assertTrue(config.keysyms().isEmpty());
        assertTrue(config.bookmarks().isEmpty());
    }

    @Test void controlIsRejectedBeforeAnyUpstreamOperation() {
        Failure failure = assertThrows(Failure.class, () -> connector.open(desktop("control")));
        assertEquals("LOCAL_PILOT_VIEW_ONLY", failure.code);
        assertFalse(connector.upstreamCalled);
    }

    @Test void clipboardConsentIsRejectedEvenWhenViewIntentSuppressesClipboard() {
        sessions.clipboard(app, true);
        var view = desktop("view");
        assertFalse(view.clipboard);
        Failure failure = assertThrows(Failure.class, () -> connector.open(view));
        assertEquals("LOCAL_PILOT_VIEW_ONLY", failure.code);
        assertFalse(connector.upstreamCalled);
    }

    @Test void onlyAViewWithNoClipboardDelegatesToTheOfficialConnector() throws Exception {
        connector.open(desktop("view"));
        assertTrue(connector.upstreamCalled);
    }

    @Test void signedPilotTokenMatchesThePinnedTestOwnerSubject() throws Exception {
        var key = Fixtures.key("local-view-test");
        var verifier = new AccessVerifier(config, Clock.systemUTC(),
            () -> new com.nimbusds.jose.jwk.JWKSet(key.toPublicJWK()).toString());
        String token = Fixtures.token(config, key, Instant.now(), 90,
            java.util.Map.of("sub", config.ownerSubject()));
        assertEquals(config.ownerSubject(), verifier.verify(token).subject());
        assertThrows(Failure.class, () -> verifier.verify("forged"));
        String wrongSubject = Fixtures.token(config, key, Instant.now(), 90, java.util.Map.of());
        assertThrows(Failure.class, () -> verifier.verify(wrongSubject));
    }

    @Test void viewPolicyRejectsInputWithoutNeedingCalibratedKeysyms() {
        var policy = new InputPolicy(desktop("view"));
        for (String opcode : new String[]{"key", "mouse", "clipboard", "blob", "end"}) {
            Failure failure = assertThrows(Failure.class, () -> policy.validate(
                new org.apache.guacamole.protocol.GuacamoleInstruction(opcode, "0", "1")));
            assertEquals("READ_ONLY", failure.code);
        }
    }
}

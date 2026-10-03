package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Lease/provisioning authority checks without any upstream socket or credential. */
class OwnerSetupSessionsTest {
    @TempDir Path dir;
    Config config;Fixtures.Time time;Audit audit;Sessions sessions;Sessions.App app,other;
    @BeforeEach void setup() throws Exception {
        config=Fixtures.ownerSetupConfig(dir,"https://gateway.fixture.test");time=new Fixtures.Time();
        audit=new Audit(config.stateDir(),time,config.nodeId());sessions=new Sessions(config,time,time.nano::get,audit);
        var identity=new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600));
        app=sessions.bootstrap(identity,null).getValue();other=sessions.bootstrap(identity,null).getValue();
    }
    @AfterEach void close() throws Exception {sessions.close();audit.close();}
    void failure(String code,org.junit.jupiter.api.function.Executable operation) {assertEquals(code,assertThrows(Failure.class,operation).code);}
    Sessions.Intent intent(Sessions.App application){return sessions.intent(application,config.deviceId(),"control","mac-native");}
    @Test void missingCredentialBlocksEveryDesktopPathThenProvisionAllowsIntent() throws Exception {
        assertFalse(config.desktopEnabled());assertTrue(config.credentialSetupEnabled());assertNull(config.secret());
        failure("VNC_CREDENTIAL_REQUIRED",()->intent(app));failure("VNC_CREDENTIAL_REQUIRED",()->sessions.begin(app,"unused"));
        failure("VNC_CREDENTIAL_REQUIRED",()->new GuacdConnector(config).open(null));
        failure("VNC_CREDENTIAL_REQUIRED",()->sessions.clipboard(app,true));
        var result=sessions.desktopCredential(app,"fixture-only-first");
        assertEquals(Set.of("credentialSetupEnabled","credentialConfigured","desktopEnabled","desktopPolicy","keyboardCalibration"),result.keySet());
        assertEquals("UNVERIFIED_TEST_PROFILE",result.get("keyboardCalibration"));assertEquals(true,result.get("desktopEnabled"));
        assertFalse(result.toString().contains("fixture-only-first"));assertNotNull(intent(app));
    }
    @Test void replacementRefusesAnyApplicationsPendingIntentAndActiveOrUncertainLease() throws Exception {
        sessions.desktopCredential(app,"fixture-only-first");var pending=intent(other);
        failure("CONTROL_BUSY",()->sessions.desktopCredential(app,"fixture-only-second"));
        var desktop=sessions.begin(other,pending.id);
        failure("CONTROL_BUSY",()->sessions.desktopCredential(app,"fixture-only-second"));
        assertEquals("fixture-only-first",config.desktopCredential());
        sessions.endDesktop(other,"USER_ENDED");sessions.desktopCredential(app,"fixture-only-second");
        assertEquals("fixture-only-second",config.desktopCredential());
        time.advance(61);desktop=sessions.begin(other,intent(other).id);desktop.pending(()->{throw new java.io.IOException();});desktop.end("USER_ENDED");
        failure("CLEANUP_UNCERTAIN",()->sessions.desktopCredential(app,"fixture-only-third"));
    }
    @Test void expiryAndSubjectRateLimitDoNotAllowStaleAppsOrUnlimitedOtherTabs() throws Exception {
        sessions.desktopCredential(app,"fixture-only-first");intent(other);time.advance(30);
        sessions.desktopCredential(app,"fixture-only-second");
        for(int i=0;i<3;i++)sessions.desktopCredential(other,"fixture-only-next");
        failure("RATE_LIMITED",()->sessions.desktopCredential(app,"fixture-only-overlimit"));
        time.advance(61);assertDoesNotThrow(()->sessions.desktopCredential(app,"fixture-only-after-minute"));
        sessions.revoke(app,"LOGOUT");failure("SESSION_EXPIRED",()->sessions.desktopCredential(app,"fixture-only-stale"));
    }
    @Test void atomicIntentAndReplacementRacePreservesLeaseCredential() throws Exception {
        sessions.desktopCredential(app,"fixture-only-first");var gate=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        try {
            var intent=pool.submit(()->{gate.await();return intent(other);});
            var replace=pool.submit(()->{gate.await();try{sessions.desktopCredential(app,"fixture-only-second");return true;}catch(Failure e){assertEquals("CONTROL_BUSY",e.code);return false;}});
            gate.countDown();assertNotNull(intent.get(3,TimeUnit.SECONDS));boolean replaced=replace.get(3,TimeUnit.SECONDS);
            assertEquals(replaced?"fixture-only-second":"fixture-only-first",config.desktopCredential());
            failure("CONTROL_BUSY",()->sessions.desktopCredential(app,"fixture-only-third"));
        }finally {pool.shutdownNow();}
    }
    @Test void changedKeyFailsBeforeConnectorCanDereferenceDesktopAndDefaultSetupIsDisabled() throws Exception {
        sessions.desktopCredential(app,"fixture-only-first");Path key=config.credentialStore().keyFile();byte[] bytes=Files.readAllBytes(key);bytes[0]^=1;Files.write(key,bytes);Arrays.fill(bytes,(byte)0);
        failure("CREDENTIAL_STORE_UNAVAILABLE",()->new GuacdConnector(config).open(null));
        var blocked=Fixtures.blockedConfig(dir.resolve("blocked"),config.origin());
        try(var blockedAudit=new Audit(blocked.stateDir(),time,blocked.nodeId());var blockedSessions=new Sessions(blocked,time,time.nano::get,blockedAudit)) {
            var a=blockedSessions.bootstrap(new AccessVerifier.Identity("fixture-owner",time.instant().plusSeconds(3600)),null).getValue();
            failure("CREDENTIAL_SETUP_DISABLED",()->blockedSessions.desktopCredential(a,"fixture-only"));
        }
    }
}

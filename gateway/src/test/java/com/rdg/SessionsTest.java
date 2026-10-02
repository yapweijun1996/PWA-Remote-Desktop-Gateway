package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class SessionsTest {
    @TempDir Path dir;Fixtures.Time time;Audit audit;Sessions s;Sessions.App app;String cookie;
    @BeforeEach void setup() throws Exception{
        time=new Fixtures.Time();var c=Fixtures.config(dir,4822,"https://gateway.fixture.test");audit=new Audit(c.stateDir(),time,c.nodeId());s=new Sessions(c,time,time.nano::get,audit);
        var pair=s.bootstrap(identity("owner",3600),null);cookie=pair.getKey();app=pair.getValue();
    }
    @AfterEach void close() throws Exception{s.close();audit.close();}
    AccessVerifier.Identity identity(String subject,int seconds){return new AccessVerifier.Identity(subject,time.instant().plusSeconds(seconds));}
    Sessions.Intent intent(String mode){return s.intent(app,"fixture-mac",mode,"windows-native");}
    @Test void secondTabBootstrapPreservesLiveDesktopAndDeadline(){
        var desktop=s.begin(app,intent("control").id);var deadline=app.expires;time.advance(2);
        var reused=s.bootstrap(identity("owner",3600),cookie);assertSame(app,reused.getValue());assertEquals(cookie,reused.getKey());assertEquals(deadline,reused.getValue().expires);assertFalse(desktop.ended.get());
    }
    @Test void secureBindingAndCsrf(){assertSame(app,s.authorize(cookie,identity("owner",3600)));assertThrows(Failure.class,()->s.authorize(cookie,identity("other",3600)));assertThrows(Failure.class,()->Sessions.csrf(app,"wrong"));Sessions.csrf(app,app.csrf);}
    @Test void atomicIntentRace() throws Exception {
        var i=intent("control");var gate=new CountDownLatch(1);var pool=Executors.newFixedThreadPool(2);
        Callable<Boolean> task=()->{gate.await();try{s.begin(app,i.id);return true;}catch(Failure e){return false;}};
        var a=pool.submit(task);var b=pool.submit(task);gate.countDown();assertNotEquals(a.get(),b.get());pool.shutdownNow();
        assertThrows(Failure.class,()->s.begin(app,i.id));
    }
    @Test void expiredIntentsAndTargetInjection(){var i=intent("view");time.advance(30);assertThrows(Failure.class,()->s.begin(app,i.id));assertThrows(Failure.class,()->s.intent(app,"evil-host","control","windows-native"));}
    @Test void controllerRaceAndIdor(){var a=intent("control");var b=intent("control");s.begin(app,a.id);assertThrows(Failure.class,()->s.begin(app,b.id));var other=s.bootstrap(identity("owner",3600),null).getValue();assertThrows(Failure.class,()->s.begin(other,a.id));}
    @Test void logoutReleasesLeaseAndEndsTransport() {var d=s.begin(app,intent("control").id);s.revoke(app,"LOGOUT");assertTrue(d.ended.get());assertThrows(Failure.class,()->s.authorize(cookie,identity("owner",3600)));var next=s.bootstrap(identity("owner",3600),null).getValue();assertDoesNotThrow(()->s.begin(next,s.intent(next,"fixture-mac","control","mac-native").id));}
    @Test void failedUpstreamCleanupBlocksNewTunnelsAndUpdates() throws Exception {
        var desktop=s.begin(app,intent("control").id);desktop.pending(()->{throw new java.io.IOException();});desktop.end("USER_ENDED");
        assertThrows(Failure.class,()->intent("control"));assertThrows(Failure.class,()->s.updateBoundary(app));
    }
    @Test void maintenanceRejectsPendingAndActiveSessions() {
        var i=intent("control");assertThrows(Failure.class,()->s.updateBoundary(app));s.begin(app,i.id);assertThrows(Failure.class,()->s.updateBoundary(app));
        s.endDesktop(app,"USER_ENDED");assertEquals(true,s.updateBoundary(app).get("safe"));assertThrows(Failure.class,()->intent("control"));time.advance(21);assertDoesNotThrow(()->intent("control"));
    }
    @Test void idleAndAbsoluteTimersIgnoreStatusTraffic() {
        var d=s.begin(app,intent("view").id);time.advance(900);s.status(app);assertThrows(Failure.class,d::checkActive);s.tick();assertTrue(d.ended.get());
        var next=s.begin(app,intent("control").id);time.advance(2700);s.tick();assertTrue(next.ended.get());assertThrows(Failure.class,()->s.authorize(cookie,identity("owner",3600)));
    }
    @Test void connectingDeadlineAndLateResourceCleanup() throws Exception {
        var d=s.begin(app,intent("control").id);time.advance(10);s.tick();assertTrue(d.ended.get());var closed=new java.util.concurrent.atomic.AtomicBoolean();assertThrows(Failure.class,()->d.pending(()->closed.set(true)));assertTrue(closed.get());
    }
    @Test void browserIsOwnedAndClosedDuringUpstreamHandshakeDeadline() throws Exception {
        var desktop=s.begin(app,intent("control").id);var closed=new java.util.concurrent.atomic.AtomicBoolean();
        var browser=(javax.websocket.Session)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{javax.websocket.Session.class},(proxy,method,args)->{
            if(method.getName().equals("isOpen"))return !closed.get();
            if(method.getName().equals("close")){closed.set(true);return null;}
            throw new UnsupportedOperationException();
        });
        desktop.attachBrowser(browser);time.advance(10);s.tick();assertTrue(closed.get());assertTrue(desktop.ended.get());
    }
    @Test void viewOnlyRawInputAndClipboardLimits() {
        var view=s.begin(app,intent("view").id);var policy=new InputPolicy(view);
        for(String op:List.of("key","mouse","clipboard","blob","end","select","connect","file"))assertThrows(Failure.class,()->policy.validate(new org.apache.guacamole.protocol.GuacamoleInstruction(op,"0","1")));
        s.endDesktop(app,"USER_ENDED");s.clipboard(app,true);var control=s.begin(app,intent("control").id);var p=new InputPolicy(control);
        p.validate(new org.apache.guacamole.protocol.GuacamoleInstruction("clipboard","0","text/plain"));
        assertThrows(Failure.class,()->p.validate(new org.apache.guacamole.protocol.GuacamoleInstruction("blob","0",Base64.getEncoder().encodeToString(new byte[16385]))));
    }
    @Test void metadataContainsNoSessionOrPayload() {
        s.begin(app,intent("control").id).end("USER_ENDED");String output=audit.history(app.ref).toString();assertFalse(output.contains(cookie));assertFalse(output.contains(app.csrf));assertFalse(output.contains("fixture-only-password"));assertFalse(output.contains("owner"));
    }
}

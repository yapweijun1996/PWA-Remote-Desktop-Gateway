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
    record AttachedTransport(java.util.concurrent.atomic.AtomicBoolean upstreamClosed,java.util.concurrent.atomic.AtomicBoolean browserClosed) {}
    AttachedTransport attach(Sessions.Desktop desktop) throws Exception {
        var upstreamClosed=new java.util.concurrent.atomic.AtomicBoolean();var browserClosed=new java.util.concurrent.atomic.AtomicBoolean();
        var socket=new org.apache.guacamole.net.GuacamoleSocket() {
            public org.apache.guacamole.io.GuacamoleReader getReader(){throw new UnsupportedOperationException();}
            public org.apache.guacamole.io.GuacamoleWriter getWriter(){throw new UnsupportedOperationException();}
            public boolean isOpen(){return !upstreamClosed.get();}
            public void close(){upstreamClosed.set(true);}
        };
        var browser=(javax.websocket.Session)java.lang.reflect.Proxy.newProxyInstance(getClass().getClassLoader(),new Class<?>[]{javax.websocket.Session.class},(proxy,method,args)->{
            if(method.getName().equals("isOpen"))return !browserClosed.get();
            if(method.getName().equals("close")){browserClosed.set(true);return null;}
            throw new UnsupportedOperationException();
        });
        desktop.attach(new org.apache.guacamole.net.SimpleGuacamoleTunnel(socket),browser);return new AttachedTransport(upstreamClosed,browserClosed);
    }
    static Failure failure(int status,String code,org.junit.jupiter.api.function.Executable action) {
        Failure result=assertThrows(Failure.class,action);assertEquals(status,result.status);assertEquals(code,result.code);return result;
    }
    @Test void scopedLoserCancellationPreservesWinningControllerAndCancelsOnlyPendingIntent() throws Exception {
        var winningIntent=intent("control");var losingIntent=intent("control");var winner=s.begin(app,winningIntent.id);var transport=attach(winner);
        failure(409,"CONTROL_BUSY",()->s.begin(app,losingIntent.id));
        s.endDesktop(app,losingIntent.id,"USER_ENDED");failure(410,"INTENT_EXPIRED",()->s.begin(app,losingIntent.id));
        assertFalse(winner.ended.get());assertTrue(winner.connected());winner.checkActive();
        assertFalse(transport.upstreamClosed().get());assertFalse(transport.browserClosed().get());
        assertEquals(true,s.status(app).get("activeDesktop"));assertEquals(1,s.status(app).get("nodeActiveDesktops"));
    }
    @Test void scopedOwnerCancellationEndsDesktopAfterConsumedIntentHasExpired() throws Exception {
        var owningIntent=intent("control");var desktop=s.begin(app,owningIntent.id);var transport=attach(desktop);
        time.advance(31);s.tick();assertTrue(desktop.connected());desktop.checkActive();
        s.endDesktop(app,owningIntent.id,"USER_ENDED");assertTrue(desktop.ended.get());
        assertTrue(transport.upstreamClosed().get());assertTrue(transport.browserClosed().get());
        assertEquals(false,s.status(app).get("activeDesktop"));assertEquals(0,s.status(app).get("nodeActiveDesktops"));
        s.endDesktop(app,owningIntent.id,"USER_ENDED");assertEquals(0,s.status(app).get("nodeActiveDesktops"));
    }
    @Test void scopedForeignAppCannotCancelPendingOrConnectedDesktopAfterIntentExpiry() throws Exception {
        var ownIntent=intent("control");var foreign=s.bootstrap(identity("owner",3600),null).getValue();
        failure(403,"ACCESS_DENIED",()->s.endDesktop(foreign,ownIntent.id,"USER_ENDED"));
        var desktop=s.begin(app,ownIntent.id);var transport=attach(desktop);time.advance(31);s.tick();
        failure(403,"ACCESS_DENIED",()->s.endDesktop(foreign,ownIntent.id,"USER_ENDED"));
        assertFalse(desktop.ended.get());desktop.checkActive();assertFalse(transport.upstreamClosed().get());assertFalse(transport.browserClosed().get());
        assertEquals(true,s.status(app).get("activeDesktop"));assertEquals(false,s.status(foreign).get("activeDesktop"));assertEquals(1,s.status(app).get("nodeActiveDesktops"));
    }
    @Test void unknownScopedCancellationDoesNotAffectEitherLease() throws Exception {
        var first=s.begin(app,intent("control").id);var firstTransport=attach(first);
        var other=s.bootstrap(identity("owner",3600),null).getValue();var secondIntent=s.intent(other,"fixture-mac","view","windows-native");
        var second=s.begin(other,secondIntent.id);var secondTransport=attach(second);
        s.endDesktop(app,"A".repeat(43),"USER_ENDED");s.endDesktop(app,"A".repeat(43),"USER_ENDED");
        assertEquals(2,s.status(app).get("nodeActiveDesktops"));assertEquals(true,s.status(other).get("activeDesktop"));
        assertFalse(first.ended.get());assertFalse(second.ended.get());assertFalse(firstTransport.upstreamClosed().get());assertFalse(secondTransport.upstreamClosed().get());
        s.endDesktop(app,first.intentId,"USER_ENDED");assertTrue(firstTransport.upstreamClosed().get());
        assertFalse(second.ended.get());assertFalse(secondTransport.upstreamClosed().get());assertFalse(secondTransport.browserClosed().get());
        assertEquals(1,s.status(other).get("nodeActiveDesktops"));second.checkActive();
    }
    @Test void statusDesktopIntentIsOwnerScopedAndLateCancelCannotEndReplacement() throws Exception {
        assertFalse(s.status(app).containsKey("activeDesktopIntentId"));
        var first=s.begin(app,intent("control").id);attach(first);var originalSnapshot=s.status(app);
        assertEquals(first.intentId,originalSnapshot.get("activeDesktopIntentId"));assertEquals(true,originalSnapshot.get("activeDesktop"));
        var other=s.bootstrap(identity("owner",3600),null).getValue();var foreignSnapshot=s.status(other);
        assertEquals(false,foreignSnapshot.get("activeDesktop"));assertEquals(1,foreignSnapshot.get("nodeActiveDesktops"));assertFalse(foreignSnapshot.containsKey("activeDesktopIntentId"));
        s.endDesktop(app,first.intentId,"USER_ENDED");assertFalse(s.status(app).containsKey("activeDesktopIntentId"));
        var otherIntent=s.intent(other,"fixture-mac","control","windows-native");var otherDesktop=s.begin(other,otherIntent.id);attach(otherDesktop);
        var onlyForeign=s.status(app);assertEquals(false,onlyForeign.get("activeDesktop"));assertEquals(1,onlyForeign.get("nodeActiveDesktops"));assertFalse(onlyForeign.containsKey("activeDesktopIntentId"));
        s.endDesktop(other,otherIntent.id,"USER_ENDED");
        var replacement=s.begin(app,intent("control").id);var transport=attach(replacement);
        s.endDesktop(app,first.intentId,"USER_ENDED");
        var currentSnapshot=s.status(app);assertEquals(replacement.intentId,currentSnapshot.get("activeDesktopIntentId"));assertEquals(true,currentSnapshot.get("activeDesktop"));assertEquals(1,currentSnapshot.get("nodeActiveDesktops"));
        assertEquals(first.intentId,originalSnapshot.get("activeDesktopIntentId"));assertFalse(replacement.ended.get());replacement.checkActive();
        assertFalse(transport.upstreamClosed().get());assertFalse(transport.browserClosed().get());
    }
    @Test void secondTabBootstrapPreservesLiveDesktopAndDeadline(){
        var desktop=s.begin(app,intent("control").id);var deadline=app.expires;time.advance(2);
        var reused=s.bootstrap(identity("owner",3600),cookie);assertSame(app,reused.getValue());assertEquals(cookie,reused.getKey());assertEquals(deadline,reused.getValue().expires);assertFalse(desktop.ended.get());
    }
    @Test void qualityIsBoundToIntentAndVisibleOnlyToOwningAppUntilEnd() {
        assertEquals(DisplayQuality.BALANCED,intent("view").displayQuality);
        var low=s.intent(app,"fixture-mac","view","mac-native","low");
        var clear=s.intent(app,"fixture-mac","view","mac-native","clear");
        var desktop=s.begin(app,low.id);assertEquals(DisplayQuality.LOW,desktop.displayQuality);
        assertEquals("low",s.status(app).get("displayQuality"));
        var other=s.bootstrap(identity("owner",3600),null).getValue();assertFalse(s.status(other).containsKey("displayQuality"));
        failure(409,"CONTROL_BUSY",()->s.begin(app,clear.id));assertEquals(DisplayQuality.LOW,desktop.displayQuality);
        s.endDesktop(app,low.id,"USER_ENDED");assertFalse(s.status(app).containsKey("displayQuality"));
        assertEquals(DisplayQuality.CLEAR,s.begin(app,clear.id).displayQuality);
    }
    @Test void arbitraryQualityValuesDoNotReserveAnIntentOrDesktop() {
        for(String quality:Arrays.asList("",null,"LOW","low ","1fps","custom","127.0.0.1","{\"hostname\":\"evil\"}"))
            failure(400,"INVALID_REQUEST",()->s.intent(app,"fixture-mac","view","mac-native",quality));
        assertEquals(0,s.status(app).get("nodeActiveDesktops"));assertEquals(true,s.updateBoundary(app).get("safe"));
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

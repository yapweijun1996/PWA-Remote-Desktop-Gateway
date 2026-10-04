package com.rdg;

import org.apache.guacamole.net.GuacamoleTunnel;
import javax.websocket.*;
import java.time.*;
import java.security.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/** One-process authority. Leases, consume and maintenance reservation share one lock. */
final class Sessions implements AutoCloseable {
    static final long APP_NANOS=Duration.ofHours(1).toNanos(), IDLE_NANOS=Duration.ofMinutes(15).toNanos();
    static final Set<String> PROFILES=Set.of("mac-native","windows-native","windows-alt-command");
    final class App {
        final String index, subject, csrf, ref;
        final Instant expires;
        final long deadline;
        boolean clipboard;String trustedDeviceId;
        App(String token,AccessVerifier.Identity id) {
            index=hash(token);subject=id.subject();csrf=random();ref=hash(config.nodeId()+":"+subject).substring(0,24);
            Instant now=clock.instant();expires=id.expiresAt().isBefore(now.plusSeconds(3600))?id.expiresAt():now.plusSeconds(3600);
            deadline=ticker.getAsLong()+Math.min(APP_NANOS,Duration.between(now,expires).toNanos());
        }
    }
    static final class Intent {
        final String id, appIndex, mode, profile;
        final DisplayQuality displayQuality;
        final long expires;
        final Instant publicExpiry;
        final boolean clipboard;
        boolean consumed;
        Intent(String id,App app,String mode,String profile,DisplayQuality displayQuality,long now,Instant wall) {
            this.id=id;appIndex=app.index;this.mode=mode;this.profile=profile;this.displayQuality=displayQuality;expires=now+Duration.ofSeconds(30).toNanos();
            publicExpiry=wall.plusSeconds(30);clipboard=app.clipboard && mode.equals("control");
        }
    }
    final class Desktop {
        final String intentId;
        final App app;
        final String mode;
        final DisplayQuality displayQuality;
        final boolean clipboard;
        final long connectingDeadline;
        final AtomicBoolean ended=new AtomicBoolean();
        volatile long lastInput;
        private GuacamoleTunnel tunnel;
        private Session socket;
        private AutoCloseable pending;
        Desktop(Intent i,App app) { intentId=i.id;this.app=app;mode=i.mode;displayQuality=i.displayQuality;clipboard=i.clipboard;lastInput=ticker.getAsLong();connectingDeadline=lastInput+Duration.ofSeconds(10).toNanos(); }
        synchronized void pending(AutoCloseable resource) throws Exception {
            if(ended.get()) {resource.close();throw new Failure(401,"SESSION_EXPIRED");}pending=resource;
        }
        synchronized void attachBrowser(Session ws) throws Exception {
            if(ended.get()){ws.close();throw new Failure(401,"SESSION_EXPIRED");}
            socket=ws;
        }
        synchronized void attach(GuacamoleTunnel t,Session ws) throws Exception {
            if(ended.get()){t.close();ws.close();throw new Failure(401,"SESSION_EXPIRED");}
            tunnel=t;socket=ws;pending=null;
        }
        void checkActive() {
            requireTrusted(app);
            long now=ticker.getAsLong();
            if(ended.get() || now>=app.deadline || !clock.instant().isBefore(app.expires) || now-lastInput>=IDLE_NANOS)
                throw new Failure(401,"SESSION_EXPIRED");
        }
        void activity() { if(mode.equals("control")&&!ended.get())lastInput=ticker.getAsLong(); }
        void end(String reason) {
            if(!ended.compareAndSet(false,true))return;
            boolean upstreamClosed=true;
            synchronized(this) {
                try {if(pending!=null)pending.close();}catch(Exception ignored){upstreamClosed=false;}
                try {if(tunnel!=null)tunnel.close();}catch(Exception ignored){upstreamClosed=false;}
                try {if(socket!=null && socket.isOpen())socket.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE,reason));}catch(Exception ignored){}
            }
            synchronized(Sessions.this){if(upstreamClosed)desktops.remove(intentId,this);else cleanupUncertain=true;}
            try{audit.record(app.ref,"END",reason);}catch(Failure ignored){}
        }
        synchronized boolean connected() {return tunnel!=null && !ended.get();}
    }
    final Config config;
    final Clock clock;
    final LongSupplier ticker;
    final Audit audit;
    private TrustedDeviceStore trustedStore;
    private final Map<String,App> apps=new HashMap<>();
    private final Map<String,Intent> intents=new HashMap<>();
    private final Map<String,Desktop> desktops=new HashMap<>();
    private long maintenanceUntil;
    private boolean cleanupUncertain;
    private final Map<String,ArrayDeque<Long>> limits=new HashMap<>();
    Sessions(Config c,Clock clock,LongSupplier ticker,Audit audit) {config=c;this.clock=clock;this.ticker=ticker;this.audit=audit;}
    void useTrustedStore(TrustedDeviceStore trusted){trustedStore=trusted;}
    synchronized void bindTrusted(App app,String deviceId) {
        if(trustedStore==null)return;
        var current=trustedStore.verifyDevice(deviceId);
        if(!app.subject.equals(current.identity().subject())||(app.trustedDeviceId!=null&&!app.trustedDeviceId.equals(deviceId)))throw new Failure(403,"ACCESS_DENIED");
        app.trustedDeviceId=deviceId;
    }
    synchronized void checkTrustedBinding(App app,String deviceId) {
        if(trustedStore!=null && !Objects.equals(app.trustedDeviceId,deviceId))throw new Failure(403,"ACCESS_DENIED");
    }
    private void requireTrusted(App app) {
        if(trustedStore==null)return;
        var current=trustedStore.verifyDevice(app.trustedDeviceId);
        if(!current.identity().subject().equals(app.subject))throw new Failure(403,"ACCESS_DENIED");
    }
    private boolean trustedActive(App app) {try{requireTrusted(app);return true;}catch(Failure failure){return false;}}
    synchronized void revokeCookie(String cookie,String subject,String reason) {
        App app=cookie==null?null:apps.get(hash(cookie));
        if(app!=null && app.subject.equals(subject))revoke(app,reason);
    }
    synchronized void revokeDevice(String deviceId,String reason) {
        for(App app:new ArrayList<>(apps.values()))if(Objects.equals(app.trustedDeviceId,deviceId))revoke(app,reason);
    }
    synchronized Map.Entry<String,App> bootstrap(AccessVerifier.Identity id,String prior) {
        limit(id.subject()+":bootstrap",10);
        if(prior!=null) {
            App old=apps.get(hash(prior));
            if(old!=null) {
                if(!old.subject.equals(id.subject()))throw new Failure(403,"ACCESS_DENIED");
                // Same-origin tabs share this host cookie. Reuse without extending its deadline;
                // rotating here would revoke a desktop merely because a second tab opened.
                if(ticker.getAsLong()<old.deadline && clock.instant().isBefore(old.expires) && !id.expiresAt().isBefore(old.expires))
                    return Map.entry(prior,old);
                revoke(old,"REAUTH_REQUIRED");
            }
        }
        if(apps.size()>=32)throw new Failure(429,"RATE_LIMITED");
        String token=random();App app=new App(token,id);audit.record(app.ref,"BOOTSTRAP","AUTHORIZED");apps.put(app.index,app);
        return Map.entry(token,app);
    }
    synchronized App authorize(String cookie,AccessVerifier.Identity identity) {
        App app=cookie==null?null:apps.get(hash(cookie));
        if(app==null)throw new Failure(401,"AUTH_REQUIRED");
        if(!app.subject.equals(identity.subject()))throw new Failure(403,"ACCESS_DENIED");
        if(ticker.getAsLong()>=app.deadline || !clock.instant().isBefore(app.expires)) {revoke(app,"SESSION_EXPIRED");throw new Failure(401,"SESSION_EXPIRED");}
        // A shorter reissued edge assertion can reduce, never extend, an existing session.
        if(identity.expiresAt().isBefore(app.expires)) {revoke(app,"REAUTH_REQUIRED");throw new Failure(401,"SESSION_EXPIRED");}
        return app;
    }
    static void csrf(App app,String token) {if(token==null||!MessageDigest.isEqual(app.csrf.getBytes(StandardCharsets.UTF_8),token.getBytes(StandardCharsets.UTF_8)))throw new Failure(403,"CSRF_INVALID");}
    synchronized Intent intent(App app,String device,String mode,String profile) {
        return intent(app,device,mode,profile,DisplayQuality.BALANCED.id);
    }
    synchronized Intent intent(App app,String device,String mode,String profile,String qualityId) {
        requireApp(app);config.requireDesktop();limit(app.subject+":intent",20);
        DisplayQuality quality=DisplayQuality.parse(qualityId);
        if(cleanupUncertain)throw new Failure(503,"CLEANUP_UNCERTAIN");
        if(ticker.getAsLong()<maintenanceUntil)throw new Failure(409,"UPDATE_IN_PROGRESS");
        if(!config.deviceId().equals(device))throw new Failure(404,"DEVICE_UNKNOWN");
        if(!Set.of("control","view").contains(mode)||!PROFILES.contains(profile))throw new Failure(400,"INVALID_REQUEST");
        if(intents.size()>=64)throw new Failure(429,"RATE_LIMITED");
        if(desktops.values().stream().anyMatch(d->d.app==app))throw new Failure(409,"CONTROL_BUSY");
        if(mode.equals("control") && desktops.values().stream().anyMatch(d->d.mode.equals("control")))throw new Failure(409,"CONTROL_BUSY");
        Intent i=new Intent(random(),app,mode,profile,quality,ticker.getAsLong(),clock.instant());intents.put(i.id,i);return i;
    }
    synchronized Desktop begin(App app,String id) {
        requireApp(app);config.requireDesktop();
        if(cleanupUncertain)throw new Failure(503,"CLEANUP_UNCERTAIN");
        if(ticker.getAsLong()<maintenanceUntil)throw new Failure(409,"UPDATE_IN_PROGRESS");
        Intent i=intents.get(id);
        if(i==null)throw new Failure(410,"INTENT_EXPIRED");
        if(!i.appIndex.equals(app.index))throw new Failure(403,"ACCESS_DENIED");
        if(i.consumed)throw new Failure(409,"INTENT_USED");
        if(ticker.getAsLong()>=i.expires)throw new Failure(410,"INTENT_EXPIRED");
        if(desktops.size()>=2 || desktops.values().stream().anyMatch(d->d.app==app || (i.mode.equals("control")&&d.mode.equals("control"))))throw new Failure(409,"CONTROL_BUSY");
        i.consumed=true;Desktop desktop=new Desktop(i,app);desktops.put(id,desktop);return desktop;
    }
    synchronized Desktop upgrade(String id) {
        Desktop d=desktops.get(id);
        if(d==null || d.ended.get() || d.connected())throw new Failure(401,"AUTH_REQUIRED");
        requireApp(d.app);return d;
    }
    synchronized void clipboard(App app,boolean consent) {
        requireApp(app);
        if(consent)config.requireDesktop();
        if(desktops.values().stream().anyMatch(d->d.app==app)||intents.values().stream().anyMatch(i->i.appIndex.equals(app.index)&&!i.consumed))throw new Failure(409,"CONTROL_BUSY");
        app.clipboard=consent;
    }
    synchronized Map<String,Object> desktopCredential(App app,String password) {
        requireApp(app);
        if(!config.credentialSetupEnabled())throw new Failure(403,"CREDENTIAL_SETUP_DISABLED");
        limit(app.subject+":credential",5);
        if(cleanupUncertain)throw new Failure(503,"CLEANUP_UNCERTAIN");
        long now=ticker.getAsLong();
        // The node-wide lease lock also covers provisioning, including other tabs and owners' apps.
        if(!desktops.isEmpty() || intents.values().stream().anyMatch(i->!i.consumed && now<i.expires))
            throw new Failure(409,"CONTROL_BUSY");
        config.credentialStore().save(password);return config.desktopStatus();
    }
    synchronized void endDesktop(App app,String intentId,String reason) {
        requireApp(app);
        Intent intent=intents.get(intentId);Desktop desktop=desktops.get(intentId);
        // A connected desktop can outlive its consumed, 30-second intent record.
        if((intent!=null&&!intent.appIndex.equals(app.index)) || (desktop!=null&&desktop.app!=app))
            throw new Failure(403,"ACCESS_DENIED");
        intents.remove(intentId);
        if(desktop!=null)desktop.end(reason);
    }
    synchronized void endDesktop(App app,String reason) {
        intents.values().removeIf(i->i.appIndex.equals(app.index));
        for(Desktop d:new ArrayList<>(desktops.values()))if(d.app==app)d.end(reason);
    }
    synchronized void revoke(App app,String reason) {apps.remove(app.index);endDesktop(app,reason);}
    synchronized Map<String,Object> status(App app) {
        requireApp(app);
        Desktop desktop=desktops.values().stream().filter(d->d.app==app).findFirst().orElse(null);
        var status=new LinkedHashMap<String,Object>(Map.of("expiresAt",app.expires.toString(),"activeDesktop",desktop!=null,
            "nodeActiveDesktops",desktops.size(),"clipboardConsent",app.clipboard,"maintenance",ticker.getAsLong()<maintenanceUntil));
        if(desktop!=null){status.put("activeDesktopIntentId",desktop.intentId);status.put("displayQuality",desktop.displayQuality.id);}
        return status;
    }
    synchronized Map<String,Object> updateBoundary(App app) {
        requireApp(app);
        if(cleanupUncertain)throw new Failure(503,"CLEANUP_UNCERTAIN");
        if(!desktops.isEmpty()||intents.values().stream().anyMatch(i->!i.consumed && ticker.getAsLong()<i.expires))throw new Failure(409,"UPDATE_DEFERRED");
        maintenanceUntil=ticker.getAsLong()+Duration.ofSeconds(20).toNanos();audit.record(app.ref,"UPDATE","BOUNDARY_RESERVED");
        return Map.of("safe",true,"reservedUntil",clock.instant().plusSeconds(20).toString());
    }
    void tick() {
        List<Desktop> expired;
        synchronized(this) {
            long now=ticker.getAsLong();
            expired=desktops.values().stream().filter(d->now>=d.app.deadline || !clock.instant().isBefore(d.app.expires)
                || !trustedActive(d.app) || now-d.lastInput>=IDLE_NANOS || (!d.connected()&&now>=d.connectingDeadline)).toList();
            apps.values().removeIf(a->now>=a.deadline||!clock.instant().isBefore(a.expires));
            intents.values().removeIf(i->now>=i.expires);
            limits.entrySet().removeIf(e->e.getValue().isEmpty()||now-e.getValue().getLast()>Duration.ofMinutes(1).toNanos());
        }
        for(Desktop d:expired)d.end("DEADLINE_REACHED");
    }
    private void requireApp(App app) {if(apps.get(app.index)!=app || ticker.getAsLong()>=app.deadline || !clock.instant().isBefore(app.expires))throw new Failure(401,"SESSION_EXPIRED");requireTrusted(app);}
    private void limit(String key,int max) {
        long now=ticker.getAsLong();var q=limits.computeIfAbsent(key,k->new ArrayDeque<>());
        while(!q.isEmpty() && now-q.peekFirst()>=Duration.ofMinutes(1).toNanos())q.removeFirst();
        if(q.size()>=max)throw new Failure(429,"RATE_LIMITED");q.addLast(now);
    }
    static String random() {byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
    static String hash(String text) {try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException();}}
    public synchronized void close() {for(Desktop d:new ArrayList<>(desktops.values()))d.end("SERVER_STOPPED");apps.clear();intents.clear();}
}

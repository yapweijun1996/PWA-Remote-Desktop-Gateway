package com.rdg;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Disposable local identities and protocol peers. These are never production authentication. */
final class Fixtures {
    static class Time extends Clock {
        Instant now=Instant.parse("2026-10-02T00:00:00Z");final AtomicLong nano=new AtomicLong(1_000_000);
        public ZoneId getZone(){return ZoneOffset.UTC;}
        public Clock withZone(ZoneId zone){return this;}
        public Instant instant(){return now;}
        void advance(long seconds){now=now.plusSeconds(seconds);nano.addAndGet(seconds*1_000_000_000L);}
    }
    static Config config(Path dir,int guacdPort,String origin) throws Exception {
        return config(dir,guacdPort,origin,Files.isDirectory(Path.of("web/dist"))?Path.of("web/dist"):Path.of("../web/dist"));
    }
    static Config config(Path dir,int guacdPort,String origin,Path web) throws Exception {
        Files.createDirectories(dir);Path secret=dir.resolve("fixture-secret");Files.writeString(secret,"fixture-only-password");Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-------"));
        return new Config("fixture-node",origin,"https://fixture-team.cloudflareaccess.com","a".repeat(64),"owner@fixture.test","",
            "fixture-mac","Disposable protocol fixture","127.0.0.1",5900,secret,"127.0.0.1",guacdPort,"127.0.0.1",0,dir.resolve("state"),web,
            Config.JSON.createArrayNode(),Map.of("CommandLeft",0xffe7,"CommandRight",0xffe8,"OptionLeft",0xffe9,"OptionRight",0xffea,"ControlLeft",0xffe3,"ControlRight",0xffe4));
    }
    /** A token file the way the owner provisions it: 32 random bytes, base64url, owner-only. */
    static Path agentTokenFile(Path dir) throws Exception {
        Files.createDirectories(dir);Path file=dir.resolve("agent-token");
        Files.writeString(file,Sessions.random()+"\n");Files.setPosixFilePermissions(file,PosixFilePermissions.fromString("rw-------"));return file;
    }
    /** Same as {@link #config} with the host agent backend enabled against a disposable local peer (the port is not the production port). */
    static Config agentConfig(Path dir,int guacdPort,String origin,int agentPort,Path tokenFile) throws Exception {
        var base=config(dir,guacdPort,origin);
        return new Config(base.nodeId(),base.origin(),base.issuer(),base.audience(),base.ownerEmail(),base.ownerSubject(),base.deviceId(),base.label(),
            base.targetHost(),base.targetPort(),base.secret(),base.guacdHost(),base.guacdPort(),base.listenAddress(),base.listenPort(),base.stateDir(),
            base.webDir(),base.bookmarks(),base.keysyms(),base.desktopPolicy(),base.credentialStore(),new Config.AgentSettings(true,"127.0.0.1",agentPort,tokenFile));
    }
    static Config blockedConfig(Path dir,String origin) {
        Path web=Files.isDirectory(Path.of("web/dist"))?Path.of("web/dist"):Path.of("../web/dist");
        return new Config("fixture-node",origin,"https://fixture-team.cloudflareaccess.com","a".repeat(64),"owner@fixture.test","",
            "fixture-mac","Disposable blocked policy fixture","host.docker.internal",5900,null,"127.0.0.1",4822,"127.0.0.1",0,
            dir.resolve("state"),web,Config.JSON.createArrayNode(),Map.of(),Config.DesktopPolicy.BLOCKED);
    }
    static Config ownerSetupConfig(Path dir,String origin) throws Exception {
        dir=dir.toRealPath();Path state=dir.resolve("state"),key=dir.resolve("key/vnc.key");
        DesktopCredentialStore.initializeKey(key,state);
        var store=new DesktopCredentialStore(state,key,"fixture-node","fixture-mac");
        Path web=Files.isDirectory(Path.of("web/dist"))?Path.of("web/dist"):Path.of("../web/dist");
        return new Config("fixture-node",origin,"https://fixture-team.cloudflareaccess.com","a".repeat(64),"owner@fixture.test","",
            "fixture-mac","Disposable owner setup fixture","127.0.0.1",5900,null,"127.0.0.1",4822,"127.0.0.1",0,
            state,web,Config.JSON.createArrayNode(),Map.of("CommandLeft",0xffe7,"CommandRight",0xffe8,"OptionLeft",0xffe9,
            "OptionRight",0xffea,"ControlLeft",0xffe3,"ControlRight",0xffe4),Config.DesktopPolicy.OWNER_SETUP,store);
    }
    static RSAKey key(String kid) throws Exception{return new RSAKeyGenerator(2048).keyID(kid).generate();}
    static String token(Config c,RSAKey key,Instant now,long seconds,Map<String,Object> changes) throws Exception {
        var builder=new JWTClaimsSet.Builder().issuer(c.issuer()).audience(c.audience()).subject("fixture-owner")
            .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(seconds))).claim("type","app").claim("email",c.ownerEmail());
        for(var e:changes.entrySet())builder.claim(e.getKey(),e.getValue());
        SignedJWT jwt=new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(key.getKeyID()).build(),builder.build());
        jwt.sign(new RSASSASigner(key));return jwt.serialize();
    }
}

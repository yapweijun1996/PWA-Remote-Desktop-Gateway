package com.rdg;

import com.nimbusds.jose.jwk.JWKSet;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Test-classpath-only signed enrollment fixture; no desktop target is ever opened. */
public final class LoginBrowserFixtureMain {
    public static void main(String[] args) {
        java.util.logging.LogManager.getLogManager().reset();
        try {
            Path dir=Path.of(args[0]).toRealPath();
            Config config=Fixtures.ownerSetupConfig(dir,args[1]);
            var clock=Clock.systemUTC();var key=Fixtures.key("ephemeral-login-browser-fixture");
            var verifier=new AccessVerifier(config,clock,()->new JWKSet(key.toPublicJWK()).toString());
            String assertion=Fixtures.token(config,key,clock.instant(),300,Map.of());
            verifier.verify(assertion);
            var trusted=new TrustedDeviceStore(config.stateDir().resolve("trusted-devices"),config.credentialStore().keyFile(),config.nodeId(),config.ownerEmail(),config.ownerSubject(),clock);
            var connector=new GuacdConnector(config) {
                @Override org.apache.guacamole.net.GuacamoleTunnel open(Sessions.Desktop desktop) {
                    throw new Failure(503,"LOGIN_FIXTURE_DESKTOP_REFUSED");
                }
            };
            var runtime=new Main.Runtime(config,verifier,connector,clock,System::nanoTime,trusted);
            AtomicBoolean closed=new AtomicBoolean();
            Runnable close=()->{if(closed.compareAndSet(false,true))try{runtime.close();}catch(Exception ignored){}};
            java.lang.Runtime.getRuntime().addShutdownHook(new Thread(close,"login-fixture-cleanup"));
            Thread deadline=new Thread(()->{try{Thread.sleep(60000);close.run();}catch(InterruptedException ignored){}},"login-fixture-deadline");
            deadline.setDaemon(true);deadline.start();
            Path pending=dir.resolve("proxy.json.pending");
            Files.createFile(pending,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            Files.writeString(pending,Config.JSON.writeValueAsString(Map.of("port",runtime.port(),"assertion",assertion)));
            Files.move(pending,dir.resolve("proxy.json"),StandardCopyOption.ATOMIC_MOVE);
            runtime.tomcat.getServer().await();close.run();
        }catch(Exception ignored){System.err.println("LOGIN_BROWSER_FIXTURE_STARTUP_REFUSED");System.exit(2);}
    }
}

package com.rdg;

import com.nimbusds.jose.jwk.JWKSet;
import org.apache.guacamole.net.GuacamoleTunnel;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

/** Owner-run, test-classpath-only local VNC view pilot. Never production authentication. */
public final class LocalMacViewMain {
    static Config config(Path directory, Path secret, int guacdPort, int edgePort) throws Exception {
        if (!directory.isAbsolute() || !secret.isAbsolute() || guacdPort < 1 || guacdPort > 65535
                || edgePort < 1 || edgePort > 65535)
            throw new IllegalArgumentException("Invalid local pilot configuration");
        Config.secretValue(secret);
        return new Config("localhost-view-pilot", "https://127.0.0.1:" + edgePort,
            "https://localhost-pilot.cloudflareaccess.com", "b".repeat(64),
            "owner@localhost-pilot.test", "localhost-pilot-owner",
            "localhost-mac", "Localhost VIEW ONLY pilot - input disabled, keys uncalibrated",
            "host.docker.internal", 5900, secret, "127.0.0.1", guacdPort, "127.0.0.1", 0,
            directory.resolve("state"), Path.of("web/dist").toAbsolutePath(),
            Config.JSON.createArrayNode(), Map.of());
    }

    /** Reject forbidden modes before the maintained connector creates any socket. */
    static class ViewOnlyConnector extends GuacdConnector {
        ViewOnlyConnector(Config config) { super(config); }
        @Override GuacamoleTunnel open(Sessions.Desktop desktop) throws Exception {
            if (!desktop.mode.equals("view") || desktop.clipboard || desktop.app.clipboard)
                throw new Failure(403, "LOCAL_PILOT_VIEW_ONLY");
            return connectView(desktop);
        }
        GuacamoleTunnel connectView(Sessions.Desktop desktop) throws Exception {
            return super.open(desktop);
        }
    }

    static int pilotSeconds(String[] args) {
        if (args.length == 3) return 60;
        if (args.length == 4 && args[3].equals("900")) return 900;
        throw new IllegalArgumentException("Only the bounded manual pilot duration is allowed");
    }

    public static void main(String[] args) {
        java.util.logging.LogManager.getLogManager().reset();
        try {
            int pilotSeconds = pilotSeconds(args);
            String secretPath = System.getenv("RDG_LOCAL_VNC_SECRET_FILE");
            if (secretPath == null || secretPath.isBlank())
                throw new IllegalArgumentException("Owner-provisioned credential file required");
            Path directory = Path.of(args[0]).toAbsolutePath();
            Files.createDirectories(directory);
            Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
            Config config = config(directory, Path.of(secretPath), Integer.parseInt(args[1]), Integer.parseInt(args[2]));
            var key = Fixtures.key("ephemeral-localhost-view-pilot");
            var verifier = new AccessVerifier(config, Clock.systemUTC(),
                () -> new JWKSet(key.toPublicJWK()).toString());
            var runtime = new Main.Runtime(config, verifier, new ViewOnlyConnector(config));
            var timeout = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread thread = new Thread(r, "rdg-local-view-deadline");
                thread.setDaemon(true);
                return thread;
            });
            java.lang.Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                timeout.shutdownNow();
                try { runtime.close(); } catch (Exception ignored) {}
            }));
            timeout.schedule(() -> System.exit(124), pilotSeconds, TimeUnit.SECONDS);
            String assertion = Fixtures.token(config, key, Instant.now(), pilotSeconds + 30,
                Map.of("sub", config.ownerSubject()));
            Path proxy = directory.resolve("proxy.json");
            Path pending = directory.resolve("proxy.json.pending");
            var permissions = PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"));
            try (var channel = Files.newByteChannel(pending,
                    Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE), permissions)) {
                var bytes = java.nio.charset.StandardCharsets.UTF_8.encode(Config.JSON.writeValueAsString(
                    Map.of("port", runtime.port(), "assertion", assertion)));
                while (bytes.hasRemaining()) channel.write(bytes);
            }
            // Publish only the complete assertion file to the polling HTTPS edge.
            Files.move(pending, proxy, StandardCopyOption.ATOMIC_MOVE);
            System.out.println("LOCAL_VIEW_ONLY_READY: signed test identity; Cloudflare and key calibration unverified.");
            runtime.tomcat.getServer().await();
        } catch (Exception ignored) {
            System.err.println("LOCAL_MAC_VIEW_STARTUP_REFUSED");
            System.exit(2);
        }
    }
}

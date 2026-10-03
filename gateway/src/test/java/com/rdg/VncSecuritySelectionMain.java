package com.rdg;

import org.apache.guacamole.net.GuacamoleTunnel;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;

/** Synthetic policy cases only; never sends a password challenge, credentials or pixels. */
public final class VncSecuritySelectionMain {
    private record Case(String name, byte[] types, boolean legacy, Integer expectedType) {}
    private record Observation(String clientVersion, Integer selectedType, boolean clientClosed, boolean serverInitSent) {}
    private static final Set<String> DISPLAY_OPS = Set.of(
        "size", "img", "jpeg", "png", "webp", "blob", "copy", "rect",
        "cfill", "cstroke", "lfill", "lstroke", "arc", "start", "clip", "transform", "shade", "move");

    private static void waitForDaemon() throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (true) {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress("127.0.0.1", 4822), 250);
                return;
            } catch (ConnectException ignored) {
                if (System.nanoTime() >= deadline) throw ignored;
                Thread.sleep(100);
            }
        }
    }

    private static Observation negotiate(ServerSocket peer, Case test) throws Exception {
        try (Socket socket = peer.accept()) {
            socket.setSoTimeout(5000);
            var input = socket.getInputStream();
            var output = socket.getOutputStream();
            String serverVersion = test.legacy() ? "RFB 003.003\n" : "RFB 003.889\n";
            output.write(serverVersion.getBytes(StandardCharsets.US_ASCII));
            output.flush();
            byte[] version = input.readNBytes(12);
            String clientVersion = new String(version, StandardCharsets.US_ASCII);
            if (version.length != 12 || !clientVersion.matches("RFB [0-9]{3}\\.[0-9]{3}\\n"))
                throw new IllegalStateException("INVALID_SYNTHETIC_VERSION");
            if (!test.legacy()) {
                output.write(test.types().length);
                output.write(test.types());
                output.flush();
                int selected = input.read();
                // Close without challenge/DH/auth result, even when a forbidden type is selected.
                return new Observation(clientVersion.strip(), selected < 0 ? null : selected, selected < 0, false);
            }

            // RFB3.3 bypasses a client-side type-list allowlist: server chooses None directly.
            output.write(ByteBuffer.allocate(4).putInt(1).array());
            output.flush();
            int sharedFlag = input.read();
            if (sharedFlag < 0) return new Observation(clientVersion.strip(), 1, true, false);
            if (sharedFlag > 1) throw new IllegalStateException("INVALID_SYNTHETIC_CLIENT_INIT");
            // Complete a minimal1x1 true-colour ServerInit with an empty name, never pixels.
            byte[] init = ByteBuffer.allocate(24)
                .putShort((short)1).putShort((short)1)
                .put((byte)32).put((byte)24).put((byte)0).put((byte)1)
                .putShort((short)255).putShort((short)255).putShort((short)255)
                .put((byte)16).put((byte)8).put((byte)0)
                .put(new byte[3]).putInt(0).array();
            output.write(init);
            output.flush();
            // Discard bounded client setup bytes; the post-init policy guard must close.
            int received = 0;
            byte[] discard = new byte[256];
            int count;
            while ((count = input.read(discard)) >= 0) {
                received += count;
                if (received > 4096) throw new IllegalStateException("EXCESSIVE_SYNTHETIC_SETUP");
            }
            return new Observation(clientVersion.strip(), 1, true, true);
        }
    }

    private static Map<String,Object> runCase(Case test) {
        var result = new LinkedHashMap<String,Object>();
        result.put("case", test.name());
        result.put("scope", "SYNTHETIC_SECURITY_SELECTION");
        result.put("status", "FAIL");
        result.put("authAttempted", false);
        result.put("realMac", false);
        result.put("legacyServerSelectedNone", test.legacy());
        result.put("expectedSecurityType", test.expectedType());
        Thread listener = null;
        try (ServerSocket peer = new ServerSocket()) {
            peer.setReuseAddress(true);
            peer.bind(new InetSocketAddress("127.0.0.1", 5900), 1);
            peer.setSoTimeout(5000);
            var observed = new CompletableFuture<Observation>();
            listener = new Thread(() -> {
                try { observed.complete(negotiate(peer, test)); }
                catch (Exception ignored) {
                    observed.completeExceptionally(new IllegalStateException("SYNTHETIC_NEGOTIATION_FAILED"));
                }
            }, "rdg-synthetic-rfb-policy");
            listener.setDaemon(true);
            listener.start();
            Path directory = Files.createTempDirectory("rdg-vnc-security-policy-");
            var config = Fixtures.config(directory, 4822, "https://security-selection.fixture.test", Path.of("/app/web"));
            try (var audit = new Audit(config.stateDir(), Clock.systemUTC(), config.nodeId());
                 var sessions = new Sessions(config, Clock.systemUTC(), System::nanoTime, audit)) {
                var app = sessions.bootstrap(new AccessVerifier.Identity("synthetic-policy-owner",
                    Instant.now().plusSeconds(30)), null).getValue();
                var intent = sessions.intent(app, config.deviceId(), "view", "mac-native");
                var desktop = sessions.begin(app, intent.id);
                GuacamoleTunnel tunnel = null;
                try {
                    tunnel = new GuacdConnector(config).open(desktop);
                    desktop.attach(tunnel, null);
                    boolean upstreamError = false;
                    boolean displayReceived = false;
                    var reader = tunnel.acquireReader();
                    try {
                        org.apache.guacamole.protocol.GuacamoleInstruction instruction;
                        for (int count = 0; count < 128 && (instruction = reader.readInstruction()) != null; count++) {
                            displayReceived |= DISPLAY_OPS.contains(instruction.getOpcode());
                            if (instruction.getOpcode().equals("error")) {
                                upstreamError = true;
                                break;
                            }
                            if (instruction.getOpcode().equals("disconnect")) break;
                        }
                    } finally { tunnel.releaseReader(); }
                    Observation observation = observed.get(6, TimeUnit.SECONDS);
                    result.put("clientRfbVersion", observation.clientVersion());
                    result.put("selectedSecurityType", observation.selectedType());
                    result.put("passwordChallengeSent", false);
                    result.put("serverInitSent", observation.serverInitSent());
                    result.put("clientClosureObserved", observation.clientClosed());
                    result.put("upstreamError", upstreamError);
                    result.put("displayReceived", displayReceived);
                    boolean typeMatches = Objects.equals(test.expectedType(), observation.selectedType());
                    boolean refusalVerified = test.expectedType() != null || observation.clientClosed();
                    boolean legacyClosed = !test.legacy() || (observation.serverInitSent() && observation.clientClosed());
                    if (typeMatches && refusalVerified && legacyClosed && upstreamError && !displayReceived)
                        result.put("status", "PASS");
                    else result.put("reason", "SYNTHETIC_SECURITY_POLICY_MISMATCH");
                } finally {
                    desktop.end("USER_ENDED");
                    if (tunnel != null) tunnel.close();
                }
            }
        } catch (Exception ignored) {
            result.put("reason", "SYNTHETIC_NEGOTIATION_OR_POLICY_FAILURE");
        } finally {
            if (listener != null) {
                try { listener.join(1000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            }
        }
        return result;
    }

    public static void main(String[] args) {
        java.util.logging.LogManager.getLogManager().reset();
        var timeout = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread thread = new Thread(r, "rdg-synthetic-policy-deadline");
            thread.setDaemon(true);
            return thread;
        });
        timeout.schedule(() -> System.exit(124), 50, TimeUnit.SECONDS);
        try {
            waitForDaemon();
            var cases = List.of(
                new Case("MAC_ARD_FIRST_WITH_VNC", new byte[]{30,33,36,31,32,2,35}, false, 2),
                new Case("NONE_FIRST_WITH_VNC", new byte[]{1,2}, false, 2),
                new Case("ARD_ONLY_REFUSED", new byte[]{30}, false, null),
                new Case("NONE_ONLY_REFUSED", new byte[]{1}, false, null),
                new Case("LEGACY_NONE_POST_INIT_REFUSED", new byte[0], true, 1));
            var results = new ArrayList<Map<String,Object>>();
            for (Case test : cases) results.add(runCase(test));
            boolean passed = results.stream().allMatch(result -> "PASS".equals(result.get("status")));
            System.out.println(Config.JSON.writeValueAsString(Map.of(
                "scope", "SYNTHETIC_SECURITY_SELECTION",
                "status", passed ? "PASS" : "FAIL",
                "authAttempted", false,
                "realMac", false,
                "results", results)));
            if (!passed) System.exit(1);
        } catch (Exception ignored) {
            System.err.println("SYNTHETIC_SECURITY_POLICY_STARTUP_FAILED");
            System.exit(1);
        } finally { timeout.shutdownNow(); }
    }
}

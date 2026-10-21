package com.rdg;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

/**
 * One-off operator tool: store the node's VNC password in the encrypted credential store,
 * read from standard input, so the owner only signs in through Cloudflare Access.
 * Compile against the gateway jar and run inside the gateway image as UID 10001 with the
 * same state and key volumes as the gateway. Usage: SeedVncCredential <nodeId> <deviceId>
 */
public final class SeedVncCredential {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: SeedVncCredential <nodeId> <deviceId>");
        String password = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
        new DesktopCredentialStore(Path.of("/var/lib/rdg"), Path.of("/var/lib/rdg-key/vnc.key"), args[0], args[1]).save(password);
        System.out.println("VNC credential stored");
    }
}

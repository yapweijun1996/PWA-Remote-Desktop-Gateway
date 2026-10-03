package com.rdg;

import com.fasterxml.jackson.databind.*;
import java.net.URI;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;

record Config(String nodeId, String origin, String issuer, String audience, String ownerEmail,
              String ownerSubject, String deviceId, String label, String targetHost, int targetPort,
              Path secret, String guacdHost, int guacdPort, String listenAddress, int listenPort,
              Path stateDir, Path webDir, JsonNode bookmarks, Map<String,Integer> keysyms,
              DesktopPolicy desktopPolicy) {
    enum DesktopPolicy { FULL, BLOCKED }
    static final String DESKTOP_BLOCKED_REASON = "DESKTOP_BLOCKED_BY_POLICY";
    Config {
        Objects.requireNonNull(desktopPolicy, "Explicit desktop policy required");
    }
    Config(String nodeId, String origin, String issuer, String audience, String ownerEmail,
           String ownerSubject, String deviceId, String label, String targetHost, int targetPort,
           Path secret, String guacdHost, int guacdPort, String listenAddress, int listenPort,
           Path stateDir, Path webDir, JsonNode bookmarks, Map<String,Integer> keysyms) {
        this(nodeId, origin, issuer, audience, ownerEmail, ownerSubject, deviceId, label,
            targetHost, targetPort, secret, guacdHost, guacdPort, listenAddress, listenPort,
            stateDir, webDir, bookmarks, keysyms, DesktopPolicy.FULL);
    }
    boolean desktopEnabled() { return desktopPolicy == DesktopPolicy.FULL; }
    void requireDesktop() {
        if (!desktopEnabled()) throw new Failure(503, DESKTOP_BLOCKED_REASON);
    }
    static final ObjectMapper JSON = new ObjectMapper()
        .enable(com.fasterxml.jackson.core.JsonParser.Feature.STRICT_DUPLICATE_DETECTION);
    static Config load(Map<String,String> env) throws Exception {
        DesktopPolicy desktopPolicy = DesktopPolicy.valueOf(env.getOrDefault("RDG_DESKTOP_POLICY", "FULL"));
        String origin = required(env, "RDG_PUBLIC_ORIGIN");
        URI uri = URI.create(origin);
        if (!origin.matches("https://[a-z0-9.-]+") || !"https".equals(uri.getScheme()) || uri.getHost() == null || !origin.equals("https://" + uri.getHost())
            || placeholder(uri.getHost())) throw new IllegalArgumentException("Invalid public origin");
        String issuer = required(env, "RDG_ACCESS_ISSUER");
        if (!issuer.matches("https://[a-z0-9-]+\\.cloudflareaccess\\.com") || placeholder(issuer))
            throw new IllegalArgumentException("Invalid trusted issuer");
        String audience = required(env, "RDG_ACCESS_AUDIENCE");
        if (!audience.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid audience");
        String email = required(env, "RDG_OWNER_EMAIL");
        if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+") || placeholder(email)) throw new IllegalArgumentException("Invalid owner email");
        Path configPath = Path.of(required(env, "RDG_TARGET_CONFIG"));
        if (Files.size(configPath) > 32768) throw new IllegalArgumentException("Configuration too large");
        JsonNode root = JSON.readTree(Files.readAllBytes(configPath));
        fields(root, Set.of("nodeId","publicOrigin","localDevice","bookmarks","keysyms"));
        String node = id(root.path("nodeId").asText());
        if(env.containsKey("RDG_NODE_ID")&&!node.equals(env.get("RDG_NODE_ID")))throw new IllegalArgumentException("Node identity mismatch");
        if (!origin.equals(root.path("publicOrigin").asText())) throw new IllegalArgumentException("Origin mismatch");
        JsonNode dev = root.path("localDevice");
        fields(dev, Set.of("id","label","targetOS","upstreamHost","upstreamPort","credentialRef"));
        String device = id(dev.path("id").asText()), label = dev.path("label").asText();
        if (label.isBlank() || label.length() > 80 || !dev.path("targetOS").asText().equals("macOS")) throw new IllegalArgumentException("Invalid target");
        String host = dev.path("upstreamHost").asText();
        if (!Set.of("host.docker.internal","127.0.0.1").contains(host) || !dev.path("upstreamPort").isInt() || dev.path("upstreamPort").intValue()!=5900)
            throw new IllegalArgumentException("Target outside supported local boundary");
        String ref = dev.path("credentialRef").asText();
        if ((dev.has("credentialRef") && !dev.path("credentialRef").isTextual())
                || (!ref.isEmpty() && !ref.matches("/run/secrets/[a-z0-9_-]+"))
                || (desktopPolicy == DesktopPolicy.FULL && ref.isEmpty()))
            throw new IllegalArgumentException("Invalid credential reference");
        String secretPath = env.getOrDefault("RDG_VNC_SECRET_FILE", ref);
        if (env.containsKey("RDG_VNC_SECRET_FILE") && secretPath.isBlank())
            throw new IllegalArgumentException("Invalid credential path");
        Path secret = secretPath.isEmpty() ? null : Path.of(secretPath);
        // A deliberately blocked gateway neither needs nor reads desktop credentials.
        if (desktopPolicy == DesktopPolicy.FULL) secretValue(secret);
        JsonNode bookmarks=root.path("bookmarks");
        if (!bookmarks.isArray() || bookmarks.size()>10) throw new IllegalArgumentException("Invalid bookmarks");
        Set<String> ids=new HashSet<>(Set.of(device));
        for (JsonNode b:bookmarks) {
            fields(b,Set.of("id","label","url","status"));
            if (!ids.add(id(b.path("id").asText())) || b.path("label").asText().isBlank() || b.path("label").asText().length()>80
                || !b.path("url").asText().matches("https://[a-z0-9.-]+/") || placeholder(b.path("url").asText())
                || !b.path("status").asText().equals("UNVERIFIED")) throw new IllegalArgumentException("Invalid bookmark");
        }
        Map<String,Integer> keysyms=new HashMap<>();
        JsonNode ks=root.path("keysyms");
        if (!(desktopPolicy == DesktopPolicy.BLOCKED && (ks.isMissingNode() || (ks.isObject() && ks.isEmpty())))) {
            fields(ks,Set.of("CommandLeft","CommandRight","OptionLeft","OptionRight","ControlLeft","ControlRight"));
            for(String k:List.of("CommandLeft","CommandRight","OptionLeft","OptionRight","ControlLeft","ControlRight")) {
                if (!ks.path(k).isInt() || ks.path(k).intValue()<0xffe0 || ks.path(k).intValue()>0xffff)
                    throw new IllegalArgumentException("Target keysyms require explicit calibration configuration");
                keysyms.put(k,ks.path(k).intValue());
            }
        }
        String address=env.getOrDefault("RDG_LISTEN_ADDRESS","127.0.0.1");
        if (!Set.of("127.0.0.1","0.0.0.0").contains(address)) throw new IllegalArgumentException("Invalid bind address");
        return new Config(node,origin,issuer,audience,email,env.getOrDefault("RDG_OWNER_SUBJECT",""),device,label,host,5900,
            secret,env.getOrDefault("RDG_GUACD_HOST","127.0.0.1"),port(env.getOrDefault("RDG_GUACD_PORT","4822")),
            address,port(env.getOrDefault("RDG_LISTEN_PORT","32120")),Path.of(required(env,"RDG_STATE_DIR")),
            Path.of(env.getOrDefault("RDG_WEB_DIR","web/dist")),bookmarks,Map.copyOf(keysyms),desktopPolicy);
    }
    static void fields(JsonNode node, Set<String> allowed) {
        if (!node.isObject()) throw new Failure(400,"INVALID_REQUEST");
        node.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new Failure(400,"INVALID_REQUEST");});
    }
    static String secretValue(Path path) throws Exception {
        if (Files.isSymbolicLink(path) || !Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS) || Files.size(path)>256)
            throw new IllegalArgumentException("Invalid secret file");
        Set<PosixFilePermission> mode=Files.getPosixFilePermissions(path);
        if (mode.stream().anyMatch(p->p.name().startsWith("GROUP") || p.name().startsWith("OTHERS")))
            throw new IllegalArgumentException("Secret file must be owner-only");
        String value=Files.readString(path);
        if(value.endsWith("\r\n"))value=value.substring(0,value.length()-2);else if(value.endsWith("\n"))value=value.substring(0,value.length()-1);
        if (value.isEmpty() || value.length()>128 || value.contains("\n") || value.contains("\r")) throw new IllegalArgumentException("Invalid secret");
        return value;
    }
    private static int port(String s) { int n=Integer.parseInt(s);if(n<1||n>65535)throw new IllegalArgumentException("Invalid port");return n; }
    private static boolean placeholder(String s) { return s.contains("example.") || s.contains("CHANGEME") || s.contains("YOUR_"); }
    private static String id(String s) { if(!s.matches("[a-z][a-z0-9-]{2,39}"))throw new IllegalArgumentException("Invalid ID");return s; }
    private static String required(Map<String,String> e,String k) { String s=e.get(k);if(s==null||s.isBlank())throw new IllegalArgumentException("Missing "+k);return s; }
}

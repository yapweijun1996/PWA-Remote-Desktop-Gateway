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
              DesktopPolicy desktopPolicy, DesktopCredentialStore credentialStore, AgentSettings agent) {
    enum DesktopPolicy { FULL, BLOCKED, OWNER_SETUP }
    /** Optional host agent backend (docs/19). Disabled unless the owner turns it on; the VNC backend is unaffected. */
    record AgentSettings(boolean enabled, String host, int port, Path tokenFile) {
        static final AgentSettings DISABLED=new AgentSettings(false,"",0,null);
        static final int FIXED_PORT=5960;
        static AgentSettings load(Map<String,String> env) {
            String flag=env.getOrDefault("RDG_AGENT_ENABLED","false");
            if(!Set.of("true","false").contains(flag))throw new IllegalArgumentException("Invalid agent flag");
            if(flag.equals("false"))return DISABLED;
            String host=env.getOrDefault("RDG_AGENT_HOST","host.docker.internal");
            if(!Set.of("host.docker.internal","127.0.0.1").contains(host))throw new IllegalArgumentException("Agent host outside supported local boundary");
            if(!String.valueOf(FIXED_PORT).equals(env.getOrDefault("RDG_AGENT_PORT",String.valueOf(FIXED_PORT))))throw new IllegalArgumentException("Agent port is fixed");
            String file=env.get("RDG_AGENT_TOKEN_FILE");
            if(file==null||!file.matches("/run/secrets/[a-z0-9_-]+"))throw new IllegalArgumentException("Invalid agent token path");
            var settings=new AgentSettings(true,host,FIXED_PORT,Path.of(file));
            settings.token();   // refuse startup when the secret is unusable
            return settings;
        }
        /** The shared secret: a regular, owner-only file holding 32 bytes as 43 base64url characters. Never logged or sent to a browser. */
        String token() {
            try {
                if(!enabled||tokenFile==null||Files.isSymbolicLink(tokenFile)||!Files.isRegularFile(tokenFile,LinkOption.NOFOLLOW_LINKS)||Files.size(tokenFile)>256)throw new IllegalArgumentException();
                if(Files.getPosixFilePermissions(tokenFile,LinkOption.NOFOLLOW_LINKS).stream().anyMatch(p->p.name().startsWith("GROUP")||p.name().startsWith("OTHERS")))throw new IllegalArgumentException();
                String value=Files.readString(tokenFile).strip();
                if(!value.matches("[A-Za-z0-9_-]{43}"))throw new IllegalArgumentException();
                return value;
            }catch(Exception e){throw new Failure(503,"AGENT_UNAVAILABLE");}
        }
    }
    static final String DESKTOP_BLOCKED_REASON = "DESKTOP_BLOCKED_BY_POLICY";
    Config {
        Objects.requireNonNull(desktopPolicy, "Explicit desktop policy required");
        if ((desktopPolicy == DesktopPolicy.OWNER_SETUP) != (credentialStore != null))
            throw new IllegalArgumentException("Invalid credential policy");
        Objects.requireNonNull(agent, "Explicit agent settings required");
    }
    Config(String nodeId, String origin, String issuer, String audience, String ownerEmail,
           String ownerSubject, String deviceId, String label, String targetHost, int targetPort,
           Path secret, String guacdHost, int guacdPort, String listenAddress, int listenPort,
           Path stateDir, Path webDir, JsonNode bookmarks, Map<String,Integer> keysyms,
           DesktopPolicy desktopPolicy, DesktopCredentialStore credentialStore) {
        this(nodeId, origin, issuer, audience, ownerEmail, ownerSubject, deviceId, label,
            targetHost, targetPort, secret, guacdHost, guacdPort, listenAddress, listenPort,
            stateDir, webDir, bookmarks, keysyms, desktopPolicy, credentialStore, AgentSettings.DISABLED);
    }
    Config(String nodeId, String origin, String issuer, String audience, String ownerEmail,
           String ownerSubject, String deviceId, String label, String targetHost, int targetPort,
           Path secret, String guacdHost, int guacdPort, String listenAddress, int listenPort,
           Path stateDir, Path webDir, JsonNode bookmarks, Map<String,Integer> keysyms,
           DesktopPolicy desktopPolicy) {
        this(nodeId, origin, issuer, audience, ownerEmail, ownerSubject, deviceId, label,
            targetHost, targetPort, secret, guacdHost, guacdPort, listenAddress, listenPort,
            stateDir, webDir, bookmarks, keysyms, desktopPolicy, null);
    }
    Config(String nodeId, String origin, String issuer, String audience, String ownerEmail,
           String ownerSubject, String deviceId, String label, String targetHost, int targetPort,
           Path secret, String guacdHost, int guacdPort, String listenAddress, int listenPort,
           Path stateDir, Path webDir, JsonNode bookmarks, Map<String,Integer> keysyms) {
        this(nodeId, origin, issuer, audience, ownerEmail, ownerSubject, deviceId, label,
            targetHost, targetPort, secret, guacdHost, guacdPort, listenAddress, listenPort,
            stateDir, webDir, bookmarks, keysyms, DesktopPolicy.FULL);
    }
    boolean agentEnabled() { return agent.enabled(); }
    List<String> backends() { return agent.enabled() ? List.of("vnc","agent") : List.of("vnc"); }
    boolean credentialSetupEnabled() { return desktopPolicy == DesktopPolicy.OWNER_SETUP; }
    boolean credentialConfigured() {
        return desktopPolicy == DesktopPolicy.FULL || (credentialSetupEnabled() && credentialStore.configured());
    }
    boolean desktopEnabled() { return desktopPolicy == DesktopPolicy.FULL || (credentialSetupEnabled() && credentialConfigured()); }
    String desktopBlockedReason() { return credentialSetupEnabled() ? "VNC_CREDENTIAL_REQUIRED" : DESKTOP_BLOCKED_REASON; }
    String keyboardCalibration() {
        return switch(desktopPolicy) {case FULL -> "OPERATOR_CONFIGURED";case BLOCKED -> "UNAVAILABLE";case OWNER_SETUP -> "UNVERIFIED_TEST_PROFILE";};
    }
    String desktopCredential() throws Exception {
        if(credentialSetupEnabled())return credentialStore.read();
        requireDesktop();return secretValue(secret);
    }
    Map<String,Object> desktopStatus() {
        boolean configured=credentialConfigured();
        return Map.of("credentialSetupEnabled",credentialSetupEnabled(),"credentialConfigured",configured,
            "desktopEnabled",desktopPolicy == DesktopPolicy.FULL || configured,"desktopPolicy",desktopPolicy.name(),
            "keyboardCalibration",keyboardCalibration());
    }
    /** The agent backend needs no VNC credential, but an owner-blocked desktop stays blocked for every backend. */
    void requireAgent() {
        if (!agentEnabled()) throw new Failure(503, "AGENT_DISABLED");
        if (desktopPolicy == DesktopPolicy.BLOCKED) throw new Failure(503, desktopBlockedReason());
    }
    void requireDesktop() {
        if (!desktopEnabled()) throw new Failure(503, desktopBlockedReason());
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
        if(desktopPolicy == DesktopPolicy.OWNER_SETUP && (secret!=null || dev.has("credentialRef")))
            throw new IllegalArgumentException("Owner setup requires the encrypted credential store");
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
        Path stateDir=Path.of(required(env,"RDG_STATE_DIR"));
        DesktopCredentialStore store=desktopPolicy == DesktopPolicy.OWNER_SETUP
            ? new DesktopCredentialStore(stateDir,Path.of(required(env,"RDG_VNC_KEY_FILE")),node,device) : null;
        return new Config(node,origin,issuer,audience,email,env.getOrDefault("RDG_OWNER_SUBJECT",""),device,label,host,5900,
            secret,env.getOrDefault("RDG_GUACD_HOST","127.0.0.1"),port(env.getOrDefault("RDG_GUACD_PORT","4822")),
            address,port(env.getOrDefault("RDG_LISTEN_PORT","32120")),stateDir,
            Path.of(env.getOrDefault("RDG_WEB_DIR","web/dist")),bookmarks,Map.copyOf(keysyms),desktopPolicy,store,AgentSettings.load(env));
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

package com.rdg;

import com.nimbusds.jose.jwk.JWKSet;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.*;
import java.util.*;

/** Test-classpath-only launcher. Production artifacts contain no keys or identity bypass. */
public final class BrowserFixtureMain {
    public static void main(String[] args) throws Exception {
        java.util.logging.LogManager.getLogManager().reset();
        Path dir=Path.of(args[0]);Files.createDirectories(dir);
        GuacdFixture upstream=new GuacdFixture();
        // Optional third argument `agent` adds the host agent backend, served by a disposable peer that plays a synthetic clip.
        boolean withAgent=args.length>2&&args[2].equals("agent");
        AgentFixture agent=null;Config c;
        if(withAgent) {
            Path tokenFile=Fixtures.agentTokenFile(dir);agent=new AgentFixture(dir.resolve("agent"),Files.readString(tokenFile).strip());
            agent.mode=AgentFixture.Mode.VIDEO;agent.receivedLog=dir.resolve("agent-received.jsonl");
            c=Fixtures.agentConfig(dir,upstream.server.getLocalPort(),args[1],agent.port,tokenFile);
        }else c=Fixtures.config(dir,upstream.server.getLocalPort(),args[1]);
        final AgentFixture peer=agent;
        var key=Fixtures.key("ephemeral-browser-fixture");
        Main.Runtime runtime=new Main.Runtime(c,new AccessVerifier(c,Clock.systemUTC(),()->new JWKSet(key.toPublicJWK()).toString()),new GuacdConnector(c));
        Path file=dir.resolve("proxy.json");Files.writeString(file,Config.JSON.writeValueAsString(Map.of("port",runtime.port(),"assertion",Fixtures.token(c,key,Instant.now(),3600,Map.of()))));
        Files.setPosixFilePermissions(file,PosixFilePermissions.fromString("rw-------"));
        java.lang.Runtime.getRuntime().addShutdownHook(new Thread(()->{try{runtime.close();upstream.close();if(peer!=null)peer.close();}catch(Exception ignored){}}));
        System.out.println("Disposable protocol browser fixture ready.");runtime.tomcat.getServer().await();
    }
}

package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.apache.guacamole.net.GuacamoleTunnel;
import org.apache.guacamole.protocol.ConfiguredGuacamoleSocket;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

/** Disposable official-protocol peer only; never authenticates to a real VNC server. */
class OwnerSetupConnectorTest {
    @TempDir Path dir;
    @Test void eachHandshakeUsesCurrentCredentialAndDropsRetainedConfigurationPassword() throws Exception {
        try(var upstream=new GuacdFixture()) {
            var base=Fixtures.ownerSetupConfig(dir,"https://gateway.fixture.test");
            var config=new Config(base.nodeId(),base.origin(),base.issuer(),base.audience(),base.ownerEmail(),base.ownerSubject(),
                base.deviceId(),base.label(),base.targetHost(),base.targetPort(),null,"127.0.0.1",upstream.server.getLocalPort(),
                base.listenAddress(),base.listenPort(),base.stateDir(),base.webDir(),base.bookmarks(),base.keysyms(),base.desktopPolicy(),base.credentialStore());
            var clock=new Fixtures.Time();
            try(var audit=new Audit(config.stateDir(),clock,config.nodeId());var sessions=new Sessions(config,clock,clock.nano::get,audit)) {
                var app=sessions.bootstrap(new AccessVerifier.Identity("fixture-owner",clock.instant().plusSeconds(3600)),null).getValue();
                for(String password:new String[]{"fixture-only-first","fixture-only-second"}) {
                    sessions.desktopCredential(app,password);
                    var desktop=sessions.begin(app,sessions.intent(app,config.deviceId(),"view","mac-native").id);
                    GuacamoleTunnel tunnel=new GuacdConnector(config).open(desktop);
                    try {
                        assertEquals(password,upstream.parameters.get("password"));
                        var official=assertInstanceOf(ConfiguredGuacamoleSocket.class,tunnel.getSocket());
                        assertNull(official.getConfiguration().getParameter("password"));
                        assertEquals("true",upstream.parameters.get("read-only"));
                        assertEquals("true",upstream.parameters.get("disable-copy"));assertEquals("true",upstream.parameters.get("disable-paste"));
                    }finally {tunnel.close();sessions.endDesktop(app,"USER_ENDED");}
                }
                assertEquals(2,upstream.connections.get());
            }
        }
    }
}

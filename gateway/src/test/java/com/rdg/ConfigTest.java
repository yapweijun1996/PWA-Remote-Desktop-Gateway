package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ConfigTest {
    @TempDir Path dir;
    @Test void missingConfigPlaceholdersAndUnsafeSecretRefuseStartup() throws Exception {
        assertThrows(Exception.class,()->Config.load(Map.of()));
        assertThrows(Exception.class,()->Config.load(Map.of("RDG_PUBLIC_ORIGIN","https://remote-mini.example.com")));
        Path secret=dir.resolve("secret");Files.writeString(secret,"fixture-only");Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-r--r--"));assertThrows(Exception.class,()->Config.secretValue(secret));
        Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-------"));assertEquals("fixture-only",Config.secretValue(secret));
        Path link=dir.resolve("link");Files.createSymbolicLink(link,secret);assertThrows(Exception.class,()->Config.secretValue(link));
    }
    @Test void malformedJsonAndUnknownFieldsRefuseBeforeSideEffects() throws Exception {
        assertThrows(Exception.class,()->Config.JSON.readTree("{\"mode\":\"view\",\"mode\":\"control\"}"));
        assertThrows(Failure.class,()->Config.fields(Config.JSON.readTree("{\"host\":\"evil\"}"),Set.of("deviceId")));
    }
    ObjectNode blockedDocument() {
        ObjectNode root=Config.JSON.createObjectNode();
        root.put("nodeId","fixture-node").put("publicOrigin","https://gateway.fixture.test");
        root.putObject("localDevice").put("id","fixture-mac").put("label","Disposable blocked policy fixture")
            .put("targetOS","macOS").put("upstreamHost","host.docker.internal").put("upstreamPort",5900);
        root.putArray("bookmarks");
        return root;
    }
    Map<String,String> environment(ObjectNode document) throws Exception {
        Path file=dir.resolve("device.json");Files.writeString(file,Config.JSON.writeValueAsString(document));
        var env=new HashMap<String,String>();
        env.put("RDG_PUBLIC_ORIGIN","https://gateway.fixture.test");
        env.put("RDG_ACCESS_ISSUER","https://fixture-team.cloudflareaccess.com");
        env.put("RDG_ACCESS_AUDIENCE","a".repeat(64));env.put("RDG_OWNER_EMAIL","owner@fixture.test");
        env.put("RDG_TARGET_CONFIG",file.toString());env.put("RDG_STATE_DIR",dir.resolve("state").toString());
        return env;
    }
    void calibratedKeys(ObjectNode document) {
        document.putObject("keysyms").put("CommandLeft",0xffe7).put("CommandRight",0xffe8)
            .put("OptionLeft",0xffe9).put("OptionRight",0xffea).put("ControlLeft",0xffe3).put("ControlRight",0xffe4);
    }
    @Test void onlyExplicitBlockedPolicyStartsWithoutDesktopPrerequisites() throws Exception {
        var document=blockedDocument();var env=environment(document);
        assertThrows(Exception.class,()->Config.load(env));
        for(String value:List.of("blocked","VIEW","","UNKNOWN")) {
            env.put("RDG_DESKTOP_POLICY",value);assertThrows(Exception.class,()->Config.load(env));
        }
        env.put("RDG_DESKTOP_POLICY","BLOCKED");var blocked=Config.load(env);
        assertEquals(Config.DesktopPolicy.BLOCKED,blocked.desktopPolicy());assertFalse(blocked.desktopEnabled());
        assertNull(blocked.secret());assertTrue(blocked.keysyms().isEmpty());
        document.putObject("keysyms");var emptyKeys=environment(document);emptyKeys.put("RDG_DESKTOP_POLICY","BLOCKED");
        assertTrue(Config.load(emptyKeys).keysyms().isEmpty());
    }
    @Test void fullPolicyStillRequiresProtectedCredentialAndAllCalibratedModifiers() throws Exception {
        var document=blockedDocument();((ObjectNode)document.path("localDevice")).put("credentialRef","/run/secrets/vnc_password");
        calibratedKeys(document);var env=environment(document);
        env.put("RDG_VNC_SECRET_FILE",dir.resolve("absent-secret").toString());
        assertThrows(Exception.class,()->Config.load(env));
        Path secret=dir.resolve("fixture-secret");Files.writeString(secret,"fixture-only-password");
        Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-------"));env.put("RDG_VNC_SECRET_FILE",secret.toString());
        var full=Config.load(env);assertEquals(Config.DesktopPolicy.FULL,full.desktopPolicy());assertTrue(full.desktopEnabled());
        document.remove("keysyms");var missingKeys=environment(document);missingKeys.put("RDG_VNC_SECRET_FILE",secret.toString());
        assertThrows(Exception.class,()->Config.load(missingKeys));
    }
    @Test void blockedPolicyNeverReadsAnOptionalCredentialButRejectsInvalidConfiguration() throws Exception {
        var document=blockedDocument();var env=environment(document);env.put("RDG_DESKTOP_POLICY","BLOCKED");
        // A directory cannot be a VNC secret. Loading BLOCKED must not inspect or read it.
        env.put("RDG_VNC_SECRET_FILE",dir.toString());assertEquals(dir,Config.load(env).secret());
        env.put("RDG_ACCESS_AUDIENCE","forged-audience");assertThrows(Exception.class,()->Config.load(env));
        env.put("RDG_ACCESS_AUDIENCE","a".repeat(64));env.put("RDG_ACCESS_ISSUER","https://untrusted.fixture.test");
        assertThrows(Exception.class,()->Config.load(env));
        ((ObjectNode)document.path("localDevice")).put("upstreamHost","unrelated.fixture.test");
        var outsideTarget=environment(document);outsideTarget.put("RDG_DESKTOP_POLICY","BLOCKED");
        assertThrows(Exception.class,()->Config.load(outsideTarget));
        ((ObjectNode)document.path("localDevice")).put("upstreamHost","host.docker.internal");
        document.putObject("keysyms").put("CommandLeft",0xffe7);
        var incompleteKeys=environment(document);incompleteKeys.put("RDG_DESKTOP_POLICY","BLOCKED");
        assertThrows(Exception.class,()->Config.load(incompleteKeys));
    }
    @Test void ownerSetupRequiresExternalProtectedKeyAndCompleteExplicitTestMappings() throws Exception {
        var document=blockedDocument();var env=environment(document);env.put("RDG_DESKTOP_POLICY","OWNER_SETUP");
        final var incomplete=env;assertThrows(Exception.class,()->Config.load(incomplete));
        calibratedKeys(document);env=environment(document);env.put("RDG_DESKTOP_POLICY","OWNER_SETUP");
        Path root=dir.toRealPath(),state=root.resolve("owner-state"),key=root.resolve("key/vnc.key");
        env.put("RDG_STATE_DIR",state.toString());env.put("RDG_VNC_KEY_FILE",key.toString());
        final var missingKey=env;assertThrows(Exception.class,()->Config.load(missingKey));
        DesktopCredentialStore.initializeKey(key,state);var setup=Config.load(env);
        assertTrue(setup.credentialSetupEnabled());assertFalse(setup.credentialConfigured());assertFalse(setup.desktopEnabled());
        assertEquals("UNVERIFIED_TEST_PROFILE",setup.keyboardCalibration());assertEquals(6,setup.keysyms().size());assertNull(setup.secret());
        setup.credentialStore().save("fixture-only-password");assertTrue(Config.load(env).desktopEnabled());
        ((ObjectNode)document.path("localDevice")).put("credentialRef","/run/secrets/vnc_password");
        var mixed=environment(document);mixed.put("RDG_DESKTOP_POLICY","OWNER_SETUP");mixed.put("RDG_STATE_DIR",state.toString());mixed.put("RDG_VNC_KEY_FILE",key.toString());
        assertThrows(Exception.class,()->Config.load(mixed));
        ((ObjectNode)document.path("localDevice")).remove("credentialRef");document.remove("keysyms");
        var absentMappings=environment(document);absentMappings.put("RDG_DESKTOP_POLICY","OWNER_SETUP");absentMappings.put("RDG_STATE_DIR",state.toString());absentMappings.put("RDG_VNC_KEY_FILE",key.toString());
        assertThrows(Exception.class,()->Config.load(absentMappings));
    }
}

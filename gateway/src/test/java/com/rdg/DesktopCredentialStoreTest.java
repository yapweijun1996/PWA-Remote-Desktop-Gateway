package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic credentials only; no host, upstream or infrastructure access. */
class DesktopCredentialStoreTest {
    @TempDir Path temp;
    Path state,key,envelope;
    DesktopCredentialStore store;
    @BeforeEach void setup() throws Exception {
        Path root=temp.toRealPath();state=root.resolve("state");key=root.resolve("key/vnc.key");
        DesktopCredentialStore.initializeKey(key,state);store=new DesktopCredentialStore(state,key,"fixture-node","fixture-mac");
        envelope=state.resolve("credentials/vnc.json");
    }
    void unavailable(org.junit.jupiter.api.function.Executable action) {
        Failure f=assertThrows(Failure.class,action);assertEquals(503,f.status);assertEquals("CREDENTIAL_STORE_UNAVAILABLE",f.code);
        assertEquals(f.code,f.getMessage());
    }
    @Test void encryptedRestartRecoveryFreshNonceAndRestrictiveStorage() throws Exception {
        assertFalse(store.configured());assertEquals("VNC_CREDENTIAL_REQUIRED",assertThrows(Failure.class,store::read).code);
        String marker="synthetic-vnc-only-sensitive-marker";store.save(marker);
        String first=Files.readString(envelope);assertFalse(first.contains(marker));assertEquals(marker,store.read());
        assertEquals(PosixFilePermissions.fromString("rw-------"),Files.getPosixFilePermissions(key));
        assertEquals(PosixFilePermissions.fromString("rw-------"),Files.getPosixFilePermissions(envelope));
        assertEquals(PosixFilePermissions.fromString("rwx------"),Files.getPosixFilePermissions(envelope.getParent()));
        assertEquals(marker,new DesktopCredentialStore(state,key,"fixture-node","fixture-mac").read());
        store.save(marker);assertNotEquals(first,Files.readString(envelope));
        try(var files=Files.list(envelope.getParent())){assertEquals(List.of("vnc.json"),files.map(p->p.getFileName().toString()).toList());}
    }
    @Test void everyEnvelopeMetadataAndCiphertextTamperRefusesAtStartup() throws Exception {
        store.save("fixture-only-password");byte[] original=Files.readAllBytes(envelope);
        var mutations=new LinkedHashMap<String,Object>();
        mutations.put("version",2);mutations.put("algorithm","OTHER");mutations.put("purpose","RDG_APP_AUTH");
        mutations.put("nodeId","other-node");mutations.put("deviceId","other-device");mutations.put("keyId","0".repeat(64));
        mutations.put("nonce",Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[12]));
        mutations.put("ciphertext",Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[24]));
        for(var m:mutations.entrySet()) {
            ObjectNode n=(ObjectNode)Config.JSON.readTree(original);
            if(m.getValue() instanceof Integer i)n.put(m.getKey(),i);else n.put(m.getKey(),m.getValue().toString());
            Files.write(envelope,Config.JSON.writeValueAsBytes(n));
            unavailable(()->new DesktopCredentialStore(state,key,"fixture-node","fixture-mac"));
        }
        Files.write(envelope,original);
        unavailable(()->new DesktopCredentialStore(state,key,"fixture-node","other-device"));
        unavailable(()->new DesktopCredentialStore(state,key,"other-node","fixture-mac"));
    }
    @Test void canonicalClosedEnvelopeRefusesDuplicatesPaddingAndUnknownFields() throws Exception {
        store.save("fixture-only-password");String original=Files.readString(envelope);
        var n=(ObjectNode)Config.JSON.readTree(original);n.put("extra","private");Files.writeString(envelope,n.toString());unavailable(store::read);
        Files.writeString(envelope,original.replace("\"version\":1","\"version\":1,\"version\":1"));unavailable(store::read);
        n=(ObjectNode)Config.JSON.readTree(original);n.put("nonce",n.path("nonce").asText()+"=");Files.writeString(envelope,n.toString());unavailable(store::read);
        Files.writeString(envelope,original+"\n");unavailable(store::read);
        Files.writeString(envelope," "+original);unavailable(store::read);
        Files.writeString(envelope,original);assertEquals("fixture-only-password",store.read());
    }
    @Test void changedMasterFailsEachReadSaveAndRestartWithoutReplacingEnvelope() throws Exception {
        store.save("fixture-only-password");byte[] original=Files.readAllBytes(envelope),master=Files.readAllBytes(key);
        byte[] changed=master.clone();changed[0]^=1;Files.write(key,changed);
        unavailable(store::read);unavailable(store::configured);unavailable(()->store.save("new-fixture-only"));
        unavailable(()->new DesktopCredentialStore(state,key,"fixture-node","fixture-mac"));
        assertArrayEquals(original,Files.readAllBytes(envelope));Files.write(key,master);assertEquals("fixture-only-password",store.read());
        Arrays.fill(master,(byte)0);Arrays.fill(changed,(byte)0);
    }
    @Test void unsafeFilesDirectoriesSymlinksAndHardLinksRefuse() throws Exception {
        store.save("fixture-only-password");
        for(Path path:List.of(key,envelope)) {
            Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-r--r--"));unavailable(store::read);
            Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-------"));
            Path backup=path.resolveSibling(path.getFileName()+".original");Files.move(path,backup);Files.createSymbolicLink(path,backup);
            unavailable(store::read);Files.delete(path);Files.move(backup,path);
            Path hard=path.resolveSibling(path.getFileName()+".hard");Files.createLink(hard,path);unavailable(store::read);Files.delete(hard);
        }
        for(Path path:List.of(state,state.resolve("credentials"),key.getParent())) {
            Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rwxr-x---"));unavailable(store::read);
            Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rwx------"));
        }
        Path alias=temp.toRealPath().resolve("state-link");Files.createSymbolicLink(alias,state);
        unavailable(()->new DesktopCredentialStore(alias,key,"fixture-node","fixture-mac"));
        assertEquals("fixture-only-password",store.read());
    }
    @Test void invalidValuesNeverOverwriteAndInitNeverRotatesOrAcceptsStateKey() throws Exception {
        store.save("fixture-only-password");byte[] before=Files.readAllBytes(envelope),master=Files.readAllBytes(key);
        for(String value:List.of("","x".repeat(129),"line\nnext","line\rnext","nul\0next","\ud800","界".repeat(100))) {
            Failure f=assertThrows(Failure.class,()->store.save(value));assertEquals("INVALID_CREDENTIAL",f.code);
            assertArrayEquals(before,Files.readAllBytes(envelope));
        }
        unavailable(()->DesktopCredentialStore.initializeKey(key,state));assertArrayEquals(master,Files.readAllBytes(key));
        unavailable(()->DesktopCredentialStore.initializeKey(state.resolve("inside.key"),state));
        unavailable(()->new DesktopCredentialStore(state,Path.of("relative-key"),"fixture-node","fixture-mac"));
        Arrays.fill(master,(byte)0);
    }
    @Test void corruptOrOversizedDataAndWrongKeyLengthFailClosed() throws Exception {
        Files.write(envelope,new byte[2049],StandardOpenOption.CREATE_NEW);
        Files.setPosixFilePermissions(envelope,PosixFilePermissions.fromString("rw-------"));unavailable(store::configured);
        Files.writeString(envelope,"{}");unavailable(store::read);Files.delete(envelope);
        Files.write(key,new byte[31]);unavailable(()->new DesktopCredentialStore(state,key,"fixture-node","fixture-mac"));
    }
}

package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.SecureRandom;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class TrustedDeviceStoreTest {
    @TempDir Path temporary;
    Path root,state,key;
    Fixtures.Time time;
    static final String OWNER="fixture-owner-subject",EMAIL="owner@fixture.test",NODE="fixture-node";
    @BeforeEach void prepare() throws Exception {
        root=temporary.toRealPath();state=root.resolve("state");Path keys=Files.createDirectory(root.resolve("keys"));
        Files.setPosixFilePermissions(keys,PosixFilePermissions.fromString("rwx------"));key=keys.resolve("master.key");
        byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);Files.write(key,bytes);privateFile(key);time=new Fixtures.Time();
    }
    TrustedDeviceStore open() throws Exception{return new TrustedDeviceStore(state,key,NODE,EMAIL,time);}
    AccessVerifier.Identity owner(){return new AccessVerifier.Identity(OWNER,time.instant().plusSeconds(3600));}
    static void privateFile(Path path) throws Exception{Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-------"));}
    static Failure denied(org.junit.jupiter.api.function.Executable action){Failure failure=assertThrows(Failure.class,action);assertEquals(401,failure.status);assertEquals("AUTH_REQUIRED",failure.code);return failure;}
    Path database(){return state.resolve("trusted-devices.sqlite");}

    @Test void issueLookupRestartAndSafeListing() throws Exception {
        TrustedDeviceStore.Issue issued;
        try(var store=open()) {
            issued=store.issue(owner());assertEquals(43,issued.token().length());assertEquals(22,issued.id().length());
            assertEquals(time.instant().plus(Duration.ofDays(365)),issued.expiresAt());
            assertFalse(issued.toString().contains(issued.token()));
            var verified=store.verify(issued.token());assertEquals(OWNER,verified.identity().subject());
            assertEquals(issued.expiresAt(),verified.identity().expiresAt());assertEquals(issued.id(),verified.deviceId());
            var rows=store.list(owner(),issued.token());assertEquals(1,rows.size());assertEquals(Set.of("id","createdAt","expiresAt","current"),rows.get(0).keySet());assertEquals(true,rows.get(0).get("current"));
        }
        try(var restored=open()){assertEquals(OWNER,restored.verify(issued.token()).identity().subject());assertEquals(issued.expiresAt(),restored.verify(issued.token()).identity().expiresAt());}
    }
    @Test void exactAbsoluteExpiryNeverExtendsOnUse() throws Exception {
        try(var store=open()) {
            var issued=store.issue(owner());time.advance(364*86400L);assertEquals(issued.expiresAt(),store.verify(issued.token()).identity().expiresAt());
            time.advance(86399);store.verify(issued.token());time.advance(1);denied(()->store.verify(issued.token()));
            assertTrue(store.list(owner(),issued.token()).isEmpty());
        }
    }
    @Test void revocationIsImmediateAndPersists() throws Exception {
        String first,second;
        try(var store=open()) {
            var one=store.issue(owner());var two=store.issue(owner());first=one.token();second=two.token();
            assertTrue(store.revoke(owner(),one.id()));assertFalse(store.revoke(owner(),one.id()));denied(()->store.verify(first));
            assertTrue(store.revokeToken(second));assertFalse(store.revokeToken(second));denied(()->store.verify(second));
        }
        try(var restored=open()){denied(()->restored.verify(first));denied(()->restored.verify(second));}
    }
    @Test void internalLiveAuthorityStopsAfterRevocationAndExactExpiry() throws Exception {
        try(var store=open()) {
            var first=store.issue(owner());assertEquals(OWNER,store.verifyDevice(first.id()).identity().subject());
            assertEquals(first.id(),store.verifyDevice(first.id()).deviceId());
            assertTrue(store.revoke(owner(),first.id()));denied(()->store.verifyDevice(first.id()));
            var second=store.issue(owner());time.advance(365*86400L);denied(()->store.verifyDevice(second.id()));
            denied(()->store.verifyDevice(first.token()));denied(()->store.verifyDevice(null));
        }
    }
    @Test void internalLiveAuthorityFailsOnEnvelopeTampering() throws Exception {
        try(var store=open()) {
            var issued=store.issue(owner());store.verifyDevice(issued.id());
            try(var connection=DriverManager.getConnection("jdbc:sqlite:"+database());var statement=connection.createStatement();var rows=statement.executeQuery("SELECT identity_ciphertext FROM trusted_devices")) {
                assertTrue(rows.next());String text=rows.getString(1);byte[] cipher=Base64.getUrlDecoder().decode(text);cipher[0]^=1;
                try(var update=connection.prepareStatement("UPDATE trusted_devices SET identity_ciphertext=?")) {
                    update.setString(1,Base64.getUrlEncoder().withoutPadding().encodeToString(cipher));update.executeUpdate();
                }
            }
            denied(()->store.verifyDevice(issued.id()));
        }
    }
    @Test void ownershipScopesListAndRevocation() throws Exception {
        try(var store=open()) {
            var issued=store.issue(owner());var other=new AccessVerifier.Identity("other-owner",time.instant().plusSeconds(100));
            assertTrue(store.list(other,issued.token()).isEmpty());Failure failure=assertThrows(Failure.class,()->store.revoke(other,issued.id()));
            assertEquals(403,failure.status);assertEquals("ACCESS_DENIED",failure.code);store.verify(issued.token());
            assertThrows(Exception.class,()->new TrustedDeviceStore(state,key,NODE,"different@fixture.test",time));
            assertThrows(Exception.class,()->new TrustedDeviceStore(state,key,"different-node",EMAIL,time));
        }
    }
    @Test void storageContainsNeitherBearerNorIdentityAndUsesPrivateModes() throws Exception {
        String token;
        try(var store=open()){token=store.issue(owner()).token();}
        byte[] bytes=Files.readAllBytes(database());String serialized=new String(bytes,StandardCharsets.ISO_8859_1);
        assertFalse(serialized.contains(token));assertFalse(serialized.contains(OWNER));assertFalse(serialized.contains(EMAIL));
        assertEquals(PosixFilePermissions.fromString("rwx------"),Files.getPosixFilePermissions(state));
        assertEquals(PosixFilePermissions.fromString("rw-------"),Files.getPosixFilePermissions(database()));
        try(var connection=DriverManager.getConnection("jdbc:sqlite:"+database());var statement=connection.createStatement();var rows=statement.executeQuery("SELECT digest,identity_ciphertext FROM trusted_devices")) {
            assertTrue(rows.next());assertTrue(rows.getString(1).matches("[a-f0-9]{64}"));assertNotEquals(token,rows.getString(1));assertFalse(rows.getString(2).contains(OWNER));
        }
    }
    @Test void concurrentStoresCannotExceedDeviceLimit() throws Exception {
        try(var first=open();var second=open()) {
            var executor=Executors.newFixedThreadPool(8);
            try {
                List<Future<Boolean>> results=new ArrayList<>();
                for(int index=0;index<48;index++){var selected=index%2==0?first:second;results.add(executor.submit(()->{try{selected.issue(owner());return true;}catch(Failure e){assertEquals(409,e.status);assertEquals("TRUSTED_DEVICE_LIMIT",e.code);return false;}}));}
                int accepted=0;for(var result:results)if(result.get(15,TimeUnit.SECONDS))accepted++;
                assertEquals(32,accepted);assertEquals(32,first.list(owner(),null).size());
            } finally {executor.shutdownNow();}
        }
    }
    @Test void expiryFreesCapacityWithoutTrustingTamperedExpiry() throws Exception {
        try(var store=open()){for(int i=0;i<32;i++)store.issue(owner());time.advance(365*86400L);assertNotNull(store.issue(owner()));assertEquals(1,store.list(owner(),null).size());}
    }
    @Test void malformedExpiredOrMissingTokensNeverAuthenticate() throws Exception {
        try(var store=open()) {
            var issued=store.issue(owner());
            String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            String alias=issued.token().substring(0,42)+alphabet.charAt(alphabet.indexOf(issued.token().charAt(42))+1);
            assertArrayEquals(Base64.getUrlDecoder().decode(issued.token()),Base64.getUrlDecoder().decode(alias));
            for(String invalid:Arrays.asList(null,"",issued.token()+"=",issued.token()+",",issued.token().substring(1),"x".repeat(5000),"a".repeat(43),alias))denied(()->store.verify(invalid));
            denied(()->store.issue(new AccessVerifier.Identity(OWNER,time.instant())));denied(()->store.issue(null));
            time.now=time.now.minusSeconds(1);denied(()->store.verify(issued.token()));
        }
    }
    @Test void replacedKeyFailsLiveAndWrongKeyRefusesRestart() throws Exception {
        String token;
        try(var store=open()) {
            token=store.issue(owner()).token();byte[] replacement=new byte[32];new SecureRandom().nextBytes(replacement);Files.write(key,replacement);
            denied(()->store.verify(token));Failure failure=assertThrows(Failure.class,()->store.list(owner(),token));assertEquals(503,failure.status);
        }
        assertThrows(Exception.class,this::open);
    }
    @Test void canonicalEncodingAndAllEnvelopeMetadataAreAuthenticated() throws Exception {
        for(String column:List.of("digest","id","created_at","expires_at","nonce","identity_ciphertext")) {
            Path nextState=root.resolve("tamper-"+column);
            try(var store=new TrustedDeviceStore(nextState,key,NODE,EMAIL,time)) {
                var issued=store.issue(owner());String changed;
                try(var connection=DriverManager.getConnection("jdbc:sqlite:"+nextState.resolve("trusted-devices.sqlite"));var statement=connection.createStatement();var rows=statement.executeQuery("SELECT "+column+" FROM trusted_devices")) {
                    assertTrue(rows.next());String old=rows.getString(1);
                    changed=switch(column){case "created_at","expires_at"->Instant.parse(old).plusSeconds(1).toString();case "digest"->old.charAt(0)=='a'?"b"+old.substring(1):"a"+old.substring(1);default->old.charAt(0)=='A'?"B"+old.substring(1):"A"+old.substring(1);};
                }
                try(var connection=DriverManager.getConnection("jdbc:sqlite:"+nextState.resolve("trusted-devices.sqlite"));var statement=connection.prepareStatement("UPDATE trusted_devices SET "+column+"=?")){statement.setString(1,changed);statement.executeUpdate();}
                denied(()->store.verify(issued.token()));
            }
            assertThrows(Exception.class,()->new TrustedDeviceStore(nextState,key,NODE,EMAIL,time));
        }
        Path canonicalState=root.resolve("canonical");
        try(var store=new TrustedDeviceStore(canonicalState,key,NODE,EMAIL,time)) {
            var issued=store.issue(owner());
            try(var connection=DriverManager.getConnection("jdbc:sqlite:"+canonicalState.resolve("trusted-devices.sqlite"));var statement=connection.createStatement()){statement.executeUpdate("UPDATE trusted_devices SET identity_ciphertext=identity_ciphertext || '='");}
            denied(()->store.verify(issued.token()));
        }
    }
    @Test void validShapedLifecycleTamperingCannotBecomeExpiredPruning() throws Exception {
        try(var store=open()) {
            var issued=store.issue(owner());
            try(var connection=DriverManager.getConnection("jdbc:sqlite:"+database());var statement=connection.prepareStatement("UPDATE trusted_devices SET created_at=?,expires_at=?")) {
                statement.setString(1,time.instant().minus(Duration.ofDays(366)).toString());statement.setString(2,time.instant().minus(Duration.ofDays(1)).toString());statement.executeUpdate();
            }
            denied(()->store.verify(issued.token()));
            Failure failure=assertThrows(Failure.class,()->store.issue(owner()));assertEquals(503,failure.status);
        }
        assertThrows(Exception.class,this::open);
    }
    @Test void databaseCorruptionAndUnsafePermissionsFailClosed() throws Exception {
        String token;
        try(var store=open()) {
            token=store.issue(owner()).token();Files.setPosixFilePermissions(database(),PosixFilePermissions.fromString("rw-r--r--"));denied(()->store.verify(token));privateFile(database());
            Files.setPosixFilePermissions(state,PosixFilePermissions.fromString("rwxr-xr-x"));denied(()->store.verify(token));Files.setPosixFilePermissions(state,PosixFilePermissions.fromString("rwx------"));
            Files.setPosixFilePermissions(key,PosixFilePermissions.fromString("rw-r--r--"));denied(()->store.verify(token));privateFile(key);
        }
        Files.writeString(database(),"not a SQLite database");assertThrows(Exception.class,this::open);
    }
    @Test void symlinkAndKeyInsideStateAreRejected() throws Exception {
        try(var store=open()){store.issue(owner());}
        Path linkedState=root.resolve("linked-state");Files.createSymbolicLink(linkedState,state);assertThrows(Exception.class,()->new TrustedDeviceStore(linkedState,key,NODE,EMAIL,time));
        Path linkedKey=key.getParent().resolve("linked.key");Files.createSymbolicLink(linkedKey,key);assertThrows(Exception.class,()->new TrustedDeviceStore(state,linkedKey,NODE,EMAIL,time));
        Path linkedParent=root.resolve("linked-keys");Files.createSymbolicLink(linkedParent,key.getParent());assertThrows(Exception.class,()->new TrustedDeviceStore(state,linkedParent.resolve("master.key"),NODE,EMAIL,time));
        Path internal=state.resolve("master.key");Files.copy(key,internal);privateFile(internal);assertThrows(Exception.class,()->new TrustedDeviceStore(state,internal,NODE,EMAIL,time));
        Files.delete(database());Files.createSymbolicLink(database(),internal);assertThrows(Exception.class,this::open);
    }
    @Test void journalSymlinkAndInvalidMasterLengthAreRejected() throws Exception {
        try(var store=open()){store.issue(owner());}
        Files.createSymbolicLink(Path.of(database()+"-journal"),key);assertThrows(Exception.class,this::open);Files.delete(Path.of(database()+"-journal"));
        Files.write(key,new byte[31]);assertThrows(Exception.class,this::open);
    }
}

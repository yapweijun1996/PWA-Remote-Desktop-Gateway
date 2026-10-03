package com.rdg;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Revocable opaque browser credentials; plaintext bearer and owner identity never enter SQLite. */
final class TrustedDeviceStore implements AutoCloseable {
    record Issue(String token, String id, Instant expiresAt) {
        @Override public String toString() { return "Issue[id="+id+", expiresAt="+expiresAt+"]"; }
    }
    record Verified(AccessVerifier.Identity identity, String deviceId) {}
    private record Device(String digest, String id, Instant createdAt, Instant expiresAt, String subject) {}
    private interface Operation<T> { T apply(List<Device> devices) throws Exception; }
    private static final ObjectMapper JSON=new ObjectMapper();
    private static final SecureRandom RANDOM=new SecureRandom();
    private static final Base64.Encoder ENCODER=Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER=Base64.getUrlDecoder();
    private static final Set<PosixFilePermission> DIRECTORY_MODE=PosixFilePermissions.fromString("rwx------");
    private static final Set<PosixFilePermission> FILE_MODE=PosixFilePermissions.fromString("rw-------");
    private static final Duration LIFETIME=Duration.ofDays(365);
    private static final int MAX_DEVICES=32;
    private final Connection db;
    private final Path directory, keyFile, database;
    private final String nodeId, ownerEmail, ownerSubject, keyCheck;
    private final Clock clock;
    private final byte[] lookupKey, identityKey;

    TrustedDeviceStore(Path stateDir, Path keyFile, String nodeId, String ownerEmail, Clock clock) throws Exception {
        this(stateDir,keyFile,nodeId,ownerEmail,"",clock);
    }
    TrustedDeviceStore(Path stateDir, Path keyFile, String nodeId, String ownerEmail, String ownerSubject, Clock clock) throws Exception {
        if(nodeId==null || !nodeId.matches("[a-z0-9][a-z0-9-]{0,63}") || ownerEmail==null
            || !ownerEmail.matches("[^\\s@\\p{Cntrl}]+@[^\\s@\\p{Cntrl}]+") || ownerEmail.length()>320 || clock==null)
            throw new IllegalArgumentException("Invalid trusted-device configuration");
        this.directory=stateDir.toAbsolutePath().normalize();this.keyFile=keyFile.toAbsolutePath().normalize();
        this.nodeId=nodeId;this.ownerEmail=ownerEmail;this.ownerSubject=Objects.requireNonNull(ownerSubject);this.clock=clock;
        if(this.keyFile.startsWith(directory))throw new IllegalArgumentException("Master key must be outside state storage");
        rejectSymlinks(directory);rejectSymlinks(this.keyFile);
        if(!Files.exists(directory,LinkOption.NOFOLLOW_LINKS))Files.createDirectories(directory,PosixFilePermissions.asFileAttribute(DIRECTORY_MODE));
        checkDirectory();
        byte[] master=readMaster();
        try {
            lookupKey=derive(master,"token-lookup");identityKey=derive(master,"identity-aead");
            keyCheck=hex(derive(master,"store-key-check"));
        } finally {Arrays.fill(master,(byte)0);}
        database=directory.resolve("trusted-devices.sqlite");
        if(!Files.exists(database,LinkOption.NOFOLLOW_LINKS))Files.createFile(database,PosixFilePermissions.asFileAttribute(FILE_MODE));
        checkDatabasePaths();
        Connection opened=DriverManager.getConnection("jdbc:sqlite:"+database);
        try {
            try(var statement=opened.createStatement()) {
                statement.execute("PRAGMA journal_mode=DELETE");statement.execute("PRAGMA busy_timeout=5000");
                statement.execute("PRAGMA secure_delete=ON");statement.execute("PRAGMA max_page_count=128");
                statement.execute("CREATE TABLE IF NOT EXISTS trusted_device_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
                statement.execute("CREATE TABLE IF NOT EXISTS trusted_devices(digest TEXT PRIMARY KEY,id TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,nonce TEXT NOT NULL,identity_ciphertext TEXT NOT NULL)");
            }
            db=opened;
            transaction(devices->null,true);
        } catch(Exception e) {opened.close();throw new IllegalArgumentException("Trusted-device storage unavailable");}
    }

    synchronized Issue issue(AccessVerifier.Identity owner) {
        requireIdentity(owner);
        return transact(devices->{
            if(devices.size()>=MAX_DEVICES)throw new Failure(409,"TRUSTED_DEVICE_LIMIT");
            String token=random(32),id=random(16),digest=digest(token);
            Instant created=clock.instant(),expires=created.plus(LIFETIME);
            byte[] nonce=new byte[12];RANDOM.nextBytes(nonce);
            byte[] plaintext=identityPlaintext(owner.subject());
            byte[] ciphertext;
            try {ciphertext=encrypt(plaintext,nonce,aad(digest,id,created,expires));}
            finally {Arrays.fill(plaintext,(byte)0);}
            try(var insert=db.prepareStatement("INSERT INTO trusted_devices VALUES(?,?,?,?,?,?)")) {
                insert.setString(1,digest);insert.setString(2,id);insert.setString(3,created.toString());insert.setString(4,expires.toString());
                insert.setString(5,ENCODER.encodeToString(nonce));insert.setString(6,ENCODER.encodeToString(ciphertext));insert.executeUpdate();
            }
            return new Issue(token,id,expires);
        },503);
    }

    synchronized Verified verify(String token) {
        String candidate=tokenDigest(token);
        if(candidate==null)throw new Failure(401,"AUTH_REQUIRED");
        return transact(devices->{
            Device match=find(devices,candidate);
            if(match==null || clock.instant().isBefore(match.createdAt()))throw new Failure(401,"AUTH_REQUIRED");
            var identity=new AccessVerifier.Identity(match.subject(),match.expiresAt());requireIdentity(identity);
            return new Verified(identity,match.id());
        },401);
    }

    /** Internal live-authority check for a session whose browser bearer was already verified. */
    synchronized Verified verifyDevice(String deviceId) {
        if(!canonical(deviceId,16))throw new Failure(401,"AUTH_REQUIRED");
        return transact(devices->{
            for(Device device:devices)if(device.id().equals(deviceId) && !clock.instant().isBefore(device.createdAt())) {
                var identity=new AccessVerifier.Identity(device.subject(),device.expiresAt());requireIdentity(identity);
                return new Verified(identity,device.id());
            }
            throw new Failure(401,"AUTH_REQUIRED");
        },401);
    }

    synchronized List<Map<String,Object>> list(AccessVerifier.Identity owner,String currentToken) {
        requireIdentity(owner);String candidate=tokenDigest(currentToken);
        return transact(devices->{
            List<Map<String,Object>> result=new ArrayList<>();
            for(Device device:devices)if(sameOwner(device,owner))result.add(Map.of("id",device.id(),"createdAt",device.createdAt().toString(),
                "expiresAt",device.expiresAt().toString(),"current",candidate!=null && constantEquals(candidate,device.digest())));
            return List.copyOf(result);
        },503);
    }

    synchronized boolean revoke(AccessVerifier.Identity owner,String id) {
        requireIdentity(owner);
        if(!canonical(id,16))throw new Failure(403,"ACCESS_DENIED");
        return transact(devices->{
            Device match=null;for(Device device:devices)if(device.id().equals(id)){match=device;break;}
            if(match==null)return false;
            if(!sameOwner(match,owner))throw new Failure(403,"ACCESS_DENIED");
            delete(match.digest());return true;
        },503);
    }

    synchronized boolean revokeToken(String token) {
        String candidate=tokenDigest(token);if(candidate==null)return false;
        return transact(devices->{Device match=find(devices,candidate);if(match==null)return false;delete(match.digest());return true;},401);
    }

    private <T> T transact(Operation<T> operation,int failureStatus) {
        try{return transaction(operation,false);}
        catch(Failure e){throw e;}
        catch(Exception e){throw new Failure(failureStatus,failureStatus==401?"AUTH_REQUIRED":"TRUSTED_DEVICES_UNAVAILABLE");}
    }

    private <T> T transaction(Operation<T> operation,boolean initialize) throws Exception {
        checkDirectory();checkDatabasePaths();
        byte[] master=readMaster();
        try {if(!constantEquals(keyCheck,hex(derive(master,"store-key-check"))))throw new GeneralSecurityException();}
        finally {Arrays.fill(master,(byte)0);}
        try(var statement=db.createStatement()){statement.execute("BEGIN IMMEDIATE");}
        try {
            validateMetadata(initialize);
            List<Device> records=readDevices();
            List<Device> active=new ArrayList<>();Instant now=clock.instant();
            // Authenticate every envelope before removing expired records: tampering is never treated as expiry.
            for(Device record:records)if(now.isBefore(record.expiresAt()))active.add(record);else delete(record.digest());
            T result=operation.apply(active);
            try(var statement=db.createStatement()){statement.execute("COMMIT");}
            checkDatabasePaths();return result;
        } catch(Exception e) {
            try(var statement=db.createStatement()){statement.execute("ROLLBACK");}catch(SQLException ignored){}
            throw e;
        }
    }

    private void validateMetadata(boolean initialize) throws Exception {
        Map<String,String> metadata=new HashMap<>();
        try(var statement=db.createStatement();var rows=statement.executeQuery("SELECT key,value FROM trusted_device_metadata LIMIT 4")) {
            while(rows.next())metadata.put(rows.getString(1),rows.getString(2));
        }
        if(metadata.isEmpty() && initialize) {
            try(var statement=db.createStatement();var rows=statement.executeQuery("SELECT count(*) FROM trusted_devices")) {
                if(!rows.next() || rows.getInt(1)!=0)throw new GeneralSecurityException();
            }
            try(var insert=db.prepareStatement("INSERT INTO trusted_device_metadata VALUES(?,?)")) {
                for(var item:Map.of("version","1","node",nodeId,"key_check",keyCheck).entrySet()) {
                    insert.setString(1,item.getKey());insert.setString(2,item.getValue());insert.executeUpdate();
                }
            }
        } else if(metadata.size()!=3 || !"1".equals(metadata.get("version")) || !nodeId.equals(metadata.get("node"))
            || !constantEquals(keyCheck,metadata.get("key_check")))throw new GeneralSecurityException();
    }

    private List<Device> readDevices() throws Exception {
        List<Device> devices=new ArrayList<>();Set<String> ids=new HashSet<>();
        try(var statement=db.createStatement();var rows=statement.executeQuery("SELECT digest,id,created_at,expires_at,nonce,identity_ciphertext FROM trusted_devices ORDER BY created_at,id LIMIT 33")) {
            while(rows.next()) {
                if(devices.size()==MAX_DEVICES)throw new GeneralSecurityException();
                String digest=rows.getString(1),id=rows.getString(2),createdText=rows.getString(3),expiresText=rows.getString(4);
                if(digest==null || !digest.matches("[a-f0-9]{64}") || !canonical(id,16) || !ids.add(id)
                    || createdText==null || createdText.length()>40 || expiresText==null || expiresText.length()>40)throw new GeneralSecurityException();
                Instant created=Instant.parse(createdText),expires=Instant.parse(expiresText);
                if(!created.toString().equals(createdText) || !expires.toString().equals(expiresText) || !created.plus(LIFETIME).equals(expires))throw new GeneralSecurityException();
                String nonceText=rows.getString(5),cipherText=rows.getString(6);
                if(!canonical(nonceText,12) || cipherText==null || cipherText.length()>4096 || !canonical(cipherText,-1))throw new GeneralSecurityException();
                byte[] plaintext=decrypt(DECODER.decode(cipherText),DECODER.decode(nonceText),aad(digest,id,created,expires));
                String subject;
                try {
                    JsonNode identity=JSON.readTree(plaintext);
                    if(!identity.isObject() || identity.size()!=2 || !identity.has("subject") || !identity.get("subject").isTextual()
                        || !identity.has("email") || !identity.get("email").isTextual() || !ownerEmail.equals(identity.get("email").textValue()))throw new GeneralSecurityException();
                    subject=identity.get("subject").textValue();
                    if(subject.isBlank() || subject.length()>256 || !Arrays.equals(plaintext,identityPlaintext(subject)))throw new GeneralSecurityException();
                } finally {Arrays.fill(plaintext,(byte)0);}
                devices.add(new Device(digest,id,created,expires,subject));
            }
        }
        return devices;
    }

    private byte[] identityPlaintext(String subject) throws Exception {
        Map<String,String> fields=new LinkedHashMap<>();fields.put("subject",subject);fields.put("email",ownerEmail);return JSON.writeValueAsBytes(fields);
    }
    private byte[] aad(String digest,String id,Instant created,Instant expires) throws Exception {
        var output=new ByteArrayOutputStream();
        try(var data=new DataOutputStream(output)) {
            for(String field:List.of("rdg.trusted-device.identity","1",nodeId,ownerEmail,keyCheck,digest,id,created.toString(),expires.toString())) {
                byte[] bytes=field.getBytes(StandardCharsets.UTF_8);data.writeInt(bytes.length);data.write(bytes);
            }
        }
        return output.toByteArray();
    }
    private byte[] encrypt(byte[] plaintext,byte[] nonce,byte[] aad) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(identityKey,"AES"),new GCMParameterSpec(128,nonce));
        cipher.updateAAD(aad);return cipher.doFinal(plaintext);
    }
    private byte[] decrypt(byte[] ciphertext,byte[] nonce,byte[] aad) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(identityKey,"AES"),new GCMParameterSpec(128,nonce));
        cipher.updateAAD(aad);return cipher.doFinal(ciphertext);
    }
    private byte[] derive(byte[] master,String purpose) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(master,"HmacSHA256"));
        return mac.doFinal(("rdg.trusted-device.key.v1\u0000"+purpose+"\u0000"+nodeId+"\u0000"+ownerEmail).getBytes(StandardCharsets.UTF_8));
    }
    private String digest(String token) throws Exception {
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(lookupKey,"HmacSHA256"));
        return hex(mac.doFinal(("rdg.trusted-device.token.v1\u0000"+token).getBytes(StandardCharsets.US_ASCII)));
    }
    private String tokenDigest(String token) {
        if(!canonical(token,32))return null;
        try{return digest(token);}catch(Exception e){throw new Failure(401,"AUTH_REQUIRED");}
    }
    private static Device find(List<Device> devices,String digest) {
        for(Device device:devices)if(constantEquals(digest,device.digest()))return device;return null;
    }
    private static boolean sameOwner(Device device,AccessVerifier.Identity owner) {return constantEquals(device.subject(),owner.subject());}
    private void requireIdentity(AccessVerifier.Identity identity) {
        if(identity==null || identity.subject()==null || identity.subject().isBlank() || identity.subject().length()>256 || identity.expiresAt()==null
            || (!ownerSubject.isBlank() && !constantEquals(ownerSubject,identity.subject()))
            || !clock.instant().isBefore(identity.expiresAt()))throw new Failure(401,"AUTH_REQUIRED");
    }
    private void delete(String digest) throws SQLException {
        try(var statement=db.prepareStatement("DELETE FROM trusted_devices WHERE digest=?")){statement.setString(1,digest);statement.executeUpdate();}
    }
    private byte[] readMaster() throws Exception {
        rejectSymlinks(keyFile);
        Path parent=keyFile.getParent();Set<PosixFilePermission> permissions=Files.getPosixFilePermissions(parent,LinkOption.NOFOLLOW_LINKS);
        if(!Files.isDirectory(parent,LinkOption.NOFOLLOW_LINKS) || !permissions.contains(PosixFilePermission.OWNER_READ)
            || !permissions.contains(PosixFilePermission.OWNER_EXECUTE) || permissions.stream().anyMatch(p->p.name().startsWith("GROUP_")||p.name().startsWith("OTHERS_")))throw new GeneralSecurityException();
        if(!Files.isRegularFile(keyFile,LinkOption.NOFOLLOW_LINKS) || Files.size(keyFile)!=32
            || !Files.getOwner(keyFile,LinkOption.NOFOLLOW_LINKS).equals(Files.getOwner(directory,LinkOption.NOFOLLOW_LINKS)))throw new GeneralSecurityException();
        Set<PosixFilePermission> mode=Files.getPosixFilePermissions(keyFile,LinkOption.NOFOLLOW_LINKS);
        if(!mode.equals(FILE_MODE) && !mode.equals(PosixFilePermissions.fromString("r--------")))throw new GeneralSecurityException();
        try(var channel=FileChannel.open(keyFile,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)) {
            ByteBuffer bytes=ByteBuffer.allocate(33);while(bytes.hasRemaining() && channel.read(bytes)!=-1){}
            if(bytes.position()!=32){Arrays.fill(bytes.array(),(byte)0);throw new GeneralSecurityException();}
            byte[] result=Arrays.copyOf(bytes.array(),32);Arrays.fill(bytes.array(),(byte)0);return result;
        }
    }
    private void checkDirectory() throws Exception {
        rejectSymlinks(directory);
        if(!Files.isDirectory(directory,LinkOption.NOFOLLOW_LINKS) || !Files.getPosixFilePermissions(directory,LinkOption.NOFOLLOW_LINKS).equals(DIRECTORY_MODE))throw new GeneralSecurityException();
    }
    private void checkDatabasePaths() throws Exception {
        for(String suffix:List.of("","-journal","-wal","-shm")) {
            Path path=Path.of(database.toString()+suffix);
            if(Files.exists(path,LinkOption.NOFOLLOW_LINKS) && (!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(path) || !Files.getPosixFilePermissions(path,LinkOption.NOFOLLOW_LINKS).equals(FILE_MODE)
                || !Files.getOwner(path,LinkOption.NOFOLLOW_LINKS).equals(Files.getOwner(directory,LinkOption.NOFOLLOW_LINKS))))throw new GeneralSecurityException();
        }
        if(Files.size(database)>524288)throw new GeneralSecurityException();
    }
    private static void rejectSymlinks(Path path) throws Exception {
        Path component=path.getRoot();for(Path part:path){component=component.resolve(part);if(Files.isSymbolicLink(component))throw new GeneralSecurityException();}
    }
    private static boolean canonical(String text,int bytes) {
        if(text==null || text.length()>4096 || !text.matches("[A-Za-z0-9_-]+"))return false;
        try {byte[] decoded=DECODER.decode(text);return (bytes<0 || decoded.length==bytes) && ENCODER.encodeToString(decoded).equals(text);}
        catch(IllegalArgumentException e){return false;}
    }
    private static String random(int bytes) {byte[] value=new byte[bytes];RANDOM.nextBytes(value);return ENCODER.encodeToString(value);}
    private static String hex(byte[] bytes) {return HexFormat.of().formatHex(bytes);}
    private static boolean constantEquals(String first,String second) {
        return first!=null && second!=null && MessageDigest.isEqual(first.getBytes(StandardCharsets.UTF_8),second.getBytes(StandardCharsets.UTF_8));
    }
    public synchronized void close() throws SQLException {try{db.close();}finally{Arrays.fill(lookupKey,(byte)0);Arrays.fill(identityKey,(byte)0);}}
}

package com.rdg;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.*;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.util.*;

/** Recoverable upstream credential, encrypted independently of the state backup. */
final class DesktopCredentialStore {
    private static final String PURPOSE="RDG_VNC_CREDENTIAL", ALGORITHM="A256GCM";
    private static final Set<String> FIELDS=Set.of("version","algorithm","purpose","nodeId","deviceId","keyId","nonce","ciphertext");
    private static final Set<PosixFilePermission> FILE_MODE=PosixFilePermissions.fromString("rw-------");
    private static final Set<PosixFilePermission> DIRECTORY_MODE=PosixFilePermissions.fromString("rwx------");
    private static final SecureRandom RANDOM=new SecureRandom();
    private final Path stateDir, directory, file, keyFile;
    private final String nodeId, deviceId;

    DesktopCredentialStore(Path stateDir,Path keyFile,String nodeId,String deviceId) {
        try {
            this.stateDir=absolute(stateDir);this.keyFile=absolute(keyFile);
            if(this.keyFile.startsWith(this.stateDir))throw new IllegalArgumentException();
            this.nodeId=nodeId;this.deviceId=deviceId;
            privateDirectory(this.stateDir,true);
            directory=this.stateDir.resolve("credentials");privateDirectory(directory,true);
            file=directory.resolve("vnc.json");
            byte[] key=readKey();Arrays.fill(key,(byte)0);
            // An existing corrupt envelope or changed master key must refuse startup.
            if(Files.exists(file,LinkOption.NOFOLLOW_LINKS))read();
        }catch(Exception e){throw unavailable();}
    }

    Path keyFile() {return keyFile;}
    synchronized boolean configured() {
        try {
            checkDirectories();
            if(!Files.exists(file,LinkOption.NOFOLLOW_LINKS)) {
                byte[] key=readKey();Arrays.fill(key,(byte)0);return false;
            }
            read();return true;
        }catch(Exception e){throw unavailable();}
    }
    synchronized String read() {
        byte[] key=null,plain=null;
        try {
            checkDirectories();key=readKey();
            if(!Files.exists(file,LinkOption.NOFOLLOW_LINKS))throw new Failure(503,"VNC_CREDENTIAL_REQUIRED");
            byte[] serialized=readPrivate(file,2048);
            JsonNode envelope=Config.JSON.readTree(serialized);
            if(envelope==null || !envelope.isObject() || envelope.size()!=FIELDS.size())throw new IllegalArgumentException();
            Config.fields(envelope,FIELDS);
            if(!envelope.path("version").isInt() || envelope.path("version").intValue()!=1
                || !ALGORITHM.equals(text(envelope,"algorithm")) || !PURPOSE.equals(text(envelope,"purpose"))
                || !nodeId.equals(text(envelope,"nodeId")) || !deviceId.equals(text(envelope,"deviceId"))
                || !keyId(key).equals(text(envelope,"keyId")))throw new IllegalArgumentException();
            byte[] nonce=decode(text(envelope,"nonce")),encrypted=decode(text(envelope,"ciphertext"));
            if(nonce.length!=12 || encrypted.length<17 || encrypted.length>272)throw new IllegalArgumentException();
            ObjectNode metadata=metadata(key,nonce);
            ObjectNode canonical=metadata.deepCopy();canonical.put("ciphertext",encode(encrypted));
            if(!Arrays.equals(serialized,Config.JSON.writeValueAsBytes(canonical)))throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
            cipher.updateAAD(Config.JSON.writeValueAsBytes(metadata));plain=cipher.doFinal(encrypted);
            String password=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(plain)).toString();
            validate(password);return password;
        }catch(Failure e){if(e.code.equals("VNC_CREDENTIAL_REQUIRED"))throw e;throw unavailable();}
        catch(Exception e){throw unavailable();}
        finally {if(key!=null)Arrays.fill(key,(byte)0);if(plain!=null)Arrays.fill(plain,(byte)0);}
    }

    synchronized void save(String password) {
        validate(password);
        byte[] key=null,plain=null;Path temporary=null;
        try {
            checkDirectories();key=readKey();
            if(Files.exists(file,LinkOption.NOFOLLOW_LINKS))read();
            byte[] nonce=new byte[12];RANDOM.nextBytes(nonce);
            ObjectNode envelope=metadata(key,nonce);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
            cipher.updateAAD(Config.JSON.writeValueAsBytes(envelope));plain=password.getBytes(StandardCharsets.UTF_8);
            envelope.put("ciphertext",encode(cipher.doFinal(plain)));
            byte[] serialized=Config.JSON.writeValueAsBytes(envelope);
            temporary=Files.createTempFile(directory,".vnc-",".tmp",PosixFilePermissions.asFileAttribute(FILE_MODE));
            privateFile(temporary,2048);
            try(FileChannel channel=FileChannel.open(temporary,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS)) {
                writeAll(channel,serialized);channel.force(true);
            }
            checkDirectories();
            if(Files.exists(file,LinkOption.NOFOLLOW_LINKS))privateFile(file,2048);
            requireCurrentKey(key);
            Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);temporary=null;
            forceDirectory(directory);
        }catch(Exception e){throw unavailable();}
        finally {
            if(key!=null)Arrays.fill(key,(byte)0);if(plain!=null)Arrays.fill(plain,(byte)0);
            if(temporary!=null)try{Files.deleteIfExists(temporary);}catch(Exception ignored){}
        }
    }

    static void validate(String password) {
        if(password==null || password.isEmpty() || password.length()>128 || password.indexOf('\0')>=0
            || password.indexOf('\r')>=0 || password.indexOf('\n')>=0)throw new Failure(400,"INVALID_CREDENTIAL");
        try {
            ByteBuffer bytes=StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).encode(java.nio.CharBuffer.wrap(password));
            boolean valid=bytes.remaining()<=256;if(bytes.hasArray())Arrays.fill(bytes.array(),(byte)0);
            if(!valid)throw new Failure(400,"INVALID_CREDENTIAL");
        }catch(CharacterCodingException e){throw new Failure(400,"INVALID_CREDENTIAL");}
    }

    /** Offline creation only; an existing master is never replaced or disclosed. */
    static void initializeKey(Path keyFile,Path stateDir) {
        byte[] key=new byte[32];boolean created=false;
        Path path=null;
        try {
            path=absolute(keyFile);Path state=absolute(stateDir);
            chain(state);
            if(path.startsWith(state))throw new IllegalArgumentException();
            privateDirectory(path.getParent(),true);RANDOM.nextBytes(key);
            try(FileChannel channel=FileChannel.open(path,Set.of(StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE,LinkOption.NOFOLLOW_LINKS),
                    PosixFilePermissions.asFileAttribute(FILE_MODE))) {
                created=true;writeAll(channel,key);channel.force(true);
            }
            privateFile(path,32);
            forceDirectory(path.getParent());
        }catch(Exception e){
            if(created)try{Files.deleteIfExists(path);}catch(Exception ignored){}
            throw unavailable();
        }finally {Arrays.fill(key,(byte)0);}
    }

    private ObjectNode metadata(byte[] key,byte[] nonce) throws Exception {
        ObjectNode n=Config.JSON.createObjectNode();n.put("version",1);n.put("algorithm",ALGORITHM);n.put("purpose",PURPOSE);
        n.put("nodeId",nodeId);n.put("deviceId",deviceId);n.put("keyId",keyId(key));n.put("nonce",encode(nonce));return n;
    }
    private void checkDirectories() throws Exception {privateDirectory(stateDir,false);privateDirectory(directory,false);}
    private byte[] readKey() throws Exception {
        privateDirectory(keyFile.getParent(),false);byte[] key=readPrivate(keyFile,32);
        if(key.length!=32){Arrays.fill(key,(byte)0);throw new IllegalArgumentException();}return key;
    }
    private void requireCurrentKey(byte[] snapshot) throws Exception {
        byte[] current=readKey();
        try {if(!MessageDigest.isEqual(snapshot,current))throw new IllegalArgumentException();}
        finally {Arrays.fill(current,(byte)0);}
    }
    private static byte[] readPrivate(Path path,int maximum) throws Exception {
        privateFile(path,maximum);
        try(FileChannel channel=FileChannel.open(path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)) {
            ByteBuffer b=ByteBuffer.allocate(maximum+1);
            try {
                while(b.hasRemaining() && channel.read(b)>=0){}
                if(b.position()>maximum)throw new IllegalArgumentException();
                return Arrays.copyOf(b.array(),b.position());
            }finally {Arrays.fill(b.array(),(byte)0);}
        }
    }
    private static void privateFile(Path path,int maximum) throws Exception {
        chain(path);var a=Files.readAttributes(path,PosixFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!a.isRegularFile() || a.size()>maximum || !a.permissions().equals(FILE_MODE) || !a.owner().equals(owner(path))
            || ((Number)Files.getAttribute(path,"unix:nlink",LinkOption.NOFOLLOW_LINKS)).longValue()!=1)throw new IllegalArgumentException();
    }
    private static void privateDirectory(Path path,boolean create) throws Exception {
        chain(path);
        if(create && !Files.exists(path,LinkOption.NOFOLLOW_LINKS)) {
            Files.createDirectory(path,PosixFilePermissions.asFileAttribute(DIRECTORY_MODE));forceDirectory(path.getParent());
        }
        var a=Files.readAttributes(path,PosixFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
        if(!a.isDirectory() || !a.permissions().equals(DIRECTORY_MODE) || !a.owner().equals(owner(path)))throw new IllegalArgumentException();
    }
    private static UserPrincipal owner(Path path) throws Exception {
        return path.getFileSystem().getUserPrincipalLookupService().lookupPrincipalByName(System.getProperty("user.name"));
    }
    private static Path absolute(Path path) {
        if(path==null || !path.isAbsolute() || path.getParent()==null || !path.equals(path.normalize()))throw new IllegalArgumentException();return path;
    }
    private static void chain(Path path) throws Exception {
        absolute(path);Path current=path.getRoot();
        for(Path part:path) {
            current=current.resolve(part);
            if(Files.isSymbolicLink(current))throw new IllegalArgumentException();
            if(Files.exists(current,LinkOption.NOFOLLOW_LINKS) && !current.equals(path)
                && !Files.isDirectory(current,LinkOption.NOFOLLOW_LINKS))throw new IllegalArgumentException();
        }
    }
    private static String keyId(byte[] key) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");digest.update("rdg-vnc-key-id\0".getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(digest.digest(key));
    }
    private static String text(JsonNode n,String field) {if(!n.path(field).isTextual())throw new IllegalArgumentException();return n.path(field).textValue();}
    private static String encode(byte[] b) {return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
    private static byte[] decode(String text) {byte[] b=Base64.getUrlDecoder().decode(text);if(!encode(b).equals(text))throw new IllegalArgumentException();return b;}
    private static void writeAll(FileChannel channel,byte[] bytes) throws Exception {ByteBuffer b=ByteBuffer.wrap(bytes);while(b.hasRemaining())channel.write(b);}
    private static void forceDirectory(Path path) throws Exception {
        if(path.getParent()!=null)chain(path);
        if(!Files.isDirectory(path,LinkOption.NOFOLLOW_LINKS))throw new IllegalArgumentException();
        try(FileChannel channel=FileChannel.open(path,StandardOpenOption.READ,LinkOption.NOFOLLOW_LINKS)){channel.force(true);}
    }
    private static Failure unavailable() {return new Failure(503,"CREDENTIAL_STORE_UNAVAILABLE");}
}

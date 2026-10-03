package com.rdg;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.*;
import java.time.*;
import java.util.*;

/** Fixed metadata schema. No arbitrary text, request bodies, tokens or transport payloads. */
final class Audit implements AutoCloseable {
    private final Connection db;
    private final Clock clock;
    private final String node;
    Audit(Path directory,Clock clock,String node) throws Exception {
        this.clock=clock;this.node=node;
        if(Files.isSymbolicLink(directory))throw new IllegalArgumentException("Invalid state directory");
        Files.createDirectories(directory);
        Files.setPosixFilePermissions(directory,PosixFilePermissions.fromString("rwx------"));
        Path path=directory.resolve("metadata.sqlite");
        if(Files.exists(path,LinkOption.NOFOLLOW_LINKS) && (!Files.isRegularFile(path,LinkOption.NOFOLLOW_LINKS)||Files.isSymbolicLink(path)))throw new IllegalArgumentException("Invalid database path");
        db=DriverManager.getConnection("jdbc:sqlite:"+path);
        Files.setPosixFilePermissions(path,PosixFilePermissions.fromString("rw-------"));
        try(var s=db.createStatement()) {
            s.execute("PRAGMA journal_mode=DELETE");
            s.execute("PRAGMA busy_timeout=3000");
            s.execute("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
            s.execute("CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, at TEXT NOT NULL, user_ref TEXT NOT NULL, node TEXT NOT NULL, event TEXT NOT NULL, reason TEXT NOT NULL, build TEXT NOT NULL)");
        }
        try(var insert=db.prepareStatement("INSERT OR IGNORE INTO metadata VALUES('node_id',?)")) {insert.setString(1,node);insert.executeUpdate();}
        try(var statement=db.createStatement();var result=statement.executeQuery("SELECT value FROM metadata WHERE key='node_id'")) {
            if(!result.next()||!node.equals(result.getString(1))){db.close();throw new IllegalArgumentException("Database belongs to a different node");}
        }
        purge();
    }
    synchronized String record(String userRef,String event,String reason) {
        if(!userRef.matches("[a-f0-9]{24}|anonymous") || !Set.of("BOOTSTRAP","CONNECT","END","DENY","UPDATE").contains(event)
            || !reason.matches("[A-Z_]{2,64}"))throw new IllegalArgumentException("Invalid audit metadata");
        String id=UUID.randomUUID().toString();
        try(var s=db.prepareStatement("INSERT INTO audit VALUES(?,?,?,?,?,?,?)")) {
            s.setString(1,id);s.setString(2,clock.instant().toString());s.setString(3,userRef);s.setString(4,node);s.setString(5,event);s.setString(6,reason);s.setString(7,"1.0.0");s.executeUpdate();
            purge();return id;
        }catch(SQLException e){throw new Failure(503,"AUDIT_UNAVAILABLE");}
    }
    private void purge() throws SQLException {
        try(var s=db.prepareStatement("DELETE FROM audit WHERE at < ? OR id IN (SELECT id FROM audit ORDER BY at DESC LIMIT -1 OFFSET 10000)")) {
            s.setString(1,clock.instant().minus(Duration.ofDays(30)).toString());s.executeUpdate();
        }
    }
    synchronized List<Map<String,String>> history(String ref) {
        try(var s=db.prepareStatement("SELECT id,at,event,reason,build FROM audit WHERE user_ref=? ORDER BY at DESC LIMIT 50")) {
            s.setString(1,ref);try(var rs=s.executeQuery()) {
                List<Map<String,String>> result=new ArrayList<>();
                while(rs.next())result.add(Map.of("auditId",rs.getString(1),"at",rs.getString(2),"event",rs.getString(3),"reason",rs.getString(4),"build",rs.getString(5)));
                return result;
            }
        }catch(SQLException e){throw new Failure(503,"AUDIT_UNAVAILABLE");}
    }
    public synchronized void close() throws SQLException { db.close(); }
}

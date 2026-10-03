package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import static org.junit.jupiter.api.Assertions.*;

class AuditTest {
    @TempDir Path dir;
    @Test void retentionAndNodeRestoreBinding() throws Exception {
        var time=new Fixtures.Time();String ref="a".repeat(24);
        try(var audit=new Audit(dir,time,"fixture-node")){
            audit.record(ref,"BOOTSTRAP","AUTHORIZED");assertEquals(1,audit.history(ref).size());time.advance(31*86400);
            audit.record(ref,"DENY","AUTH_REQUIRED");assertEquals(1,audit.history(ref).size());
            assertThrows(IllegalArgumentException.class,()->audit.record(ref,"PAYLOAD","USER_TYPED_SECRET"));
        }
        assertThrows(Exception.class,()->new Audit(dir,time,"wrong-node"));
        try(var restored=new Audit(dir,time,"fixture-node")){assertEquals(1,restored.history(ref).size());}
    }
}

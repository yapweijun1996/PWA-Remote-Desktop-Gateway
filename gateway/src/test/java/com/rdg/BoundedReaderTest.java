package com.rdg;
import org.junit.jupiter.api.Test;
import java.io.*;
import static org.junit.jupiter.api.Assertions.*;
class BoundedReaderTest {
    @Test void instructionBudgetRejectsOverflowAndResetsOnlyAfterConsumption() throws Exception {
        var reader=new BoundedReader(new StringReader("x".repeat(201)),100);char[] chars=new char[100];assertEquals(100,reader.read(chars,0,100));assertThrows(IOException.class,()->reader.read(chars,0,1));
        var next=new BoundedReader(new StringReader("x".repeat(200)),100);assertEquals(100,next.read(chars,0,100));next.instructionConsumed();assertEquals(100,next.read(chars,0,100));
    }
}

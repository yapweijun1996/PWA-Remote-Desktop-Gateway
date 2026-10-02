package com.rdg;

import java.io.*;

/** Bounds one upstream instruction while leaving display traffic far above client input limits. */
final class BoundedReader extends FilterReader {
    private final int limit;
    private int used;
    BoundedReader(Reader reader,int limit){super(reader);this.limit=limit;}
    @Override public int read(char[] chars,int offset,int length) throws IOException {
        int count=super.read(chars,offset,Math.min(length,limit-used+1));
        if(count>0){used+=count;if(used>limit)throw new IOException("UPSTREAM_INSTRUCTION_TOO_LARGE");}
        return count;
    }
    @Override public int read() throws IOException {char[] chars=new char[1];return read(chars,0,1)==-1?-1:chars[0];}
    void instructionConsumed(){used=0;}
}

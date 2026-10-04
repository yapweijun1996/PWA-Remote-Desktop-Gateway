package com.rdg;

import org.apache.guacamole.io.*;
import org.apache.guacamole.protocol.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Official-protocol disposable guacd peer; no Mac or VNC compatibility claim. */
final class GuacdFixture implements AutoCloseable {
    final ServerSocket server=new ServerSocket(0,4,InetAddress.getLoopbackAddress());
    final ExecutorService workers=Executors.newCachedThreadPool();
    final List<Socket> sockets=new CopyOnWriteArrayList<>();
    final AtomicInteger connections=new AtomicInteger(),closed=new AtomicInteger(),keys=new AtomicInteger();
    volatile Map<String,String> parameters=Map.of();
    volatile boolean terminalError;
    GuacdFixture() throws Exception {workers.submit(()->{while(!server.isClosed())try{Socket socket=server.accept();sockets.add(socket);connections.incrementAndGet();workers.submit(()->serve(socket));}catch(IOException ignored){}});}
    void serve(Socket socket) {
        try(socket){
            var reader=new ReaderGuacamoleReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
            var writer=new WriterGuacamoleWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.UTF_8));
            if(!reader.readInstruction().getOpcode().equals("select"))throw new Exception();
            String[] names={"hostname","port","password","read-only","disable-copy","disable-paste","color-depth","compress-level","quality-level","force-lossless","encodings"};writer.writeInstruction(new GuacamoleInstruction("args",names));
            GuacamoleInstruction i;while(!(i=reader.readInstruction()).getOpcode().equals("connect")){}
            Map<String,String> map=new HashMap<>();for(int n=0;n<names.length;n++)map.put(names[n],i.getArgs().get(n));parameters=Map.copyOf(map);
            writer.writeInstruction(new GuacamoleInstruction("ready","fixture-upstream"));
            if(terminalError){writer.writeInstruction(new GuacamoleInstruction("error","Disposable target unavailable","512"));writer.writeInstruction(new GuacamoleInstruction("disconnect"));}
            else{writer.writeInstruction(new GuacamoleInstruction("size","0","640","480"));writer.writeInstruction(new GuacamoleInstruction("sync","0"));}
            workers.submit(()->{while(!socket.isClosed())try{Thread.sleep(1000);writer.writeInstruction(new GuacamoleInstruction("sync",Long.toString(System.currentTimeMillis())));}catch(Exception e){break;}});
            while((i=reader.readInstruction())!=null){if(i.getOpcode().equals("key"))keys.incrementAndGet();}
        }catch(Exception ignored){}finally{closed.incrementAndGet();}
    }
    public void close() throws Exception {server.close();for(Socket s:sockets)s.close();workers.shutdownNow();}
}

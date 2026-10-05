package com.rdg;

import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.websocket.server.WsSci;
import javax.servlet.ServletException;
import javax.websocket.*;
import javax.websocket.server.ServerContainer;
import javax.websocket.server.ServerEndpointConfig;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Disposable stand-in for the host agent that speaks docs/19 over a loopback WebSocket. It proves the gateway relay against the
 * protocol, not the Mac: no capture, no encoder, no real input. Never a claim about the real agent.
 */
final class AgentFixture implements AutoCloseable {
    enum Mode {NORMAL, CLOSE_AFTER_HELLO, ERROR_AFTER_HELLO, OVERSIZED_STATUS, BAD_VIDEO, BLAST, VIDEO}
    final Tomcat tomcat=new Tomcat();
    final int port;
    final String token;
    final List<String> received=new CopyOnWriteArrayList<>();
    final List<String> hellos=new CopyOnWriteArrayList<>();
    final AtomicInteger connections=new AtomicInteger(),closed=new AtomicInteger();
    final AtomicLong framesSent=new AtomicLong();
    volatile Mode mode=Mode.NORMAL;
    volatile String errorCode="SCREEN_RECORDING_NOT_PERMITTED";
    volatile String readyOverride;
    volatile int blastBytes=512*1024;
    /** Mirror of everything the gateway forwarded after `hello`, one message per line, for a browser test to read back. */
    volatile Path receivedLog;

    AgentFixture(Path dir,String token) throws Exception {
        this.token=token;
        Files.createDirectories(dir);
        tomcat.setBaseDir(dir.resolve("agent-runtime").toString());tomcat.setPort(0);tomcat.getConnector().setProperty("address","127.0.0.1");
        Context context=tomcat.addContext("",dir.toAbsolutePath().toString());
        // The WebSocket filter only runs for a request that reaches a servlet, so map an inert one for every path.
        Tomcat.addServlet(context,"inert",new javax.servlet.http.HttpServlet(){});context.addServletMappingDecoded("/","inert");
        context.addServletContainerInitializer(new WsSci(),null);
        context.addServletContainerInitializer((classes,servlet)-> {
            ServerContainer container=(ServerContainer)servlet.getAttribute("javax.websocket.server.ServerContainer");
            container.setDefaultMaxTextMessageBufferSize(64*1024);
            try {
                container.addEndpoint(ServerEndpointConfig.Builder.create(Peer.class,"/").configurator(new ServerEndpointConfig.Configurator() {
                    @Override public <T> T getEndpointInstance(Class<T> clazz){return clazz.cast(new Peer());}
                }).build());
            }catch(DeploymentException e){throw new ServletException(e);}
        },null);
        tomcat.start();port=tomcat.getConnector().getLocalPort();
    }

    static byte[] frame(boolean key,long sequence,int payload) {
        ByteBuffer b=ByteBuffer.allocate(14+payload);b.put((byte)1).put((byte)(key?1:0)).putDouble((double)System.currentTimeMillis()).putInt((int)sequence);
        return b.array();
    }
    static String ready(boolean control,boolean clipboard) {return ready(control,clipboard,1280,720);}
    static String ready(boolean control,boolean clipboard,int width,int height) {
        return "{\"t\":\"ready\",\"v\":1,\"width\":"+width+",\"height\":"+height+",\"control\":"+control+",\"controlReason\":\""+(control?"GRANTED":"VIEW_ONLY")+"\",\"clipboard\":"+clipboard+",\"encoder\":\"hw\"}";
    }
    static final String CONFIG="{\"t\":\"config\",\"codec\":\"avc1.4D0028\",\"avcc\":\"AU1EKP/hABRnTQAo2oBQAW5AtQYGhoAAAAMAgA==\",\"width\":1280,\"height\":720}";

    /** Sends a message to the connected gateway; used by tests to push agent → browser traffic after the handshake. */
    volatile Session current;
    void push(String text) throws IOException {synchronized(this){current.getBasicRemote().sendText(text);}}

    public final class Peer extends Endpoint {
        private Session session;
        private boolean authenticated;
        @Override public void onOpen(Session s,EndpointConfig config) {
            session=s;connections.incrementAndGet();
            s.addMessageHandler(String.class,this::onText);
        }
        private synchronized void onText(String text) {
            try {
                if(!authenticated) {
                    var hello=Config.JSON.readTree(text);hellos.add(text);
                    // Same as the real agent: a wrong token or a non-hello first message is closed with no data at all.
                    if(!"hello".equals(hello.path("t").asText())||hello.path("v").asInt()!=1||!token.equals(hello.path("token").asText())){session.close();return;}
                    authenticated=true;current=session;
                    if(mode==Mode.CLOSE_AFTER_HELLO){session.close();return;}
                    if(mode==Mode.ERROR_AFTER_HELLO){session.getBasicRemote().sendText("{\"t\":\"error\",\"code\":\""+errorCode+"\"}");session.close();return;}
                    boolean control=hello.path("control").asBoolean(),clipboard=hello.path("clipboard").asBoolean();
                    if(mode==Mode.VIDEO) {
                        var clip=Config.JSON.readTree(AgentFixture.class.getResourceAsStream("/agent-test-video.json"));
                        session.getBasicRemote().sendText(ready(control,clipboard,640,360));
                        session.getBasicRemote().sendText("{\"t\":\"config\",\"codec\":\""+clip.path("codec").asText()+"\",\"avcc\":\""+clip.path("avcc").asText()+"\",\"width\":640,\"height\":360}");
                        new Thread(this::playVideo,"agent-fixture-video").start();
                        return;
                    }
                    session.getBasicRemote().sendText(readyOverride!=null?readyOverride:ready(control,clipboard));
                    session.getBasicRemote().sendText(CONFIG);
                    session.getBasicRemote().sendBinary(ByteBuffer.wrap(frame(true,0,64)));framesSent.incrementAndGet();
                    switch(mode) {
                        case OVERSIZED_STATUS -> session.getBasicRemote().sendText("{\"t\":\"status\",\"secureInput\":false,\"sent\":1,\"dropped\":0,\"bytes\":"+"9".repeat(70*1024)+"}");
                        case BAD_VIDEO -> session.getBasicRemote().sendBinary(ByteBuffer.wrap(new byte[]{2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,9}));
                        case BLAST -> new Thread(this::blast,"agent-fixture-blast").start();
                        default -> {}
                    }
                    return;
                }
                received.add(text);
                if(receivedLog!=null)Files.writeString(receivedLog,text+"\n",java.nio.file.StandardOpenOption.CREATE,java.nio.file.StandardOpenOption.APPEND);
                if(text.contains("\"t\":\"clip\""))session.getBasicRemote().sendText("{\"t\":\"clip-result\",\"ok\":true}");
                if(text.contains("\"t\":\"kf\"")&&mode==Mode.VIDEO){restart=true;return;}
                if(text.contains("\"t\":\"kf\""))session.getBasicRemote().sendBinary(ByteBuffer.wrap(frame(true,framesSent.incrementAndGet(),64)));
            }catch(Exception e){try{session.close();}catch(Exception ignored){}}
        }
        volatile boolean restart;
        /** Plays the synthetic clip (qa/make-agent-test-video.mjs) in a loop: config, a keyframe, then deltas, with a status each second. */
        private void playVideo() {
            try {
                var clip=Config.JSON.readTree(AgentFixture.class.getResourceAsStream("/agent-test-video.json"));
                var frames=clip.path("frames");long sequence=0;int fps=clip.path("fps").asInt(15);long statusAt=System.nanoTime();
                while(session.isOpen()) {
                    for(int i=0;i<frames.size()&&session.isOpen();i++) {
                        if(restart){restart=false;break;}
                        var frame=frames.get(i);byte[] data=java.util.Base64.getDecoder().decode(frame.path("data").asText());
                        ByteBuffer b=ByteBuffer.allocate(14+data.length);b.put((byte)1).put((byte)(frame.path("key").asBoolean()?1:0)).putDouble((double)System.currentTimeMillis()).putInt((int)sequence++).put(data);
                        synchronized(Peer.this){session.getBasicRemote().sendBinary(ByteBuffer.wrap(b.array()));framesSent.incrementAndGet();
                            if(System.nanoTime()-statusAt>1_000_000_000L){statusAt=System.nanoTime();session.getBasicRemote().sendText("{\"t\":\"status\",\"secureInput\":false,\"sent\":"+framesSent.get()+",\"dropped\":0,\"bytes\":1}");}}
                        Thread.sleep(1000/fps);
                    }
                }
            }catch(Exception ignored){}
        }
        /** Blocking sends: when the gateway stops requesting, TCP fills and these calls stall, which is the observable back-pressure. */
        private void blast() {
            try{while(session.isOpen()){session.getBasicRemote().sendBinary(ByteBuffer.wrap(frame(false,framesSent.get(),blastBytes)));framesSent.incrementAndGet();}}
            catch(Exception ignored){}
        }
        @Override public void onClose(Session s,CloseReason reason){closed.incrementAndGet();}
        @Override public void onError(Session s,Throwable t){}
    }

    @Override public void close() throws Exception {tomcat.stop();tomcat.destroy();}
}

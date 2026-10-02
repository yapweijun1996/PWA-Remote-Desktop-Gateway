package com.rdg;

import javax.websocket.*;
import org.apache.guacamole.net.GuacamoleTunnel;
import org.apache.guacamole.protocol.*;
import java.io.IOException;

/** javax WebSocket adapter over official Guacamole transport/parser, with bounded lifetime. */
public final class DesktopEndpoint extends Endpoint {
    private final Sessions sessions;
    private final GuacdConnector connector;
    private Sessions.Desktop desktop;
    private InputPolicy policy;
    private GuacamoleTunnel tunnel;
    private Session browser;
    private long windowStart=System.nanoTime();
    private int messages;
    DesktopEndpoint(Sessions sessions,GuacdConnector connector){this.sessions=sessions;this.connector=connector;}
    @Override public void onOpen(Session ws,EndpointConfig endpoint) {
        browser=ws;
        try {
            ws.setMaxTextMessageBufferSize(49152);
            ws.getUserProperties().put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT",5000L);
            desktop=sessions.upgrade(ws.getPathParameters().get("intentId"));policy=new InputPolicy(desktop);
            desktop.checkActive();tunnel=connector.open(desktop);
            try{desktop.checkActive();desktop.attach(tunnel,ws);}catch(Exception e){tunnel.close();throw e;}
            sessions.audit.record(desktop.app.ref,"CONNECT","AUTHORIZED");
            ws.addMessageHandler(String.class,this::onMessage);
            // At most two readers exist: the session store reserves capacity before upgrading.
            Thread pump=new Thread(this::read,"rdg-display");pump.setDaemon(true);pump.start();
        }catch(Exception e){finish("TARGET_UNAVAILABLE");}
    }
    private void read() {
        var reader=tunnel.acquireReader();
        try {
            send(new GuacamoleInstruction("",tunnel.getUUID().toString()).toString());
            StringBuilder buffer=new StringBuilder(8192);char[] next;
            while(!desktop.ended.get() && (next=reader.read())!=null) {
                buffer.append(next);
                if(!reader.available() || buffer.length()>=8192){send(buffer.toString());buffer.setLength(0);}
            }
        }catch(Exception e){/* Close races and upstream errors share a bounded, payload-free reason. */}
        finally{tunnel.releaseReader();finish("DISCONNECTED");}
    }
    private synchronized void send(String instruction) throws IOException {
        if(!browser.isOpen() || desktop.ended.get())throw new IOException("TRANSPORT_CLOSED");
        try{browser.getBasicRemote().sendText(instruction);}catch(IllegalStateException e){throw new IOException("TRANSPORT_CLOSED");}
    }
    public synchronized void onMessage(String message) {
        if(desktop==null || desktop.ended.get())return;
        try {
            long now=System.nanoTime();if(now-windowStart>=1_000_000_000L){windowStart=now;messages=0;}
            if(++messages>1000 || message.length()>49152 || message.isEmpty())throw new Failure(429,"RATE_LIMITED");
            GuacamoleParser parser=new GuacamoleParser();char[] chars=message.toCharArray();int offset=0,count=0;
            var instructions=new java.util.ArrayList<GuacamoleInstruction>();
            while(offset<chars.length) {
                int read=parser.append(chars,offset,chars.length-offset);offset+=read;
                if(parser.hasNext()) {
                    if(++count>256)throw new Failure(429,"RATE_LIMITED");var i=parser.next();policy.validate(i);instructions.add(i);
                }else if(read==0 || offset==chars.length)throw new Failure(400,"INVALID_PROTOCOL");
            }
            var writer=tunnel.acquireWriter();
            try{for(var i:instructions) {
                if(i.getOpcode().isEmpty())send(i.toString());
                else writer.writeInstruction(i);
            }}finally{tunnel.releaseWriter();}
        }catch(Exception e){finish(e instanceof Failure f?f.code:"INVALID_PROTOCOL");}
    }
    private void finish(String reason) {
        if(desktop!=null)desktop.end(reason);
        else if(browser!=null)try{browser.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY,reason));}catch(Exception ignored){}
    }
    @Override public void onClose(Session ws,CloseReason reason){finish("DISCONNECTED");}
    @Override public void onError(Session ws,Throwable error){finish("TRANSPORT_ERROR");}
}

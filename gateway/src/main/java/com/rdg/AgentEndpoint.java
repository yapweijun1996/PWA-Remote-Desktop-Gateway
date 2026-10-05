package com.rdg;

import javax.websocket.*;

/** javax WebSocket adapter for the host agent backend: validates every browser message and relays it (docs/19). */
public final class AgentEndpoint extends Endpoint {
    private final Sessions sessions;
    private final Config config;
    private Sessions.Desktop desktop;
    private AgentPolicy policy;
    private AgentRelay relay;
    private Session browser;
    AgentEndpoint(Sessions sessions,Config config){this.sessions=sessions;this.config=config;}
    @Override public void onOpen(Session ws,EndpointConfig endpoint) {
        browser=ws;
        try {
            ws.setMaxTextMessageBufferSize(AgentPolicy.RAW_MAX+1024);
            ws.getUserProperties().put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT",5000L);
            var caller=ws.getUserPrincipal();
            desktop=sessions.upgrade(ws.getPathParameters().get("intentId"),caller==null?null:caller.getName());
            policy=new AgentPolicy(desktop);
            // The session owns the browser and the relay even if the agent never answers, so the 10 s connecting deadline applies.
            desktop.attachBrowser(ws);desktop.checkActive();
            relay=new AgentRelay(config,desktop,ws,policy);desktop.pending(relay);
            String ready=relay.connect();
            desktop.checkActive();
            desktop.attachUpstream(relay);
            ws.addMessageHandler(String.class,this::onMessage);   // before `ready`: the browser may answer immediately
            relay.sendBrowserText(ready);
            sessions.audit.record(desktop.app.ref,"CONNECT","AUTHORIZED");
            relay.start(desktop.displayQuality);
        }catch(Failure f){fail(f.code);}
        catch(Exception e){fail("TARGET_UNAVAILABLE");}
    }
    public void onMessage(String message) {
        if(desktop==null||desktop.ended.get())return;
        try{relay.sendUpstream(policy.toAgent(message));}
        catch(Failure f){fail(f.code);}
        catch(Exception e){fail("INVALID_PROTOCOL");}
    }
    /** The browser is told a fixed code (the UI maps each to fixed text), then the desktop ends and both sockets close. */
    private void fail(String code) {
        if(relay!=null)relay.fail(code);   // same lock as the video pump, so a stalled frame never interleaves with this text
        else finish(code);
    }
    private void finish(String reason) {
        if(desktop!=null)desktop.end(reason);
        if(browser!=null&&browser.isOpen())try{browser.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY,reason));}catch(Exception ignored){}
    }
    @Override public void onClose(Session ws,CloseReason reason){finish("DISCONNECTED");}
    @Override public void onError(Session ws,Throwable error){finish("TRANSPORT_ERROR");}
}

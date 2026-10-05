package com.rdg;

import com.fasterxml.jackson.databind.JsonNode;
import javax.websocket.Session;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

/**
 * One validated relay between a browser WebSocket and the host agent (docs/19). Flow control is strict: after the handshake
 * the next agent message is requested only once the previous one has been written to the browser, so a slow browser
 * pushes back on the agent (which drops frames until the next keyframe) and the gateway never queues video.
 */
final class AgentRelay implements WebSocket.Listener, AutoCloseable {
    private static final HttpClient HTTP=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
    private static final int MAX_PENDING_UPSTREAM=256;

    private final Config config;
    private final Sessions.Desktop desktop;
    private final Session browser;
    private final AgentPolicy policy;
    private final CompletableFuture<String> ready=new CompletableFuture<>();
    private final Object browserLock=new Object(), upstreamLock=new Object();
    private final StringBuilder textBuffer=new StringBuilder();
    private final List<ByteBuffer> binaryParts=new ArrayList<>();
    private int binaryBytes;
    private volatile WebSocket upstream;
    private volatile boolean closed, started;
    private CompletableFuture<?> sendChain=CompletableFuture.completedFuture(null);
    private int pendingUpstream;

    AgentRelay(Config config,Sessions.Desktop desktop,Session browser,AgentPolicy policy) {
        this.config=config;this.desktop=desktop;this.browser=browser;this.policy=policy;
    }

    /**
     * Connects, authenticates with the server-held token and waits for the agent's validated {@code ready}. Returns the
     * message to hand to the browser; throws a Failure carrying a fixed code otherwise. The agent's own error is returned
     * as a Failure whose code is the agent's fixed code.
     */
    String connect() {
        var agent=config.agent();
        String token=agent.token();
        try {
            upstream=HTTP.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(3))
                .buildAsync(URI.create("ws://"+agent.host()+":"+agent.port()+"/"),this).get(4,TimeUnit.SECONDS);
        }catch(Exception e){throw new Failure(502,"AGENT_UNAVAILABLE");}
        try {
            upstream.sendText(AgentPolicy.hello(token,desktop.mode.equals("control"),desktop.clipboard),true).get(2,TimeUnit.SECONDS);
            String first=ready.get(5,TimeUnit.SECONDS);
            JsonNode message=Config.JSON.readTree(first);
            String type=message.path("t").asText("");
            if(type.equals("error"))throw new Failure(502,message.path("code").asText("AGENT_PROTOCOL"));
            if(!type.equals("ready"))throw new Failure(502,"AGENT_PROTOCOL");
            return first;
        }catch(Failure f){throw f;}
        catch(ExecutionException e){throw e.getCause() instanceof Failure f?f:new Failure(502,"AGENT_AUTH_FAILED");}
        catch(Exception e){throw new Failure(502,"AGENT_AUTH_FAILED");}
    }

    /** After the browser has the {@code ready} message: apply the server-owned initial bitrate and open the flow. */
    void start(DisplayQuality quality) {
        started=true;
        var rate=Config.JSON.createObjectNode();rate.put("t","rate");rate.put("kbps",AgentPolicy.initialKbps(quality));
        sendUpstream(rate.toString());
        upstream.request(1);
    }

    /** Browser → agent. The text has already been validated and re-serialised by {@link AgentPolicy#toAgent}. */
    void sendUpstream(String json) {
        synchronized(upstreamLock) {
            if(closed)return;
            if(pendingUpstream>=MAX_PENDING_UPSTREAM)throw new Failure(429,"RATE_LIMITED");
            pendingUpstream++;
            sendChain=sendChain.thenCompose(ignored->upstream.sendText(json,true)).whenComplete((socket,error)->{
                synchronized(upstreamLock){pendingUpstream--;}
                if(error!=null)finish("TRANSPORT_FAILED");
            });
        }
    }

    // ---- agent → browser -------------------------------------------------------------------------------------------

    @Override public void onOpen(WebSocket socket) {socket.request(1);}

    @Override public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last) {
        textBuffer.append(data);
        if(textBuffer.length()>AgentPolicy.MAX_TEXT){protocolViolation();return null;}
        if(!last){socket.request(1);return null;}
        String message=textBuffer.toString();textBuffer.setLength(0);
        try {
            String out=policy.fromAgent(message);
            if(!started) {
                // Handshake phase: hold the flow (no demand) until the endpoint has delivered `ready` and called start().
                ready.complete(out==null?"{\"t\":\"error\",\"code\":\"AGENT_PROTOCOL\"}":out);
                return null;
            }
            if(out!=null)sendBrowserText(out);
        }catch(Failure f){
            // Before `ready` the endpoint owns the outcome (it tells the browser the code); after it the relay does.
            if(!started)ready.completeExceptionally(f);else fail(f.code);
            return null;
        }catch(IOException e){finish("TRANSPORT_FAILED");return null;}
        if(!closed)socket.request(1);
        return null;
    }

    @Override public CompletionStage<?> onBinary(WebSocket socket,ByteBuffer data,boolean last) {
        if(!started){protocolViolation();return null;}
        ByteBuffer copy=ByteBuffer.allocate(data.remaining());copy.put(data);copy.flip();
        binaryBytes+=copy.remaining();binaryParts.add(copy);
        if(binaryBytes>AgentPolicy.MAX_VIDEO+AgentPolicy.VIDEO_HEADER){protocolViolation();return null;}
        if(!last){socket.request(1);return null;}
        ByteBuffer frame=ByteBuffer.allocate(binaryBytes);for(ByteBuffer part:binaryParts)frame.put(part);frame.flip();
        binaryParts.clear();binaryBytes=0;
        try {
            AgentPolicy.checkVideo(frame);
            sendBrowserBinary(frame);
        }catch(Failure f){fail(f.code);return null;}
        catch(IOException e){finish("TRANSPORT_FAILED");return null;}
        if(!closed)socket.request(1);
        return null;
    }

    @Override public CompletionStage<?> onClose(WebSocket socket,int status,String reason) {
        if(!started){ready.completeExceptionally(new Failure(502,"AGENT_AUTH_FAILED"));return null;}   // the agent says nothing to a peer it refuses
        finish("DISCONNECTED");return null;
    }

    @Override public void onError(WebSocket socket,Throwable error) {
        if(!started){ready.completeExceptionally(new Failure(502,"AGENT_UNAVAILABLE"));return;}
        finish("TRANSPORT_FAILED");
    }

    private void protocolViolation() {if(!started)ready.completeExceptionally(new Failure(502,"AGENT_PROTOCOL"));else fail("AGENT_PROTOCOL");}

    /** Tells the browser a fixed code, then ends the desktop (which closes both sockets). */
    void fail(String code) {
        try{sendBrowserText("{\"t\":\"error\",\"code\":\""+code+"\"}");}catch(Exception ignored){}
        finish(code);
    }

    void sendBrowserText(String text) throws IOException {
        synchronized(browserLock) {
            if(!browser.isOpen()||desktop.ended.get())throw new IOException("TRANSPORT_CLOSED");
            try{browser.getBasicRemote().sendText(text);}catch(IllegalStateException e){throw new IOException("TRANSPORT_CLOSED");}
        }
    }

    private void sendBrowserBinary(ByteBuffer frame) throws IOException {
        synchronized(browserLock) {
            if(!browser.isOpen()||desktop.ended.get())throw new IOException("TRANSPORT_CLOSED");
            try{browser.getBasicRemote().sendBinary(frame);}catch(IllegalStateException e){throw new IOException("TRANSPORT_CLOSED");}
        }
    }

    private void finish(String reason) {
        if(closed)return;
        desktop.end(reason);   // closes this relay and the browser socket through Sessions
    }

    @Override public void close() {
        if(closed)return;
        closed=true;
        WebSocket socket=upstream;
        if(socket==null)return;
        // The agent releases every held key and button when the connection ends; abort only if the close handshake stalls.
        try{socket.sendClose(WebSocket.NORMAL_CLOSURE,"").orTimeout(1,TimeUnit.SECONDS).whenComplete((ignored,error)->socket.abort());}
        catch(Exception e){socket.abort();}
    }
}

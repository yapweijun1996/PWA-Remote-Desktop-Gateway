package com.rdg;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Validation for the host agent relay (docs/19). The gateway never forwards raw bytes: every browser message is parsed,
 * checked against the allowlist, range-checked, size-capped and re-serialised from known fields only, and every agent
 * message is checked before it reaches the browser. Nothing typed, copied or captured is logged.
 */
final class AgentPolicy {
    static final String PROTOCOL="rdg-agent.v1";
    static final int MAX_TEXT=64*1024, MAX_VIDEO=4*1024*1024, VIDEO_HEADER=14, SMALL=256, CLIP=16*1024, TYPE=4096, RAW_MAX=40*1024;
    static final Set<String> AGENT_ERRORS=Set.of("PROTOCOL_UNSUPPORTED","SCREEN_RECORDING_NOT_PERMITTED","NO_DISPLAY","CAPTURE_FAILED","ENCODER_UNAVAILABLE");
    static final Set<String> CONTROL_REASONS=Set.of("GRANTED","VIEW_ONLY","ACCESSIBILITY_NOT_PERMITTED");
    static final Set<String> ENCODERS=Set.of("ll","hw","sw");

    private final Sessions.Desktop desktop;
    private long windowStart, scrollWindowStart;
    private int messages, scrolls;

    AgentPolicy(Sessions.Desktop desktop) {this.desktop=desktop;windowStart=scrollWindowStart=System.nanoTime();}

    /** Gateway-built opening message: capabilities come from the server-side intent, never from the browser. */
    static String hello(String token,boolean control,boolean clipboard) {
        var node=Config.JSON.createObjectNode();node.put("t","hello");node.put("v",1);node.put("token",token);node.put("control",control);node.put("clipboard",clipboard);
        return node.toString();
    }

    /** Browser → agent. Returns the message to forward, or throws a Failure that ends the session. */
    synchronized String toAgent(String text) {
        long now=System.nanoTime();
        if(now-windowStart>=1_000_000_000L){windowStart=now;messages=0;}
        if(++messages>1000)throw new Failure(429,"RATE_LIMITED");
        if(text==null||text.isEmpty()||text.length()>RAW_MAX)throw new Failure(400,"INVALID_PROTOCOL");
        desktop.checkActive();
        JsonNode message=parse(text);
        String type=message.path("t").asText("");
        var out=Config.JSON.createObjectNode();out.put("t",type);
        switch(type) {
            case "k" -> {exact(message,"t","s","d");control();out.put("s",intIn(message,"s",1,0x1fffffff));out.put("d",bool(message,"d"));desktop.activity();}
            case "m" -> {exact(message,"t","x","y","b");control();out.put("x",intIn(message,"x",0,32767));out.put("y",intIn(message,"y",0,32767));out.put("b",intIn(message,"b",0,31));desktop.activity();}
            case "w" -> {
                exact(message,"t","x","y","dy");control();
                int dy=intIn(message,"dy",-4000,4000);if(dy==0)throw new Failure(403,"INPUT_DENIED");
                if(now-scrollWindowStart>=1_000_000_000L){scrollWindowStart=now;scrolls=0;}
                if(++scrolls>120)throw new Failure(429,"RATE_LIMITED");
                out.put("x",intIn(message,"x",0,32767));out.put("y",intIn(message,"y",0,32767));out.put("dy",dy);desktop.activity();
            }
            case "clip" -> {
                exact(message,"t","text");control();if(!desktop.clipboard)throw new Failure(403,"INPUT_DENIED");
                out.put("text",text(message,"text",CLIP));desktop.activity();
            }
            case "type" -> {exact(message,"t","text");control();out.put("text",text(message,"text",TYPE));desktop.activity();}
            case "release","kf" -> exact(message,"t");
            case "rate" -> {exact(message,"t","kbps");out.put("kbps",intIn(message,"kbps",500,12000));}
            default -> throw new Failure(403,"INPUT_DENIED");
        }
        if(text.length()>SMALL&&!type.equals("clip")&&!type.equals("type"))throw new Failure(400,"INVALID_PROTOCOL");
        return out.toString();
    }

    /** Agent → browser text. Returns the validated message to forward, or null to drop it silently. */
    String fromAgent(String text) {
        if(text==null||text.length()>MAX_TEXT)throw new Failure(502,"AGENT_PROTOCOL");
        JsonNode message;
        try{message=parse(text);}catch(Failure e){throw new Failure(502,"AGENT_PROTOCOL");}
        String type=message.path("t").asText("");
        var out=Config.JSON.createObjectNode();out.put("t",type);
        try {
            switch(type) {
                case "ready" -> {
                    if(message.path("v").asInt(-1)!=1)throw bad();
                    out.put("v",1);out.put("width",intIn(message,"width",1,16384));out.put("height",intIn(message,"height",1,16384));
                    boolean control=bool(message,"control"),clipboard=bool(message,"clipboard");
                    if(control&&!desktop.mode.equals("control"))throw bad();       // never more authority than the intent granted
                    if(clipboard&&!desktop.clipboard)throw bad();
                    out.put("control",control);out.put("clipboard",clipboard);
                    out.put("controlReason",oneOf(message,"controlReason",CONTROL_REASONS));out.put("encoder",oneOf(message,"encoder",ENCODERS));
                }
                case "config" -> {
                    String codec=message.path("codec").asText("");if(!codec.matches("avc1\\.[0-9A-F]{6}"))throw bad();
                    String avcc=message.path("avcc").asText("");if(avcc.isEmpty()||avcc.length()>4096||!avcc.matches("[A-Za-z0-9+/]+={0,2}"))throw bad();
                    out.put("codec",codec);out.put("avcc",avcc);out.put("width",intIn(message,"width",1,16384));out.put("height",intIn(message,"height",1,16384));
                }
                case "status" -> {out.put("secureInput",bool(message,"secureInput"));for(String k:List.of("sent","dropped","bytes"))out.put(k,longIn(message,k));}
                case "clip" -> {
                    if(!desktop.clipboard||!desktop.mode.equals("control"))return null;   // without consent the Mac's clipboard never reaches the browser
                    out.put("text",text(message,"text",CLIP));
                }
                case "clip-result" -> out.put("ok",bool(message,"ok"));
                case "error" -> {String code=message.path("code").asText("");out.put("code",AGENT_ERRORS.contains(code)?code:"AGENT_PROTOCOL");}
                default -> throw bad();
            }
        }catch(Failure e){throw new Failure(502,"AGENT_PROTOCOL");}
        return out.toString();
    }

    /** Agent → browser video: a header check and a size bound; the access unit itself is opaque to the gateway. */
    static void checkVideo(ByteBuffer frame) {
        int size=frame.remaining();
        if(size<=VIDEO_HEADER||size>MAX_VIDEO+VIDEO_HEADER)throw new Failure(502,"AGENT_PROTOCOL");
        int version=frame.get(frame.position())&0xff,key=frame.get(frame.position()+1)&0xff;
        if(version!=1||key>1)throw new Failure(502,"AGENT_PROTOCOL");
    }

    /** Initial bitrate for a Picture mode, server-owned (the browser may adjust within the protocol range). */
    static int initialKbps(DisplayQuality quality) {
        return switch(quality){case LOW->1500;case BALANCED->4000;case CLEAR->8000;};
    }

    private void control() {if(!desktop.mode.equals("control"))throw new Failure(403,"READ_ONLY");}
    private static Failure bad() {return new Failure(400,"INVALID_PROTOCOL");}
    private static JsonNode parse(String text) {
        try{JsonNode n=Config.JSON.readTree(text);if(n==null||!n.isObject())throw bad();return n;}
        catch(com.fasterxml.jackson.core.JsonProcessingException e){throw bad();}
    }
    private static void exact(JsonNode n,String... allowed) {
        Set<String> names=new HashSet<>(Arrays.asList(allowed));int count=0;
        for(Iterator<String> it=n.fieldNames();it.hasNext();count++)if(!names.contains(it.next()))throw bad();
        if(count!=names.size())throw bad();
    }
    private static int intIn(JsonNode n,String field,int min,int max) {
        JsonNode v=n.path(field);if(!v.isIntegralNumber()||!v.canConvertToInt())throw bad();
        int value=v.intValue();if(value<min||value>max)throw bad();return value;
    }
    private static long longIn(JsonNode n,String field) {
        JsonNode v=n.path(field);if(!v.isIntegralNumber()||!v.canConvertToLong()||v.longValue()<0)throw bad();return v.longValue();
    }
    private static boolean bool(JsonNode n,String field) {JsonNode v=n.path(field);if(!v.isBoolean())throw bad();return v.booleanValue();}
    private static String oneOf(JsonNode n,String field,Set<String> allowed) {
        JsonNode v=n.path(field);if(!v.isTextual()||!allowed.contains(v.textValue()))throw bad();return v.textValue();
    }
    private static String text(JsonNode n,String field,int maxBytes) {
        JsonNode v=n.path(field);if(!v.isTextual()||v.textValue().isEmpty())throw bad();
        String value=v.textValue();if(value.getBytes(StandardCharsets.UTF_8).length>maxBytes||value.indexOf('\0')>=0)throw bad();return value;
    }
}

package com.rdg;

import javax.servlet.http.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.*;
import java.util.*;

final class ApiServlet extends HttpServlet {
    final Config config;final Sessions sessions;
    final TrustedDeviceStore trusted;
    ApiServlet(Config c,Sessions s){this(c,s,null);}
    ApiServlet(Config c,Sessions s,TrustedDeviceStore t){config=c;sessions=s;trusted=t;}
    @Override protected void service(HttpServletRequest r,HttpServletResponse res) throws IOException {
        try {
            String path=r.getRequestURI(),method=r.getMethod();var app=(Sessions.App)r.getAttribute("app");
            if(method.equals("POST")&&path.equals("/api/session/bootstrap")) {
                Config.fields(body(r),Set.of());
                var pair=sessions.bootstrap((AccessVerifier.Identity)r.getAttribute("identity"),(String)r.getAttribute("appCookie"));
                if(trusted!=null)sessions.bindTrusted(pair.getValue(),(String)r.getAttribute("trustedDeviceId"));
                res.setHeader("Set-Cookie","__Host-rdg="+pair.getKey()+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+Math.max(0,java.time.Duration.between(sessions.clock.instant(),pair.getValue().expires).getSeconds()));
                send(res,200,Map.of("csrfToken",pair.getValue().csrf,"expiresAt",pair.getValue().expires.toString(),"nodeId",config.nodeId()));
            }else if(method.equals("GET")&&path.equals("/api/session"))send(res,200,sessions.status(app));
            else if(method.equals("DELETE")&&path.equals("/api/session")) {
                if(trusted!=null){trusted.revokeToken(TrustedDeviceCookies.read(r,TrustedDeviceCookies.NAME));TrustedDeviceCookies.clear(res);}
                sessions.revoke(app,"LOGOUT");res.addHeader("Set-Cookie","__Host-rdg=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");res.setStatus(204);
            }else if(method.equals("DELETE")&&path.equals("/api/desktop-session")){sessions.endDesktop(app,"USER_ENDED");res.setStatus(204);}
            else if(method.equals("POST")&&path.equals("/api/desktop/credential")) {
                JsonNode b=body(r);Config.fields(b,Set.of("password"));
                if(!b.path("password").isTextual())throw new Failure(400,"INVALID_CREDENTIAL");
                send(res,200,sessions.desktopCredential(app,b.path("password").textValue()));
            }
            else if(method.equals("POST")&&path.equals("/api/connect-intents")) {
                JsonNode b=body(r);Config.fields(b,Set.of("deviceId","mode","keyboardProfile"));
                var i=sessions.intent(app,text(b,"deviceId"),text(b,"mode"),text(b,"keyboardProfile"));
                send(res,201,Map.of("intentId",i.id,"expiresAt",i.publicExpiry.toString()));
            }else if(method.equals("POST")&&path.equals("/api/clipboard-consent")) {
                JsonNode b=body(r);Config.fields(b,Set.of("enabled"));if(!b.path("enabled").isBoolean())throw new Failure(400,"INVALID_REQUEST");
                sessions.clipboard(app,b.path("enabled").booleanValue());send(res,200,Map.of("enabled",app.clipboard));
            }else if(method.equals("POST")&&path.equals("/api/update-boundary")) {
                Config.fields(body(r),Set.of());send(res,200,sessions.updateBoundary(app));
            }else if(method.equals("GET")&&path.equals("/api/devices")) {
                var list=new ArrayList<Map<String,Object>>();
                var status=config.desktopStatus();boolean enabled=(Boolean)status.get("desktopEnabled");
                var local=new LinkedHashMap<String,Object>(Map.of("id",config.deviceId(),"label",config.label(),"kind","local",
                    "status",enabled?"GATEWAY_REACHABLE":"BLOCKED","checkedAt",sessions.clock.instant().toString(),"launchUrl",config.origin()+"/"));
                local.putAll(status);
                if(!enabled)local.put("blockedReason",config.desktopBlockedReason());
                list.add(local);
                for(JsonNode b:config.bookmarks())list.add(Map.of("id",b.path("id").asText(),"label",b.path("label").asText(),"kind","bookmark","status","UNVERIFIED","launchUrl",b.path("url").asText()));
                send(res,200,list);
            }else if(method.equals("GET")&&path.equals("/api/diagnostics")) {
                var diagnostics=new LinkedHashMap<String,Object>(Map.of("build","1.0.0","guacamole","1.6.0","nodeId",config.nodeId(),"keysyms",config.keysyms(),"clipboardLimit",16384,"remoteResize",false,"directLocalIME",false));
                diagnostics.putAll(config.desktopStatus());diagnostics.put("trustedDevicesEnabled",trusted!=null);send(res,200,diagnostics);
            }
            else if(method.equals("GET")&&path.equals("/api/history"))send(res,200,sessions.audit.history(app.ref));
            else throw new Failure(404,"NOT_FOUND");
        }catch(Failure f){GatewayFilter.error(res,f);}catch(Exception e){GatewayFilter.error(res,new Failure(500,"INTERNAL_ERROR"));}
    }
    private static String text(JsonNode n,String key){if(!n.path(key).isTextual()||n.path(key).textValue().length()>80)throw new Failure(400,"INVALID_REQUEST");return n.path(key).textValue();}
    private static JsonNode body(HttpServletRequest r) throws IOException {
        if(!GatewayFilter.json(r))throw new Failure(415,"INVALID_REQUEST");
        byte[] bytes=r.getInputStream().readNBytes(4097);if(bytes.length>4096)throw new Failure(413,"INVALID_REQUEST");
        try{JsonNode n=Config.JSON.readTree(bytes);if(n==null || !n.isObject())throw new Failure(400,"INVALID_REQUEST");return n;}catch(com.fasterxml.jackson.core.JsonProcessingException e){throw new Failure(400,"INVALID_REQUEST");}
    }
    private static void send(HttpServletResponse r,int code,Object obj) throws IOException{r.setStatus(code);r.setContentType("application/json;charset=UTF-8");Config.JSON.writeValue(r.getOutputStream(),obj);}
}

package com.rdg;

import javax.servlet.http.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;

/** Access is the enrollment authority; the private device store owns later browser trust. */
final class LoginServlet extends HttpServlet {
    private static final String NONCE_COOKIE="__Host-rdg-enroll";
    private final Config config;
    private final AccessVerifier verifier;
    private final TrustedDeviceStore trusted;
    private final Clock clock;
    private final Sessions sessions;
    private final String stylesheet;
    private final Map<String,Instant> challenges=new HashMap<>();
    LoginServlet(Config c,AccessVerifier v,TrustedDeviceStore t,Clock clock,Sessions sessions)throws Exception {
        config=c;verifier=v;trusted=t;this.clock=clock;this.sessions=sessions;
        var manifest=Config.JSON.readTree(Files.readAllBytes(c.webDir().resolve("asset-manifest.json")));
        String found=null;var names=manifest.fieldNames();
        while(names.hasNext()){String name=names.next();if(name.matches("/assets/styles\\.[a-f0-9]{16}\\.css"))found=name;}
        if(found==null)throw new IllegalArgumentException("Login stylesheet missing");stylesheet=found;
    }
    @Override protected void service(HttpServletRequest request,HttpServletResponse response)throws IOException {
        response.setHeader("Cache-Control","no-store");
        // no-referrer makes a native form POST serialize Origin as null; retain it only on this same-origin page.
        if(request.getMethod().equals("GET"))response.setHeader("Referrer-Policy","same-origin");
        try {
            boolean navigation=request.getMethod().equals("GET");
            if(!URI.create(config.origin()).getAuthority().equals(GatewayFilter.single(request,"Host")))throw new Failure(403,"ORIGIN_DENIED");
            String origin=GatewayFilter.single(request,"Origin");
            // Access redirects can carry an opaque/foreign Origin on GET; only POST grants browser trust.
            if(!navigation&&(request.getQueryString()!=null||!config.origin().equals(origin)))throw new Failure(403,"ORIGIN_DENIED");
            var identity=verifier.verify(GatewayFilter.single(request,"Cf-Access-Jwt-Assertion"));
            if(navigation&&request.getQueryString()!=null) {
                // Discard return parameters without interpreting, reflecting or logging them.
                response.setStatus(303);response.setHeader("Location","/login");return;
            }
            String priorAppCookie=GatewayFilter.cookie(request);
            if(Set.of("GET","POST").contains(request.getMethod()) && existingTrust(request,identity)) {
                response.setStatus(303);response.setHeader("Location","/");return;
            }
            if(request.getMethod().equals("GET")) {
                String nonce=challenge();
                response.addHeader("Set-Cookie",NONCE_COOKIE+"="+nonce+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300");
                response.setContentType("text/html; charset=UTF-8");
                response.getWriter().write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><title>Trust this browser</title><link rel=\"stylesheet\" href=\""+stylesheet+"\"></head><body><header class=\"bar\"><a class=\"brand\" href=\"/\">↗ Remote workspace</a></header><main><section class=\"prepare\"><h1>Trust this browser</h1><p>Stay signed in on this browser for one year. You can remove it from Trusted devices at any time.</p><p>Use this on your own device.</p><form method=\"post\" action=\"/login\"><input type=\"hidden\" name=\"nonce\" value=\""+nonce+"\"><button class=\"primary\" type=\"submit\">Trust this browser and continue</button></form></section></main></body></html>");
            }else if(request.getMethod().equals("POST")) {
                String type=request.getContentType();
                if(type==null||!type.matches("application/x-www-form-urlencoded(?:;\\s*charset=[Uu][Tt][Ff]-8)?"))throw new Failure(415,"INVALID_REQUEST");
                byte[] body=request.getInputStream().readNBytes(1025);
                if(body.length>1024)throw new Failure(400,"INVALID_REQUEST");
                String value=new String(body,StandardCharsets.UTF_8);
                if(!value.startsWith("nonce=")||value.indexOf('&')>=0)throw new Failure(400,"INVALID_REQUEST");
                String nonce=URLDecoder.decode(value.substring(6),StandardCharsets.UTF_8);
                String cookie=TrustedDeviceCookies.read(request,NONCE_COOKIE);
                if(cookie==null||!nonce.matches("[A-Za-z0-9_-]{43}")||!MessageDigest.isEqual(cookie.getBytes(StandardCharsets.US_ASCII),nonce.getBytes(StandardCharsets.US_ASCII))||!consume(nonce))throw new Failure(403,"CSRF_INVALID");
                var issued=trusted.issue(identity);
                sessions.revokeCookie(priorAppCookie,identity.subject(),"DEVICE_ENROLLED");
                response.addHeader("Set-Cookie","__Host-rdg=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
                TrustedDeviceCookies.issue(response,issued,clock);
                response.addHeader("Set-Cookie",NONCE_COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0");
                response.setStatus(303);response.setHeader("Location","/");
            }else {response.setStatus(405);response.setHeader("Allow","GET, POST");}
        }catch(Failure failure){error(request,response,failure);}
        catch(Exception ignored){error(request,response,new Failure(400,"INVALID_REQUEST"));}
    }
    private void error(HttpServletRequest request,HttpServletResponse response,Failure failure)throws IOException {
        if(!request.getMethod().equals("GET")){GatewayFilter.error(response,failure);return;}
        if(response.isCommitted())return;
        response.setStatus(failure.status);response.setContentType("text/html; charset=UTF-8");
        String message=failure.status==401?"Your sign-in has expired. Open the gateway again to sign in.":
            failure.status==429?"Too many sign-in attempts. Wait a few minutes and try again.":
            "This sign-in request was rejected. Open the gateway directly and try again.";
        response.getWriter().write("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><title>Sign-in unavailable</title><link rel=\"stylesheet\" href=\""+stylesheet+"\"></head><body><header class=\"bar\"><a class=\"brand\" href=\"/\">↗ Remote workspace</a></header><main><section class=\"prepare\"><h1>Sign-in unavailable</h1><p>"+message+"</p><a class=\"primary\" href=\"/login\">Open gateway sign-in</a></section></main></body></html>");
    }
    private boolean existingTrust(HttpServletRequest request,AccessVerifier.Identity identity) {
        try {return trusted.verify(TrustedDeviceCookies.read(request,TrustedDeviceCookies.NAME)).identity().subject().equals(identity.subject());}
        catch(Failure missing){return false;}
    }
    private synchronized String challenge() {
        Instant now=clock.instant();challenges.entrySet().removeIf(e->!now.isBefore(e.getValue()));
        if(challenges.size()>=64)throw new Failure(429,"RATE_LIMITED");
        String nonce=Sessions.random();challenges.put(Sessions.hash(nonce),now.plusSeconds(300));return nonce;
    }
    private synchronized boolean consume(String nonce) {
        Instant deadline=challenges.remove(Sessions.hash(nonce));return deadline!=null&&clock.instant().isBefore(deadline);
    }
}

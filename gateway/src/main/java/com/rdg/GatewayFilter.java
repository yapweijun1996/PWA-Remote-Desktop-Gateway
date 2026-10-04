package com.rdg;

import javax.servlet.*;
import javax.servlet.http.*;
import java.io.*;
import java.net.URI;
import java.util.*;

final class GatewayFilter implements Filter {
    final Config config;final AccessVerifier verifier;final Sessions sessions;
    final TrustedDeviceStore trusted;
    GatewayFilter(Config c,AccessVerifier v,Sessions s){this(c,v,s,null);}
    GatewayFilter(Config c,AccessVerifier v,Sessions s,TrustedDeviceStore t){config=c;verifier=v;sessions=s;trusted=t;}
    public void doFilter(ServletRequest req,ServletResponse res,FilterChain chain) throws IOException,ServletException {
        var request=(HttpServletRequest)req;var response=(HttpServletResponse)res;
        securityHeaders(response);
        String path=request.getRequestURI();
        // Servlets and the WebSocket container route on the decoded, normalized path. Classifying the raw string
        // would let /%77s/... or /ws/./... reach an endpoint without these guards, so non-canonical URIs are refused.
        if(!path.equals(routedPath(request))){error(response,new Failure(400,"INVALID_REQUEST"));return;}
        boolean protectedPath=path.startsWith("/api/")||path.startsWith("/ws/");
        if(!protectedPath){
            if(trusted!=null&&(path.equals("/")||path.equals("/index.html"))) {
                response.setHeader("Cache-Control","no-store");
                try {
                    if(!URI.create(config.origin()).getAuthority().equals(single(request,"Host")))throw new Failure(403,"ORIGIN_DENIED");
                    if(request.getQueryString()!=null) {
                        if(!request.getMethod().equals("GET"))throw new Failure(403,"ORIGIN_DENIED");
                        response.setStatus(303);response.setHeader("Location","/");return;
                    }
                    trusted.verify(TrustedDeviceCookies.read(request,TrustedDeviceCookies.NAME));
                }catch(Failure failure){
                    if(failure.status!=401){error(response,failure);return;}
                    response.setStatus(303);response.setHeader("Location","/login");return;
                }
            }
            chain.doFilter(req,res);return;
        }
        response.setHeader("Cache-Control","no-store");
        try {
            if((request.getQueryString()!=null && !request.getQueryString().isEmpty()) || !URI.create(config.origin()).getAuthority().equals(single(request,"Host")))throw new Failure(403,"ORIGIN_DENIED");
            boolean socket=path.startsWith("/ws/"),mutation=!request.getMethod().equals("GET");
            String origin=single(request,"Origin");
            if((socket||mutation||origin!=null)&&!config.origin().equals(origin))throw new Failure(403,"ORIGIN_DENIED");
            AccessVerifier.Identity identity;
            if(trusted==null)identity=verifier.verify(single(request,"Cf-Access-Jwt-Assertion"));
            else {
                TrustedDeviceStore.Verified verified;
                try{verified=trusted.verify(TrustedDeviceCookies.read(request,TrustedDeviceCookies.NAME));}
                catch(Failure failure){if(failure.status==401)throw new Failure(401,"TRUSTED_DEVICE_REQUIRED");throw failure;}
                identity=verified.identity();request.setAttribute("trustedDeviceId",verified.deviceId());
            }
            request.setAttribute("identity",identity);
            String cookie=cookie(request);request.setAttribute("appCookie",cookie);
            boolean bootstrap=path.equals("/api/session/bootstrap")&&request.getMethod().equals("POST");
            if(bootstrap) {
                if(!json(request))throw new Failure(415,"INVALID_REQUEST");
            } else {
                Sessions.App app=sessions.authorize(cookie,identity);
                if(trusted!=null)sessions.checkTrustedBinding(app,(String)request.getAttribute("trustedDeviceId"));
                request.setAttribute("app",app);
                if(mutation)Sessions.csrf(app,single(request,"X-RDG-CSRF"));
                if(socket) {
                    if(!request.getMethod().equals("GET") || !"websocket".equalsIgnoreCase(single(request,"Upgrade"))
                        || !"guacamole".equals(single(request,"Sec-WebSocket-Protocol")) || !path.matches("/ws/sessions/[A-Za-z0-9_-]{43}"))throw new Failure(400,"INVALID_REQUEST");
                    sessions.begin(app,path.substring("/ws/sessions/".length()));
                    // Tomcat copies this principal into the WebSocket session; the endpoint refuses upgrades without it.
                    req=new HttpServletRequestWrapper(request){@Override public java.security.Principal getUserPrincipal(){return ()->app.subject;}};
                }
            }
            chain.doFilter(req,res);
        }catch(Failure f){error(response,f);}catch(Exception e){error(response,new Failure(500,"INTERNAL_ERROR"));}
    }
    static String routedPath(HttpServletRequest r){String info=r.getPathInfo();return r.getServletPath()+(info==null?"":info);}
    static boolean json(HttpServletRequest r){String s=r.getContentType();return s!=null && s.matches("application/json(?:;\\s*charset=[Uu][Tt][Ff]-8)?");}
    static String single(HttpServletRequest r,String name) {
        List<String> values=Collections.list(r.getHeaders(name));
        if(values.size()>1 || (!values.isEmpty() && (values.get(0).contains("\r")||values.get(0).contains("\n"))))throw new Failure(400,"INVALID_REQUEST");
        return values.isEmpty()?null:values.get(0);
    }
    static String cookie(HttpServletRequest r) {
        String found=null;
        if(r.getCookies()!=null)for(Cookie c:r.getCookies())if(c.getName().equals("__Host-rdg")) {
            if(found!=null || !c.getValue().matches("[A-Za-z0-9_-]{43}"))throw new Failure(401,"AUTH_REQUIRED");found=c.getValue();
        }
        return found;
    }
    static void securityHeaders(HttpServletResponse r) {
        r.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        r.setHeader("X-Content-Type-Options","nosniff");r.setHeader("Referrer-Policy","no-referrer");r.setHeader("X-Frame-Options","DENY");
        r.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
    }
    static void error(HttpServletResponse response,Failure f) throws IOException {
        if(response.isCommitted())return;
        response.setStatus(f.status);response.setContentType("application/json;charset=UTF-8");response.setHeader("Cache-Control","no-store");
        Config.JSON.writeValue(response.getOutputStream(),Map.of("code",f.code,"message",f.code.replace('_',' '),"auditId",UUID.randomUUID().toString()));
    }
}

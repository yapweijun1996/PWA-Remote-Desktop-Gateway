package com.rdg;

import javax.servlet.http.*;
import java.io.*;
import java.util.*;

/** Device management is protected by the same session, owner, CSRF and origin boundary. */
final class TrustedDevicesServlet extends HttpServlet {
    private final TrustedDeviceStore trusted;
    private final Sessions sessions;
    TrustedDevicesServlet(TrustedDeviceStore trusted,Sessions sessions){this.trusted=trusted;this.sessions=sessions;}
    private static void send(HttpServletResponse r,Object value)throws IOException {r.setStatus(200);r.setContentType("application/json;charset=UTF-8");Config.JSON.writeValue(r.getOutputStream(),value);}
    @Override protected void service(HttpServletRequest request,HttpServletResponse response)throws IOException {
        try {
            var app=(Sessions.App)request.getAttribute("app");
            var identity=(AccessVerifier.Identity)request.getAttribute("identity");
            String path=request.getRequestURI(),token=TrustedDeviceCookies.read(request,TrustedDeviceCookies.NAME);
            if(path.equals("/api/trusted-devices")&&request.getMethod().equals("GET")) {
                send(response,Map.of("devices",trusted.list(identity,token)));
            }else if(path.startsWith("/api/trusted-devices/")&&request.getMethod().equals("DELETE")) {
                String id=path.substring("/api/trusted-devices/".length());
                if(!id.matches("[A-Za-z0-9_-]{8,64}"))throw new Failure(404,"DEVICE_UNKNOWN");
                String current=trusted.verify(token).deviceId();
                if(!trusted.revoke(identity,id))throw new Failure(404,"DEVICE_UNKNOWN");
                // Revocation also closes already-open transports, which no longer make HTTP requests.
                sessions.revokeDevice(id,"DEVICE_REVOKED");
                if(current.equals(id))TrustedDeviceCookies.clear(response);
                send(response,Map.of("revoked",true,"reauthenticate",current.equals(id)));
            }else {response.setStatus(404);}
        }catch(Failure failure){GatewayFilter.error(response,failure);}
        catch(Exception ignored){GatewayFilter.error(response,new Failure(503,"TRUSTED_DEVICE_STORE_UNAVAILABLE"));}
    }
}

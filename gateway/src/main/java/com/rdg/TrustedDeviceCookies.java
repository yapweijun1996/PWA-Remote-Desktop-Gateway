package com.rdg;

import javax.servlet.http.*;
import java.time.*;

/** Fixed host-only cookies. Trusted device bearers never enter JavaScript. */
final class TrustedDeviceCookies {
    static final String NAME = "__Host-rdg-device";
    static String read(HttpServletRequest request, String name) {
        String found=null;
        if(request.getCookies()!=null)for(Cookie cookie:request.getCookies())if(name.equals(cookie.getName())) {
            if(found!=null||!cookie.getValue().matches("[A-Za-z0-9_-]{43}"))throw new Failure(401,"TRUSTED_DEVICE_REQUIRED");
            found=cookie.getValue();
        }
        return found;
    }
    static void issue(HttpServletResponse response,TrustedDeviceStore.Issue issued,Clock clock) {
        long age=Math.min(31536000,Math.max(0,Duration.between(clock.instant(),issued.expiresAt()).getSeconds()));
        response.addHeader("Set-Cookie",NAME+"="+issued.token()+"; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age="+age);
    }
    static void clear(HttpServletResponse response) {
        response.addHeader("Set-Cookie",NAME+"=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
    }
}

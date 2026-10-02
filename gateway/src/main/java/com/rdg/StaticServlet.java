package com.rdg;

import javax.servlet.http.*;
import java.nio.file.*;
import java.io.*;
import com.fasterxml.jackson.databind.JsonNode;

/** Build manifest is the sole public asset allowlist. Repository/secret paths cannot resolve. */
final class StaticServlet extends HttpServlet {
    private final Path web;
    private final JsonNode assets;
    StaticServlet(Path web) throws Exception{this.web=web.toRealPath();assets=Config.JSON.readTree(Files.readAllBytes(web.resolve("asset-manifest.json")));}
    @Override protected void service(HttpServletRequest req,HttpServletResponse res) throws IOException {
        String path=req.getRequestURI();
        if(!req.getMethod().equals("GET") && !req.getMethod().equals("HEAD")){res.setStatus(405);return;}
        if(path.equals("/health")){res.setContentType("application/json");res.setHeader("Cache-Control","no-store");res.getWriter().write("{\"status\":\"alive\"}");return;}
        if(path.equals("/"))path="/index.html";
        JsonNode asset=assets.get(path);
        if(asset==null || req.getQueryString()!=null){res.setStatus(404);res.setHeader("Cache-Control","no-store");return;}
        Path file=web.resolve(path.substring(1));
        if(Files.isSymbolicLink(file)||!file.toRealPath().startsWith(web)){res.setStatus(404);return;}
        res.setContentType(asset.path("type").asText());
        res.setHeader("Cache-Control",asset.path("immutable").asBoolean()?"public, max-age=31536000, immutable":"no-store");
        if(path.equals("/sw.js"))res.setHeader("Service-Worker-Allowed","/");
        if(!req.getMethod().equals("HEAD"))Files.copy(file,res.getOutputStream());
    }
}

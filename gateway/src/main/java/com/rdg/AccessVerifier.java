package com.rdg;

import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.*;
import com.nimbusds.jwt.*;
import java.net.URI;
import java.net.http.*;
import java.time.*;
import java.util.*;

/** Trusted, size/time-bounded JWKS cache. Untrusted token URLs are never fetched. */
final class AccessVerifier {
    record Identity(String subject, Instant expiresAt) {}
    interface KeySource { String fetch() throws Exception; }
    private static final java.util.concurrent.ScheduledExecutorService FETCH_TIMER=java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"rdg-jwks-deadline");t.setDaemon(true);return t;});
    private final Config config;
    private final Clock clock;
    private final KeySource source;
    private JWKSet keys;
    private Instant fetchedAt=Instant.MIN, refreshAt=Instant.MIN;
    AccessVerifier(Config config, Clock clock) {
        this(config,clock,()-> {
            HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
            HttpResponse<java.io.InputStream> res=http.send(HttpRequest.newBuilder(URI.create(config.issuer()+"/cdn-cgi/access/certs"))
                .timeout(Duration.ofSeconds(5)).GET().build(),HttpResponse.BodyHandlers.ofInputStream());
            try(var body=res.body()) {
                if(res.statusCode()!=200)throw new IllegalArgumentException("JWKS unavailable");
                var deadline=FETCH_TIMER.schedule(()->{try{body.close();}catch(Exception ignored){}},5,java.util.concurrent.TimeUnit.SECONDS);
                byte[] bytes;
                try{bytes=body.readNBytes(65537);}finally{deadline.cancel(false);}
                if(bytes.length>65536)throw new IllegalArgumentException("JWKS too large");
                return new String(bytes,java.nio.charset.StandardCharsets.UTF_8);
            }
        });
    }
    AccessVerifier(Config c,Clock clock,KeySource source) { this.config=c;this.clock=clock;this.source=source; }
    synchronized Identity verify(String token) {
        try {
            if(token==null || token.length()>16384 || token.indexOf(',')>=0)throw new Failure(401,"AUTH_REQUIRED");
            SignedJWT jwt=SignedJWT.parse(token);
            var header=jwt.getHeader();
            if(!JWSAlgorithm.RS256.equals(header.getAlgorithm()) || header.getKeyID()==null || header.getKeyID().length()>128
                || header.getJWKURL()!=null || header.getX509CertURL()!=null || header.getJWK()!=null
                || (header.getCriticalParams()!=null && !header.getCriticalParams().isEmpty()))throw new Failure(401,"AUTH_REQUIRED");
            Instant now=clock.instant();
            JWK key=keys==null?null:keys.getKeyByKeyId(header.getKeyID());
            if(keys==null || !now.isBefore(fetchedAt.plusSeconds(300)) || key==null) {
                if(now.isBefore(refreshAt))throw new Failure(401,"AUTH_REQUIRED");
                refreshAt=now.plusSeconds(5);
                String fetched;
                try{fetched=source.fetch();}finally{refreshAt=clock.instant().plusSeconds(5);}
                if(fetched.length()>65536)throw new Failure(401,"AUTH_REQUIRED");
                JWKSet next=JWKSet.parse(fetched);
                if(next.getKeys().isEmpty() || next.getKeys().size()>20)throw new Failure(401,"AUTH_REQUIRED");
                Set<String> ids=new HashSet<>();
                for(JWK k:next.getKeys())if(k.getKeyID()==null||!ids.add(k.getKeyID()))throw new Failure(401,"AUTH_REQUIRED");
                keys=next;fetchedAt=now;key=keys.getKeyByKeyId(header.getKeyID());
            }
            if(!(key instanceof RSAKey rsa) || rsa.isPrivate() || rsa.size()<2048 || (rsa.getKeyUse()!=null && !KeyUse.SIGNATURE.equals(rsa.getKeyUse()))
                || (rsa.getAlgorithm()!=null && !JWSAlgorithm.RS256.equals(rsa.getAlgorithm())) || !jwt.verify(new RSASSAVerifier(rsa.toRSAPublicKey())))
                throw new Failure(401,"AUTH_REQUIRED");
            JWTClaimsSet c=jwt.getJWTClaimsSet();
            if(!config.issuer().equals(c.getIssuer()) || !c.getAudience().equals(List.of(config.audience())) || c.getExpirationTime()==null
                || !now.isBefore(c.getExpirationTime().toInstant()) || c.getIssueTime()==null || c.getIssueTime().toInstant().isAfter(now.plusSeconds(30))
                || (c.getNotBeforeTime()!=null && c.getNotBeforeTime().toInstant().isAfter(now.plusSeconds(30))) || !"app".equals(c.getStringClaim("type")))
                throw new Failure(401,"AUTH_REQUIRED");
            String subject=c.getSubject();
            if(subject==null || subject.isBlank() || subject.length()>256 || !config.ownerEmail().equals(c.getStringClaim("email"))
                || (!config.ownerSubject().isEmpty() && !config.ownerSubject().equals(subject)))throw new Failure(403,"ACCESS_DENIED");
            return new Identity(subject,c.getExpirationTime().toInstant());
        } catch(Failure e) {throw e;} catch(Exception e) {throw new Failure(401,"AUTH_REQUIRED");}
    }
}

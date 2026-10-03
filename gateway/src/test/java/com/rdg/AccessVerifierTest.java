package com.rdg;

import com.nimbusds.jose.jwk.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class AccessVerifierTest {
    @TempDir Path dir;
    Config c;Fixtures.Time time;RSAKey key;AccessVerifier verifier;
    @BeforeEach void setup() throws Exception {c=Fixtures.config(dir,4822,"https://gateway.fixture.test");time=new Fixtures.Time();key=Fixtures.key("one");verifier=new AccessVerifier(c,time,()->new JWKSet(key.toPublicJWK()).toString());}
    @Test void validIdentity() throws Exception {assertEquals("fixture-owner",verifier.verify(Fixtures.token(c,key,time.instant(),3600,Map.of())).subject());}
    @Test void missingForgedAndEmailHeaderCannotAuthorize() throws Exception {
        assertThrows(Failure.class,()->verifier.verify(null));assertThrows(Failure.class,()->verifier.verify("owner@fixture.test"));
        assertThrows(Failure.class,()->verifier.verify(Fixtures.token(c,Fixtures.key("one"),time.instant(),3600,Map.of())));
    }
    @Test void wrongIssuerAudienceEmailTypeAndSubject() throws Exception {
        for(var change:List.of(Map.<String,Object>of("iss","https://evil.test"),Map.<String,Object>of("aud",List.of("wrong")),
            Map.<String,Object>of("email","stranger@fixture.test"),Map.<String,Object>of("type","service"),Map.<String,Object>of("sub","")))
            assertThrows(Failure.class,()->verifier.verify(Fixtures.token(c,key,time.instant(),3600,change)));
    }
    @Test void expiredFutureNbfAndAlgorithmConfusion() throws Exception {
        assertThrows(Failure.class,()->verifier.verify(Fixtures.token(c,key,time.instant(),0,Map.of())));
        assertThrows(Failure.class,()->verifier.verify(Fixtures.token(c,key,time.instant().plusSeconds(60),3600,Map.of())));
        assertThrows(Failure.class,()->verifier.verify(Fixtures.token(c,key,time.instant(),3600,Map.of("nbf",Date.from(time.instant().plusSeconds(60))))));
        var unsigned=new com.nimbusds.jwt.PlainJWT(new com.nimbusds.jwt.JWTClaimsSet.Builder().subject("fixture-owner").build());
        assertThrows(Failure.class,()->verifier.verify(unsigned.serialize()));
    }
    @Test void keyRotationCacheExpiryAndRefreshFailure() throws Exception {
        var current=new AtomicReference<>(new JWKSet(key.toPublicJWK()).toString());var calls=new AtomicInteger();
        var v=new AccessVerifier(c,time,()->{calls.incrementAndGet();if(current.get()==null)throw new Exception();return current.get();});
        String old=Fixtures.token(c,key,time.instant(),3600,Map.of());v.verify(old);v.verify(old);assertEquals(1,calls.get());
        RSAKey next=Fixtures.key("two");current.set(new JWKSet(next.toPublicJWK()).toString());time.advance(6);
        v.verify(Fixtures.token(c,next,time.instant(),3600,Map.of()));assertEquals(2,calls.get());
        current.set(null);time.advance(301);assertThrows(Failure.class,()->v.verify(Fixtures.token(c,next,time.instant(),3600,Map.of())));
        assertEquals(3,calls.get());
    }
    @Test void duplicateKeysAndUntrustedUrlsFailClosed() throws Exception {
        var v=new AccessVerifier(c,time,()->new JWKSet(List.of(key.toPublicJWK(),key.toPublicJWK())).toString());
        assertThrows(Failure.class,()->v.verify(Fixtures.token(c,key,time.instant(),3600,Map.of())));
        var jwt=com.nimbusds.jwt.SignedJWT.parse(Fixtures.token(c,key,time.instant(),3600,Map.of()));
        var hostile=new com.nimbusds.jwt.SignedJWT(new com.nimbusds.jose.JWSHeader.Builder(com.nimbusds.jose.JWSAlgorithm.RS256).keyID("one").jwkURL(java.net.URI.create("https://evil.test/jwks")).build(),jwt.getJWTClaimsSet());
        hostile.sign(new com.nimbusds.jose.crypto.RSASSASigner(key));assertThrows(Failure.class,()->verifier.verify(hostile.serialize()));
    }
}

package com.rdg;

import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ConfigTest {
    @TempDir Path dir;
    @Test void missingConfigPlaceholdersAndUnsafeSecretRefuseStartup() throws Exception {
        assertThrows(Exception.class,()->Config.load(Map.of()));
        assertThrows(Exception.class,()->Config.load(Map.of("RDG_PUBLIC_ORIGIN","https://remote-mini.example.com")));
        Path secret=dir.resolve("secret");Files.writeString(secret,"fixture-only");Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-r--r--"));assertThrows(Exception.class,()->Config.secretValue(secret));
        Files.setPosixFilePermissions(secret,PosixFilePermissions.fromString("rw-------"));assertEquals("fixture-only",Config.secretValue(secret));
        Path link=dir.resolve("link");Files.createSymbolicLink(link,secret);assertThrows(Exception.class,()->Config.secretValue(link));
    }
    @Test void malformedJsonAndUnknownFieldsRefuseBeforeSideEffects() throws Exception {
        assertThrows(Exception.class,()->Config.JSON.readTree("{\"mode\":\"view\",\"mode\":\"control\"}"));
        assertThrows(Failure.class,()->Config.fields(Config.JSON.readTree("{\"host\":\"evil\"}"),Set.of("deviceId")));
    }
}

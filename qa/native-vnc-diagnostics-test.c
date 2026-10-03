/* Synthetic logger tests only: no server, credentials, private logs or VNC. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <sys/stat.h>
#include <unistd.h>

void __syslog_chk(int priority, int flag, const char *format, ...);
void __vsyslog_chk(int priority, int flag, const char *format, va_list arguments);

/* Volatile pointers exercise the plain exports even with fortify inlining. */
static void (*volatile plain_syslog)(int, const char *, ...) = syslog;
static void (*volatile plain_vsyslog)(int, const char *, va_list) = vsyslog;

static void emit_variadic(unsigned int entry, const char *format, ...) {
    va_list arguments;
    va_start(arguments, format);
    if (entry == 1) plain_vsyslog(LOG_INFO, format, arguments);
    else __vsyslog_chk(LOG_INFO, 1, format, arguments);
    va_end(arguments);
}

static void emit(unsigned int entry, const char *message, int nul_injection) {
    if (nul_injection) {
        if (entry == 0) plain_syslog(LOG_INFO, "%s%c%s", message, 0, "synthetic-private-suffix");
        else if (entry == 2) __syslog_chk(LOG_INFO, 1, "%s%c%s", message, 0, "synthetic-private-suffix");
        else emit_variadic(entry, "%s%c%s", message, 0, "synthetic-private-suffix");
    } else {
        /* Guacamole's native callbacks use this library-style "%s" call. */
        if (entry == 0) plain_syslog(LOG_INFO, "%s", message);
        else if (entry == 2) __syslog_chk(LOG_INFO, 1, "%s", message);
        else emit_variadic(entry, "%s", message);
    }
}

static void check(unsigned int entry, const char *message, const char *expected, int nul_injection) {
    int descriptors[2];
    int original_stderr;
    char received[512];
    size_t used = 0;
    ssize_t count;
    if (pipe(descriptors) != 0 || (original_stderr = dup(STDERR_FILENO)) < 0
            || dup2(descriptors[1], STDERR_FILENO) < 0) exit(2);
    close(descriptors[1]);
    errno = EDOM;
    emit(entry, message, nul_injection);
    if (errno != EDOM) exit(3);
    if (dup2(original_stderr, STDERR_FILENO) < 0) exit(2);
    close(original_stderr);
    while ((count = read(descriptors[0], received + used, sizeof(received) - used)) > 0) {
        used += (size_t)count;
        if (used == sizeof(received)) exit(4);
    }
    close(descriptors[0]);
    if (count < 0 || used != strlen(expected) || memcmp(received, expected, used) != 0) {
        /* Do not print either raw input or captured output on failure. */
        fputs("NATIVE_DIAGNOSTICS_CLASSIFIER_TEST_FAILED\n", stdout);
        exit(1);
    }
}

#define FILE_SINK "/tmp/rdg-native-vnc-diagnostics"
#define FILE_CAPACITY 65536u

static struct stat owned_status;
static int owns_file;

static void cleanup_owned_file(void) {
    struct stat current;
    if (owns_file && lstat(FILE_SINK, &current) == 0
            && current.st_dev == owned_status.st_dev && current.st_ino == owned_status.st_ino)
        unlink(FILE_SINK);
    owns_file = 0;
}

static void require_missing_file(void) {
    struct stat existing;
    if (lstat(FILE_SINK, &existing) == 0 || errno != ENOENT) exit(2);
}

static void own_created_file(void) {
    if (lstat(FILE_SINK, &owned_status) != 0) exit(2);
    owns_file = 1;
}

static void check_file(int descriptor, const char *expected) {
    char actual[512];
    struct stat status;
    size_t length = strlen(expected);
    ssize_t received;
    if (fstat(descriptor, &status) != 0 || !S_ISREG(status.st_mode)
            || status.st_uid != geteuid() || (status.st_mode & 07777) != 0600
            || status.st_size != (off_t)length || lseek(descriptor, 0, SEEK_SET) < 0) exit(5);
    received = read(descriptor, actual, sizeof(actual));
    if (received < 0 || (size_t)received != length || memcmp(actual, expected, length) != 0) exit(5);
}

static void require_size(int descriptor, off_t expected) {
    struct stat status;
    if (fstat(descriptor, &status) != 0 || status.st_size != expected) exit(5);
}

static size_t check_unsafe_sinks(void) {
    static const char message[] = "VNC authentication succeeded\n";
    static const char label[] = "RDG_NATIVE_VNC_DIAG:AUTHENTICATION_SUCCEEDED\n";
    unsigned int entry;
    size_t checked = 0;
    int descriptor;
    struct stat existing;
    char target[] = "/tmp/rdg-native-vnc-diagnostic-fixture.XXXXXX";

    /* Do not touch any pre-existing fixture/diagnostic file. */
    require_missing_file();
    descriptor = open(FILE_SINK, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (descriptor < 0) exit(2);
    own_created_file();
    if (fchmod(descriptor, 0604) != 0) exit(2);
    for (entry = 0; entry < 4; entry++) {
        check(entry, message, "", 0);
        require_size(descriptor, 0);
        checked++;
    }
    if (fchmod(descriptor, 0600) != 0 || ftruncate(descriptor, FILE_CAPACITY) != 0) exit(2);
    for (entry = 0; entry < 4; entry++) {
        check(entry, message, "", 0);
        require_size(descriptor, FILE_CAPACITY);
        checked++;
    }
    /* One final complete label fits exactly; the following one must be dropped. */
    if (ftruncate(descriptor, FILE_CAPACITY - sizeof(label) + 1) != 0) exit(2);
    check(0, message, "", 0);
    require_size(descriptor, FILE_CAPACITY);
    check(0, message, "", 0);
    require_size(descriptor, FILE_CAPACITY);
    checked += 2;
    close(descriptor);
    cleanup_owned_file();

    descriptor = mkstemp(target);
    if (descriptor < 0 || symlink(target, FILE_SINK) != 0) exit(2);
    own_created_file();
    for (entry = 0; entry < 4; entry++) {
        check(entry, message, "", 0);
        require_size(descriptor, 0);
        checked++;
    }
    cleanup_owned_file();
    close(descriptor);
    if (unlink(target) != 0) exit(2);

    if (mkfifo(FILE_SINK, 0600) != 0) exit(2);
    own_created_file();
    /* A blocking open regression must fail this synthetic test, not hang. */
    alarm(5);
    for (entry = 0; entry < 4; entry++) {
        check(entry, message, "", 0);
        if (lstat(FILE_SINK, &existing) != 0 || !S_ISFIFO(existing.st_mode)) exit(5);
        checked++;
    }
    alarm(0);
    cleanup_owned_file();
    return checked;
}

int main(void) {
    static const struct {const char *message; const char *label;} cases[] = {
        {"ConnectClientToTcpAddr6: connect\n", "NETWORK_CONNECT_FAILURE"},
        {"ConnectToTcpAddr: connect\n", "NETWORK_CONNECT_FAILURE"},
        {"Unable to connect to VNC server\n", "NETWORK_CONNECT_FAILURE"},
        {"VNC server closed connection\n", "SERVER_CLOSED"},
        {"VNC authentication succeeded\n", "AUTHENTICATION_SUCCEEDED"},
        {"VNC authentication failed\n", "SERVER_REPORTED_AUTHENTICATION_FAILURE"},
        {"VNC authentication failed - too many tries\n", "SERVER_REPORTED_AUTHENTICATION_FAILURE"},
        {"VNC connection failed: Authentication failed\n", "SERVER_REPORTED_AUTHENTICATION_FAILURE"},
        {"VNC connection failed: password check failed!\n", "SERVER_REPORTED_AUTHENTICATION_FAILURE"},
        {"Unable to connect to VNC server.", "NATIVE_CONNECTION_FAILURE_UNCLASSIFIED"},
        {"Connection timed out\n", "TRANSPORT_TIMEOUT"},
        {"write\n", "TRANSPORT_WRITE_FAILURE"},
        {"write failed\n", "TRANSPORT_WRITE_FAILURE"},
        {"Connected to VNC server, using protocol version 3.3\n", "SERVER_INIT_COMPLETED"},
        {"Connected to VNC server, using protocol version 3.7\n", "SERVER_INIT_COMPLETED"},
        {"Connected to VNC server, using protocol version 3.8\n", "SERVER_INIT_COMPLETED"},
        {"CRITICAL: cannot allocate frameBuffer, requested size is too large\n", "FRAMEBUFFER_ALLOCATION_FAILURE"},
        {"CRITICAL: frameBuffer allocation failed, requested size too large or not enough memory?\n", "FRAMEBUFFER_ALLOCATION_FAILURE"},
        {"Desktop name \"synthetic-private-desktop\"\n", NULL},
        {"VNC connection failed: synthetic-private-server-reason\n", NULL},
        {"Unknown native fixture message\n", NULL},
        {"synthetic-token-fixture synthetic-password-fixture\n", NULL},
        {"Desktop name \"VNC authentication succeeded\n\"\n", NULL},
        {"VNC connection failed: synthetic-private\nVNC authentication failed\n", NULL},
        {"VNC authentication succeeded\n\n", NULL},
        {"VNC authentication succeeded\r\n", NULL},
        {"VNC authentication succeeded\nextra", NULL},
        {"VNC connection failed: Authentication failed synthetic-private\n", NULL},
        {"Connected to VNC server, using protocol version 3.889\n", NULL},
        {"", NULL}
    };
    char expected[256];
    int file_descriptor;
    char long_message[4096];
    size_t total = 0;
    unsigned int entry;
    size_t index;
    if (unsetenv("RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE") != 0 || atexit(cleanup_owned_file) != 0) exit(2);
    memset(long_message, 'x', sizeof(long_message) - 1);
    long_message[sizeof(long_message) - 1] = '\0';
    memcpy(long_message, "VNC authentication succeeded\n", 29);
    for (entry = 0; entry < 4; entry++) {
        for (index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
            expected[0] = '\0';
            if (cases[index].label != NULL) {
                int length = snprintf(expected, sizeof(expected), "RDG_NATIVE_VNC_DIAG:%s\n", cases[index].label);
                if (length < 0 || (size_t)length >= sizeof(expected)) exit(2);
            }
            check(entry, cases[index].message, expected, 0);
            total++;
        }
        check(entry, long_message, "", 0);
        check(entry, "VNC authentication succeeded\n", "", 1);
        total += 2;
    }
    /* Unknown messages must not even create the file. */
    require_missing_file();
    if (setenv("RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE", "true", 1) != 0) exit(2);
    for (entry = 0; entry < 4; entry++) {
        check(entry, "Desktop name \"synthetic-private-desktop\"\n", "", 0);
        require_missing_file();
        total++;
    }
    /* The production sink, rather than the test, creates this600 fixture. */
    check(0, "VNC authentication succeeded\n", "", 0);
    own_created_file();
    file_descriptor = open(FILE_SINK, O_RDWR | O_NOFOLLOW | O_CLOEXEC);
    if (file_descriptor < 0) exit(2);
    check_file(file_descriptor, "RDG_NATIVE_VNC_DIAG:AUTHENTICATION_SUCCEEDED\n");
    total++;
    for (entry = 0; entry < 4; entry++) {
        for (index = 0; index < sizeof(cases) / sizeof(cases[0]); index++) {
            expected[0] = '\0';
            if (cases[index].label != NULL) {
                int length = snprintf(expected, sizeof(expected), "RDG_NATIVE_VNC_DIAG:%s\n", cases[index].label);
                if (length < 0 || (size_t)length >= sizeof(expected)) exit(2);
            }
            if (ftruncate(file_descriptor, 0) != 0) exit(2);
            check(entry, cases[index].message, "", 0);
            check_file(file_descriptor, expected);
            total++;
        }
        if (ftruncate(file_descriptor, 0) != 0) exit(2);
        check(entry, long_message, "", 0);
        check_file(file_descriptor, "");
        check(entry, "VNC authentication succeeded\n", "", 1);
        check_file(file_descriptor, "");
        total += 2;
    }
    close(file_descriptor);
    cleanup_owned_file();
    total += check_unsafe_sinks();
    require_missing_file();
    if (unsetenv("RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE") != 0) exit(2);
    printf("NATIVE_DIAGNOSTICS_CLASSIFIER_TEST_PASS:%zu\n", total);
    return 0;
}

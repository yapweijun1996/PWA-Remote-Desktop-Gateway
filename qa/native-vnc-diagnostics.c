/* Test-only LD_PRELOAD logger. Never link this into the production image.
 * The Apache VNC callbacks syslog already-formatted messages. Match each whole
 * call before emitting a fixed label; never split or forward server text.
 * Phrase provenance: LibVNCServer-0.9.14 libvncclient/{rfbproto,sockets,vncviewer}.c
 * and Apache Guacamole1.6.0 src/protocols/vnc/vnc.c.
 */
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
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

/* Avoid libc's fortified inline syslog definitions in this interposer. */
void syslog(int priority, const char *format, ...);
void vsyslog(int priority, const char *format, va_list arguments);
void __syslog_chk(int priority, int flag, const char *format, ...);
void __vsyslog_chk(int priority, int flag, const char *format, va_list arguments);

#define MESSAGE_CAPACITY 2048
#define PREFIX "RDG_NATIVE_VNC_DIAG:"
#define FILE_SINK "/tmp/rdg-native-vnc-diagnostics"
#define FILE_CAPACITY 65536u

struct phrase {
    const char *message;
    const char *safe_line;
};

static const struct phrase phrases[] = {
    {"ConnectClientToTcpAddr6: connect\n", PREFIX "NETWORK_CONNECT_FAILURE\n"},
    {"ConnectToTcpAddr: connect\n", PREFIX "NETWORK_CONNECT_FAILURE\n"},
    {"Unable to connect to VNC server\n", PREFIX "NETWORK_CONNECT_FAILURE\n"},
    {"VNC server closed connection\n", PREFIX "SERVER_CLOSED\n"},
    {"VNC authentication succeeded\n", PREFIX "AUTHENTICATION_SUCCEEDED\n"},
    {"VNC authentication failed\n", PREFIX "SERVER_REPORTED_AUTHENTICATION_FAILURE\n"},
    {"VNC authentication failed - too many tries\n", PREFIX "SERVER_REPORTED_AUTHENTICATION_FAILURE\n"},
    /* These are only server assertions, never proof of an incorrect password. */
    {"VNC connection failed: Authentication failed\n", PREFIX "SERVER_REPORTED_AUTHENTICATION_FAILURE\n"},
    {"VNC connection failed: password check failed!\n", PREFIX "SERVER_REPORTED_AUTHENTICATION_FAILURE\n"},
    {"Unable to connect to VNC server.", PREFIX "NATIVE_CONNECTION_FAILURE_UNCLASSIFIED\n"},
    {"Connection timed out\n", PREFIX "TRANSPORT_TIMEOUT\n"},
    {"write\n", PREFIX "TRANSPORT_WRITE_FAILURE\n"},
    {"write failed\n", PREFIX "TRANSPORT_WRITE_FAILURE\n"},
    {"Connected to VNC server, using protocol version 3.3\n", PREFIX "SERVER_INIT_COMPLETED\n"},
    {"Connected to VNC server, using protocol version 3.7\n", PREFIX "SERVER_INIT_COMPLETED\n"},
    {"Connected to VNC server, using protocol version 3.8\n", PREFIX "SERVER_INIT_COMPLETED\n"},
    {"CRITICAL: cannot allocate frameBuffer, requested size is too large\n", PREFIX "FRAMEBUFFER_ALLOCATION_FAILURE\n"},
    {"CRITICAL: frameBuffer allocation failed, requested size too large or not enough memory?\n", PREFIX "FRAMEBUFFER_ALLOCATION_FAILURE\n"}
};

static void erase_message(char *message, size_t length) {
    volatile unsigned char *bytes = (volatile unsigned char *)message;
    while (length-- > 0) *bytes++ = 0;
}

static const char *classify(const char *message, size_t length) {
    size_t index;
    /* NUL injection and more than one terminating LF cannot create labels. */
    for (index = 0; index < length; index++) {
        if (message[index] == '\0' || message[index] == '\r'
                || (message[index] == '\n' && index + 1 != length)) return NULL;
    }
    for (index = 0; index < sizeof(phrases) / sizeof(phrases[0]); index++) {
        if (strlen(phrases[index].message) == length
                && memcmp(message, phrases[index].message, length) == 0)
            return phrases[index].safe_line;
    }
    return NULL;
}

/* Only fixed labels reach this sink; it never opens a caller-selected path. */
static void append_safe_line(const char *safe_line) {
    struct stat status;
    size_t length = strlen(safe_line);
    int descriptor = open(FILE_SINK,
        O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
    if (descriptor < 0) return;
    /* Nonblocking open/lock also prevents a hostile FIFO or contention hang. */
    if (flock(descriptor, LOCK_EX | LOCK_NB) == 0
            && fstat(descriptor, &status) == 0
            && S_ISREG(status.st_mode) && status.st_uid == geteuid()
            && (status.st_mode & 07777) == 0600 && status.st_nlink == 1
            && length <= FILE_CAPACITY && status.st_size >= 0
            && status.st_size <= (off_t)(FILE_CAPACITY - length)) {
        ssize_t result = write(descriptor, safe_line, length);
        (void)result;
    }
    close(descriptor);
}

static void filtered_log(const char *format, va_list arguments) {
    int original_errno = errno;
    char message[MESSAGE_CAPACITY];
    const char *safe_line = NULL;
    int length;
    if (format == NULL) return;
    length = vsnprintf(message, sizeof(message), format, arguments);
    if (length >= 0 && (size_t)length < sizeof(message))
        safe_line = classify(message, (size_t)length);
    erase_message(message, sizeof(message));
    if (safe_line != NULL) {
        const char *file_mode = getenv("RDG_NATIVE_VNC_DIAGNOSTICS_TO_FILE");
        if (file_mode != NULL && strcmp(file_mode, "true") == 0) {
            /* File mode does not depend on Docker attach stream completion. */
            append_safe_line(safe_line);
        } else {
            ssize_t result = write(STDERR_FILENO, safe_line, strlen(safe_line));
            (void)result;
        }
    }
    errno = original_errno;
}

void syslog(int priority, const char *format, ...) {
    va_list arguments;
    (void)priority;
    va_start(arguments, format);
    filtered_log(format, arguments);
    va_end(arguments);
}

void vsyslog(int priority, const char *format, va_list arguments) {
    (void)priority;
    filtered_log(format, arguments);
}

void __syslog_chk(int priority, int flag, const char *format, ...) {
    va_list arguments;
    (void)priority;
    (void)flag;
    va_start(arguments, format);
    filtered_log(format, arguments);
    va_end(arguments);
}

void __vsyslog_chk(int priority, int flag, const char *format, va_list arguments) {
    (void)priority;
    (void)flag;
    filtered_log(format, arguments);
}

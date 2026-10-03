#!/usr/bin/env python3
"""Apply the recorded password-only integration policy to exact Apache1.6.0 source.

Authentication and codecs remain in maintained LibVNCClient. This is an explicit
local integration modification, not an unmodified Apache release build.
"""
from pathlib import Path
import hashlib
import sys

BEFORE_SHA256 = 'ba9d3241a337760e7a61218738ac369fd3c0ecedd2b2ad5c4aa9a39f43feef7e'
AFTER_SHA256 = '390bd0b076b2eb9f7b0586c0c31c73f42864b1966f5857e7eb523afd715a49eb'
ANCHOR = '    /* Password */\n    rfb_client->GetPassword = guac_vnc_get_password;\n'
ADDITION = '\n    /* This gateway owns a separate VNC password, not desktop account credentials. */\n#ifdef ENABLE_VNC_GENERIC_CREDENTIALS\n    rfb_client->GetCredential = NULL;\n#endif\n    const uint32_t password_auth[] = { rfbVncAuth };\n    SetClientAuthSchemes(rfb_client, password_auth, 1);\n    if (!rfb_client->clientAuthSchemes) {\n        rfbClientCleanup(rfb_client);\n        return NULL;\n    }\n'
OLD_SUCCESS = '    if (rfbInitClient(rfb_client, NULL, NULL))\n        return rfb_client;\n'
NEW_SUCCESS = '    if (rfbInitClient(rfb_client, NULL, NULL)) {\n        /* RFB 3.3 does not negotiate through the client auth-scheme allowlist. */\n        if (rfb_client->authScheme != rfbVncAuth) {\n            /* Match Guacamole teardown for buffers owned by the VNC client. */\n            free(rfb_client->frameBuffer);\n            rfb_client->frameBuffer = NULL;\n            free(rfb_client->raw_buffer);\n            rfb_client->raw_buffer = NULL;\n            rfbClientCleanup(rfb_client);\n            return NULL;\n        }\n        return rfb_client;\n    }\n'


def apply(source_directory):
    source = Path(source_directory) / 'src/protocols/vnc/vnc.c'
    if source.is_symlink() or not source.is_file():
        raise ValueError('Unsupported native source file')
    original = source.read_bytes()
    if hashlib.sha256(original).hexdigest() != BEFORE_SHA256:
        raise ValueError('Native source digest mismatch; no patch applied')
    text = original.decode('utf-8')
    if text.count(ANCHOR) != 1 or text.count(OLD_SUCCESS) != 1:
        raise ValueError('Native policy anchor mismatch; no patch applied')
    patched = text.replace(ANCHOR, ANCHOR + ADDITION).replace(OLD_SUCCESS, NEW_SUCCESS).encode('utf-8')
    if hashlib.sha256(patched).hexdigest() != AFTER_SHA256:
        raise ValueError('Native policy output mismatch; no patch applied')
    source.write_bytes(patched)
    print('Applied digest-checked LibVNCClient password-authentication policy.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Explicit Apache source directory required')
    apply(sys.argv[1])

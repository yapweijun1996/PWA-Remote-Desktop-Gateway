# Clipboard probe

`ClipboardProbe.java` runs against the reviewed official guacd image (`sha256:3cbaad3b…`) in a `--network none` container, with a fake RFB server on 127.0.0.1:5900 that only records ClientCutText. It sends the gateway's exact clipboard stream (`clipboard`, base64 `blob` chunks of up to 4096 bytes, `end`) with the production parameters (`disable-copy=false`, `disable-paste=false`, `clipboard-encoding`) and prints every ack guacd returns and every byte the RFB server receives. See `results.txt`.

Findings: guacd returns **no** ack for clipboard, blob or end; the text reaches the RFB server within about 1 ms; with `clipboard-encoding=UTF-8` Chinese is forwarded as UTF-8 bytes (`e4bda0e5a5bd…`), with `ISO8859-1` it becomes `?????` while `café` becomes `636166e9`; an empty stream forwards an empty ClientCutText. It says nothing about how the real Mac's VNC server interprets the bytes.

Build and run (same container flags as `qa/bandwidth-benchmark.sh`): compile with `javac --release 17 -cp gateway/target/rdg-gateway.jar`, run the daemon container, then run the class in the Java image sharing the daemon's network namespace.

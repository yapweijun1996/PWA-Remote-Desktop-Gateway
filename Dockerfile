FROM eclipse-temurin:17-jre-jammy@sha256:8993f1aed8b25fcea7a7047a7949c1866fa558fc6830d938c22c4f13b26be9d7
ARG TARGETARCH
COPY deployment/install-locked-debs.sh /install-locked-debs.sh
COPY deployment/deb-locks/ /locks/
# The pinned JRE image predates USN-8847-1; patch only the reviewed libssl3 artifact.
RUN sh /install-locked-debs.sh "/locks/gateway-${TARGETARCH}.lock" && cp "/locks/gateway-${TARGETARCH}.lock" /opt/rdg-os-packages.lock && rm /install-locked-debs.sh && rm -r /locks
RUN groupadd --gid 10001 rdg && useradd --uid 10001 --gid rdg --no-create-home rdg && mkdir -p /app /var/lib/rdg && chown 10001:10001 /var/lib/rdg
WORKDIR /app
COPY gateway/target/sqlite-native/org/sqlite/native/Linux/ /app/native/
# Load the pinned native library from the immutable image; /tmp remains noexec.
RUN case "$TARGETARCH" in arm64) sqlite_arch=aarch64 ;; amd64) sqlite_arch=x86_64 ;; *) exit 1 ;; esac && mkdir /app/lib && cp "/app/native/$sqlite_arch/libsqlitejdbc.so" /app/lib/ && chmod 0555 /app/lib/libsqlitejdbc.so && rm -rf /app/native
COPY --chown=10001:10001 gateway/target/rdg-gateway.jar /app/rdg-gateway.jar
COPY --chown=10001:10001 web/dist/ /app/web/
USER 10001:10001
ENV RDG_WEB_DIR=/app/web RDG_STATE_DIR=/var/lib/rdg RDG_LISTEN_ADDRESS=0.0.0.0 RDG_LISTEN_PORT=8080
EXPOSE 8080
ENTRYPOINT ["java","-Dorg.sqlite.lib.path=/app/lib","-Xms64m","-Xmx256m","-jar","/app/rdg-gateway.jar"]

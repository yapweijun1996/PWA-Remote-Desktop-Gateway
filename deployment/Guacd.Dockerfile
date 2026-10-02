FROM ubuntu:24.04@sha256:a853f94d226358a79c740cfc7bce0c289748f3fe3488d921d038ccd752c61b60 AS builder
ARG TARGETARCH
COPY deployment/install-locked-debs.sh /install-locked-debs.sh
COPY deployment/deb-locks/ /locks/
RUN sh /install-locked-debs.sh "/locks/guacd-builder-${TARGETARCH}.lock"
# Apache source SHA256 was checked against its release signature; see provenance.
ADD --checksum=sha256:8bc45675da96d7b6f39728160181e3d4ff3c08f460f6d26de5805b642bf13f2b https://archive.apache.org/dist/guacamole/1.6.0/source/guacamole-server-1.6.0.tar.gz /tmp/guacamole-server.tar.gz
RUN --network=none mkdir /source && tar -xzf /tmp/guacamole-server.tar.gz --strip-components=1 -C /source
COPY deployment/apply-vnc-password-policy.py /apply-vnc-password-policy.py
RUN --network=none python3 /apply-vnc-password-policy.py /source
WORKDIR /source
RUN --network=none ./configure --prefix=/opt/guacamole --with-vnc --with-ssl --with-webp --without-rdp --without-ssh --without-telnet --without-terminal --without-pango --without-pulse --without-vorbis --without-websockets --disable-kubernetes --disable-guacenc --disable-guaclog --disable-static && make -j4 && make install

FROM ubuntu:24.04@sha256:a853f94d226358a79c740cfc7bce0c289748f3fe3488d921d038ccd752c61b60
ARG TARGETARCH
COPY deployment/install-locked-debs.sh /install-locked-debs.sh
COPY deployment/deb-locks/ /locks/
RUN sh /install-locked-debs.sh "/locks/guacd-runtime-${TARGETARCH}.lock" && cp "/locks/guacd-runtime-${TARGETARCH}.lock" /opt/guacd-packages.lock && rm /install-locked-debs.sh && rm -r /locks && groupadd --gid 10001 rdg && useradd --uid 10001 --gid rdg --no-create-home rdg
COPY --from=builder /opt/guacamole/ /opt/guacamole/
COPY deployment/guacd-provenance.json /opt/guacd-provenance.json
COPY --from=builder /source/LICENSE /source/NOTICE /opt/guacamole/
RUN printf '%s\n' /opt/guacamole/lib > /etc/ld.so.conf.d/guacamole.conf && ldconfig && /opt/guacamole/sbin/guacd -v
USER 10001:10001
EXPOSE 4822
ENTRYPOINT ["/opt/guacamole/sbin/guacd"]
CMD ["-f","-b","0.0.0.0","-l","4822","-p","/tmp/guacd.pid","-L","error"]

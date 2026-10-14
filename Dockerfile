# Runtime already used by the deployed application (Node 24, Jellyfin FFmpeg).
ARG TDARR_RUNTIME_IMAGE=ghcr.io/haveagitgat/tdarr@sha256:45742f00e51a58553844c8b13d97e7ae9b2ee9a056bd8e5993d9a8282a45a23f
FROM ${TDARR_RUNTIME_IMAGE}
ARG APP_VERSION=1.11.0
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Tdarr Review" \
      org.opencontainers.image.description="Review and approve Tdarr transcodes before replacing media" \
      org.opencontainers.image.source="https://github.com/Desadius/Tdarr-Review" \
      org.opencontainers.image.documentation="https://github.com/Desadius/Tdarr-Review/tree/main/docs" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"
USER root
# tini runs as PID 1: it reaps orphaned processes (such as an ffmpeg whose parent died) and passes
# SIGTERM to the supervisor. Unraid users do not set docker run --init, so the image brings its own.
# The binary is for amd64, the only platform the image is built for.
ADD --checksum=sha256:c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee --chmod=0755 https://github.com/krallin/tini/releases/download/v0.19.0/tini-static-amd64 /usr/bin/tini
RUN mkdir -p /data && chown 99:100 /data
WORKDIR /review-app
COPY review/ /review-app/
# The supervisor starts the Recovery worker as ../recovery/worker.mjs from /review-app/server.mjs.
COPY recovery/ /recovery/
COPY tools/migrate-recovery-registry.mjs /tools/
COPY LICENSE NOTICE /review-app/
ENV PORT=8270 DATA_ROOT=/data APP_VERSION=${APP_VERSION}
USER 99:100
EXPOSE 8270
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/usr/bin/node", "/review-app/healthcheck.mjs"]
# The supervisor runs Review and, when RECOVERY_MODE is verify or repair, Recovery (docs/ARCHITECTURE.md).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/bin/node", "/review-app/supervisor.mjs"]

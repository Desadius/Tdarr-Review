# Runtime already used by the deployed application (Node 24, Jellyfin FFmpeg).
ARG TDARR_RUNTIME_IMAGE=ghcr.io/haveagitgat/tdarr@sha256:45742f00e51a58553844c8b13d97e7ae9b2ee9a056bd8e5993d9a8282a45a23f
FROM ${TDARR_RUNTIME_IMAGE}
ARG APP_VERSION=1.10.1
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Tdarr Review" \
      org.opencontainers.image.description="Review and approve Tdarr transcodes before replacing media" \
      org.opencontainers.image.source="https://github.com/Desadius/Tdarr-Review" \
      org.opencontainers.image.documentation="https://github.com/Desadius/Tdarr-Review/tree/main/docs" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}"
USER root
RUN mkdir -p /data && chown 99:100 /data
WORKDIR /review-app
COPY review/ /review-app/
COPY LICENSE NOTICE /review-app/
ENV PORT=8270 DATA_ROOT=/data
USER 99:100
EXPOSE 8270
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["/usr/bin/node", "/review-app/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/node"]
CMD ["/review-app/server.mjs"]

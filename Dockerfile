# Runtime already used by the deployed application (Node 24, Jellyfin FFmpeg).
ARG TDARR_RUNTIME_IMAGE=ghcr.io/haveagitgat/tdarr@sha256:45742f00e51a58553844c8b13d97e7ae9b2ee9a056bd8e5993d9a8282a45a23f
FROM ${TDARR_RUNTIME_IMAGE}
WORKDIR /review-app
COPY review/ /review-app/
ENV PORT=8270 DATA_ROOT=/data
USER 99:100
EXPOSE 8270
ENTRYPOINT ["/usr/bin/node"]
CMD ["/review-app/server.mjs"]

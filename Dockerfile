ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG INKSTONE_VERSION=0.8.0
ARG INKSTONE_REVISION=unknown
ENV INKSTONE_VERSION=${INKSTONE_VERSION} \
    INKSTONE_REVISION=${INKSTONE_REVISION}
RUN npm run build:vps

FROM ${NODE_IMAGE} AS production
ARG INKSTONE_VERSION=0.8.0
ARG INKSTONE_REVISION=unknown
LABEL org.opencontainers.image.title="Inkstone VPS" \
      org.opencontainers.image.version="${INKSTONE_VERSION}" \
      org.opencontainers.image.revision="${INKSTONE_REVISION}" \
      org.opencontainers.image.source="https://github.com/chengfengy5-commits/inkstone"
ENV NODE_ENV=production \
    INKSTONE_HOST=0.0.0.0 \
    INKSTONE_PORT=7712 \
    INKSTONE_DATA_DIR=/data \
    INKSTONE_ASSETS_DIR=/app/dist/client \
    INKSTONE_VERSION=${INKSTONE_VERSION} \
    INKSTONE_REVISION=${INKSTONE_REVISION}
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
RUN install -d -o node -g node -m 0700 /data
USER node
EXPOSE 7712
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7712/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/vps/server.mjs"]

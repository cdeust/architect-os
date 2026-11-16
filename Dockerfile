# Image for a long-running component (gateway, memory, data). Build context: repository root.
#   docker build --build-arg ENTRY=gateway/dist/src/main.js -t architect-os/gateway .
# The worker has its own image: services/memory/worker/Dockerfile.
FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY data data
COPY gateway gateway
COPY services services
# The three components of this stack and what they reference, not the whole repository: the root tsconfig.json also
# names the modules, the tools and the scenarios, which are not in this image.
RUN npm ci --ignore-scripts && npx tsc -b gateway data services/memory && npm prune --omit=dev --ignore-scripts

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
ARG ENTRY
ENV NODE_ENV=production ENTRY=${ENTRY}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Run as the unprivileged "node" user; the root filesystem can be mounted read-only (nothing is written at runtime).
USER node
CMD ["sh", "-c", "exec node \"$ENTRY\""]

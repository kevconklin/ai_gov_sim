# syntax=docker/dockerfile:1
FROM node:22-slim AS build
# better-sqlite3 is a native module and node:22-slim carries no toolchain, so npm ci runs
# node-gyp and fails without these. Build stage only: the runtime stage gets the compiled
# binary through the standalone trace.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0

# Only the traced server bundle and the node_modules it reaches, not the whole build tree.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3100
CMD ["node", "server.js"]

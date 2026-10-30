# ZBoard image: web build → native deps → slim runtime with the server, web app, extension and CLI.

# 1. Build the web app.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2. Server packages (sharp ships prebuilt binaries; the toolchain covers platforms without them).
FROM node:22-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3. Runtime.
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data BACKUP_DIR=/backup
WORKDIR /app
COPY --from=deps /app/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY server/scripts server/scripts
COPY --from=web /app/web/dist web/dist
COPY extension extension
COPY cli cli
COPY .env.example ./
RUN chmod +x cli/zboard.js server/scripts/stress-test.sh && ln -s /app/cli/zboard.js /usr/local/bin/zboard \
  && mkdir -p /data /backup && chown node:node /data /backup
USER node
VOLUME ["/data", "/backup"]
EXPOSE 3000
WORKDIR /app/server
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/me').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]

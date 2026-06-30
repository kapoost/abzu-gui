# syntax=docker/dockerfile:1.7
# Bun-native abzu-gui static server. Single stage (no node_modules in runtime — only tooling).

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app

RUN addgroup -S adcp && adduser -S -G adcp -u 10001 adcp

COPY --chown=adcp:adcp package.json tsconfig.json ./
COPY --chown=adcp:adcp src ./src
COPY --chown=adcp:adcp public ./public

USER adcp

ENV PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]

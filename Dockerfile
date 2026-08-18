# syntax=docker/dockerfile:1

# ============================================================================
# QuikBoom CRM Backend — Production Docker image (NestJS + Prisma)
#
# Single `npm ci` + build, then `npm prune --omit=dev` before copying
# node_modules into the runtime stage — avoids a second install and keeps
# native/prisma binaries consistent since build and runtime share the same
# base image.
#
# openssl is required at both generate-time and runtime: Prisma's query
# engine on Alpine (musl) dynamically links libssl and fails with
# "Unable to require libquery_engine" without it.
# ============================================================================

FROM node:20-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

# ---------- Stage: install deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm ci

# ---------- Stage: build + prune to production deps ----------
FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---------- Stage: production runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["node", "dist/main"]

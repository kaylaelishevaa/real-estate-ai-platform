# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Builder
#
# Installs ALL dependencies (including devDeps), generates the Prisma client,
# compiles TypeScript, then prunes dev dependencies so the resulting
# node_modules/ is production-ready (but still contains the generated
# Prisma native binary).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached unless package*.json changes)
COPY package*.json ./
RUN npm ci

# Generate Prisma Client *before* compiling TypeScript so the generated
# types are available to the compiler.
COPY prisma ./prisma/
RUN npx prisma generate

# Copy the rest of the source and compile
COPY . .
RUN npm run build

# Prune dev dependencies in-place so we can copy a lean node_modules/
# to the production image without re-running npm install.
RUN npm prune --omit=dev


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Production
#
# Copies only what is needed at runtime:
#   dist/          — compiled JavaScript
#   node_modules/  — production deps + generated Prisma client binary
#   prisma/        — schema + migrations (used by `prisma migrate deploy`)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Copy pruned node_modules (includes .prisma/client native binary)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled application
COPY --from=builder /app/dist ./dist

# Copy Prisma schema + migrations (needed for `prisma migrate deploy` at startup)
COPY --from=builder /app/prisma ./prisma

# ── API server ────────────────────────────────────────────────────────────────
EXPOSE 3000

# Default command runs the HTTP API.
# The worker service overrides this with: node dist/worker.js
CMD ["node", "dist/main.js"]

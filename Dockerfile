# ── Build stage ──────────────────────────────────────────────────────
FROM node:22.19.0-bookworm-slim AS builder

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY packages/enterprise-protocol/package.json packages/enterprise-protocol/
COPY packages/enterprise-session-broker/package.json packages/enterprise-session-broker/
COPY packages/enterprise-worker/package.json packages/enterprise-worker/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source
COPY . .

# Build enterprise packages (protocol → broker → worker)
RUN npm run build --workspace @pi-web/enterprise-protocol
RUN npm run build --workspace @pi-web/enterprise-session-broker
RUN npm run build --workspace @pi-web/enterprise-worker

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22.19.0-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 piweb \
 && adduser --system --uid 1001 piweb

# Copy built application
COPY --from=builder --chown=piweb:piweb /app/.next/standalone ./
COPY --from=builder --chown=piweb:piweb /app/.next/static ./.next/static
COPY --from=builder --chown=piweb:piweb /app/public ./public
COPY --from=builder --chown=piweb:piweb /app/packages/enterprise-worker/dist ./packages/enterprise-worker/dist
COPY --from=builder --chown=piweb:piweb /app/packages/enterprise-protocol/dist ./packages/enterprise-protocol/dist
COPY --from=builder --chown=piweb:piweb /app/node_modules/@earendil-works ./node_modules/@earendil-works

USER piweb

EXPOSE 30141

ENV PORT=30141
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

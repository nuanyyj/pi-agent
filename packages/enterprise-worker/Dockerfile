FROM node:22.19.0-bookworm-slim AS build
WORKDIR /src
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=$NPM_CONFIG_REGISTRY
COPY package.json package-lock.json ./
COPY packages/enterprise-protocol/package.json ./packages/enterprise-protocol/package.json
COPY packages/enterprise-worker/package.json ./packages/enterprise-worker/package.json
RUN npm ci --ignore-scripts
COPY packages/enterprise-protocol ./packages/enterprise-protocol
COPY packages/enterprise-worker ./packages/enterprise-worker
RUN npm run build:enterprise-packages
RUN npm prune --omit=dev --ignore-scripts

FROM node:22.19.0-bookworm-slim
WORKDIR /opt/pi-enterprise-worker
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/enterprise-protocol/package.json ./node_modules/@pi-web/enterprise-protocol/package.json
COPY --from=build /src/packages/enterprise-protocol/dist ./node_modules/@pi-web/enterprise-protocol/dist
COPY --from=build /src/packages/enterprise-worker/package.json ./package.json
COPY --from=build /src/packages/enterprise-worker/dist ./dist
USER node
ENTRYPOINT ["node", "dist/main.js"]

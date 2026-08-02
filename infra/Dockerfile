# syntax=docker/dockerfile:1.7
FROM node:24.11.0-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm verify

FROM node:24.11.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/workspace/apps/web/dist \
    SIGN_CATALOG_PATH=/workspace/content/catalog/catalog.v1.draft.json

WORKDIR /workspace
COPY --from=build /workspace/package.json /workspace/pnpm-workspace.yaml ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/api ./services/api
COPY --from=build /workspace/services/api/node_modules ./services/api/node_modules
COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /workspace/apps/web/dist ./apps/web/dist
COPY --from=build /workspace/content/catalog ./content/catalog

USER node
EXPOSE 8080
CMD ["node", "services/api/dist/index.js"]

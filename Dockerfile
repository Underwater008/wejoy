FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/tsconfig.json ./packages/domain/
COPY apps/node/package.json apps/node/tsconfig.json ./apps/node/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html ./apps/web/
RUN npm ci

COPY packages/domain/src ./packages/domain/src
COPY apps/node/src ./apps/node/src
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build /app/packages/domain/dist ./packages/domain/dist
COPY --from=build /app/apps/node/package.json ./apps/node/package.json
COPY --from=build /app/apps/node/dist ./apps/node/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/node/dist/server.js"]

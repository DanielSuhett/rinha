FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

ENV NODE_ENV=production \
  UV_THREADPOOL_SIZE=4 \
  MALLOC_ARENA_MAX=2

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

USER nestjs

EXPOSE 8080

CMD ["node", "dist/main"]

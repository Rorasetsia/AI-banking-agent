# ModelScope 免费 Docker 实例（platform/2v-cpu-8g-mem）最小部署镜像。
# 构建：docker build -t moss-bank-preview .
# 运行：docker run --rm -p 7860:7860 -e STUDIO_HOST=<运行时域名> moss-bank-preview
# 说明：镜像内不写入任何凭据；模型密钥由运行时注入，缺失时由现有入口按 fail closed 处理。

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=7860 \
    BANK_DB_PATH=data/hosted-preview.sqlite \
    BANK_EPHEMERAL_PREVIEW=1 \
    BANK_MODEL_DAILY_LIMIT=100
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/start-hosted.mjs scripts/start-modelscope.mjs ./scripts/
RUN mkdir -p /app/data \
 && chown -R node:node /app/data
USER node
EXPOSE 7860
CMD ["node", "scripts/start-modelscope.mjs"]

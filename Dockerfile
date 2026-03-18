# 使用更小的基础镜像和多阶段构建来减少最终镜像的大小
FROM node:lts-alpine AS builder

# 设置工作目录，避免之后的 RUN 命令中需要不断地 mkdir 和 cd
WORKDIR /app

# 设置 node 环境变量为生产环境，不会安装 devDependencies
ENV NODE_ENV=production

# 复制项目依赖文件，这里优化了复制步骤，可以利用 Docker 缓存
COPY package.json pnpm-lock.yaml* ./

# 启用 corepack 并预先下载 pnpm 包管理器，减少运行时下载延迟
# 安装项目依赖，使用 --frozen-lockfile 参数确保锁文件的准确性
RUN corepack enable && corepack prepare --activate && pnpm install --prod --frozen-lockfile

# 复制项目代码到工作目录
COPY . .

# 运行阶段
FROM node:lts-alpine AS runner

# 维护信息
LABEL maintainer="wenbin https://github.com/jackbi/60s"
LABEL description="一个提供笑话、谜语等内容的 API 服务，数据来源于第三方接口，定期更新，支持国内外优先选择，使用 Node.js 和 TypeScript 编写，部署在 Docker 容器中，适合开发者和爱好者使用。"

# 设置工作目录
WORKDIR /app

# 设置 node 环境变量为生产环境，更高效地运行应用，设置时区为上海
ENV NODE_ENV=production TZ=Asia/Shanghai

# 安装 curl 用于健康检查，改进安全性，创建一个运行用户，避免以 root 用户运行
# RUN apk add --no-cache curl && \
#   addgroup -S nodejs && adduser -S nodejs -G nodejs

# 创建一个运行用户，避免以 root 用户运行
RUN addgroup -S nodejs && adduser -S nodejs -G nodejs

# 从构建阶段复制整个 app 目录
COPY --from=builder /app .

# 切换到非 root 用户
USER nodejs

# 指定暴露端口
EXPOSE 4399

# 设置健康检查指令，使用 curl 检查应用是否正常运行
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#   CMD curl --silent --fail http://127.0.0.1:4399/health -H 'User-Agent: Docker Health Check' || exit 1

# 运行应用
CMD ["node", "node.ts"]

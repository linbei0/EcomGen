FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# better-sqlite3 在 Linux 构建阶段需要 node-gyp 的 Python 和 C/C++ 工具链。
# apt 源沿用基础镜像默认配置；重试用于应对临时网络抖动。
RUN apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8787
CMD ["node", "apps/api/dist/server.js"]

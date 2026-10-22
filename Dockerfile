# 主题下载只在 /etc/os-release 含 alpine 时写入 data/templates（见 theme.ts）。
# 用 Alpine 才能让用户主题落在数据卷上，容器重建不会丢掉。
# better-sqlite3 要求 Node >= 22；本机是 Node 24，构建和运行用同一主版本，避免原生模块 ABI 不一致。
FROM node:24-alpine AS build

# 原生模块在这一阶段编译。运行阶段不再带这些包。
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 构建要用全部依赖。产物出来后再按 lockfile 只装生产依赖，
# 这样运行镜像不带本项目的 devDependencies。
RUN npm run build \
	&& npm ci --omit=dev

FROM node:24-alpine

WORKDIR /app

# adapter-node 6 默认就是 0.0.0.0:3000，这里写明，方便运行时覆盖。
# 它不读取 ORIGIN。vite 未设置 paths.origin 时，来源从请求 Host 推导，协议默认 https。
# 不在镜像里写死域名。
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000

RUN addgroup -g 1001 -S onenav \
	&& adduser -S -u 1001 -G onenav onenav

COPY --from=build --chown=onenav:onenav /app/package.json ./package.json
COPY --from=build --chown=onenav:onenav /app/node_modules ./node_modules
COPY --from=build --chown=onenav:onenav /app/build ./build
COPY --chown=onenav:onenav db ./db
COPY --chown=onenav:onenav templates ./templates
COPY --chown=onenav:onenav version.txt ./version.txt

# 空目录交给卷。不在构建时生成 data/onenav.db3，缺库时由 ensureDatabaseFile 从种子库复制。
RUN mkdir -p /app/data \
	&& chown onenav:onenav /app/data

USER onenav

VOLUME /app/data
EXPOSE 3000

# 用镜像里的 node 访问本机首页。超时 5 秒，间隔 30 秒。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{signal:AbortSignal.timeout(4000)}).then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "build"]

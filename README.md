# OneNav

OneNav 是书签导航，用 SvelteKit 实现。容器里的启动命令是 `node build`。

## 本地开发

使用 Node 24，与 `Dockerfile` 的 `node:24-alpine` 一致。`package.json` 没有 `engines`。镜像注释写明 better-sqlite3 需要 Node 22 及以上；构建和运行都用 Node 24，避免原生模块 ABI 不一致。

```bash
npm install
npm run dev
```

开发服务器地址以终端输出为准。还没有 `data/config.json` 时，打开站点会转到 `/install`。登录页是 `/login`，后台是 `/admin`。

## 配置

没有用户表。账号在 `data/config.json`，运行时只读这个文件：

```json
{
  "username": "name",
  "encrypted_password": "摘要",
  "email": "you@example.com"
}
```

`encrypted_password` 是 `md5(用户名 + 密码)` 的十六进制摘要，用户名和密码直接拼接。`/install` 要求用户名 3–32 位小写字母或数字，密码 6–16 位，字符为数字、字母和 `!@#%^*.()`。

只剩 `data/config.php`、还没有 JSON 时，读取配置会用正则取出 `USER`、`ENCRYPTED_PASSWORD`、`EMAIL`，写成 `data/config.json`。三个字段核对一致后删除 PHP 文件。核对失败时保留 `data/config.php`。已经存在的 `data/config.json` 保持原样。程序只解析这三个常量，不执行 PHP。

`data/config.json` 和 `data/config.php` 留在本机，不要提交。

## 数据

书签库是 `data/onenav.db3`。这个文件不存在时，才从 `db/onenav.simple.db3` 复制；已有库不会覆盖。镜像构建时不生成 `data/onenav.db3`。`data/onenav.db3` 是运行时数据，不要提交。

## Docker

本地构建并运行：

```bash
docker build -t onenav .
docker run -d --name onenav \
  -p 3000:3000 \
  -v /你的数据目录:/app/data \
  onenav
```

使用已发布镜像：

```bash
docker pull ghcr.io/zeroornull/onenav:latest
docker run -d --name onenav \
  -p 3000:3000 \
  -v /你的数据目录:/app/data \
  ghcr.io/zeroornull/onenav:latest
```

容器监听 `0.0.0.0:3000`（可用环境变量 `HOST`、`PORT` 覆盖）。`-p` 左边是本机端口，可以改；右边保持 3000。数据卷是 `/app/data`，配置和数据库都在这里。进程以用户 `onenav`（uid 1001）运行，挂载目录需要它能写。

推送到 `refactor/svelte` 或 `main` 时，`.github/workflows/image.yml` 构建 `linux/amd64` 和 `linux/arm64`，并推送 `ghcr.io/zeroornull/onenav:latest` 和当次 commit 的标签。这个 workflow 也可以手动触发。

## 其它

后台仍保留订阅、升级、主题、SQL 和 AI 检索。下载的主题写到数据卷里的 `data/templates`；现在的首页是 Svelte 页面。`db/sql/*.sql` 由 `exe_sql` 按文件名执行。AI 检索接口是 `ai_search`。

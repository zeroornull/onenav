# AGENTS

- 全程使用中文输出，包括分析、进度说明、变更说明、提交信息建议；不要默认切回英文。

## 入口

- 真实入口是 SvelteKit。生产镜像用 Dockerfile 里的 `node build`，开发是 `npm run dev`。
- 不要从 README 或已经删除的 `index.php` 猜流程。仓库里没有 PHP 入口。
- 旧地址 `/index.php?c=` 由 `src/hooks.server.ts` 调用 `src/lib/legacy-redirect.ts`，301 到现有路由。控制器名带 `./` 或 `..` 时不跳转。
- 缺 `data/onenav.db3` 时才从 `db/onenav.simple.db3` 复制，已有库文件不要覆盖。

## 账号

- 运行时只读 `data/config.json`。字段是 `username`、`encrypted_password`、`email`。
- 读配置时，若 json 不存在而 `data/config.php` 存在，用正则取出 `USER`、`ENCRYPTED_PASSWORD`、`EMAIL` 写进 json。密码摘要原样保留，不要改成 bcrypt，也不要改 cookie 算法。
- 写入后三个字段一致才删除 `data/config.php`。核对失败不删 php，也不覆盖已有 json。
- 两个文件都不存在时不要编造账号。
- `data/config.php` 和 `data/config.json` 都在 `.gitignore` 里。不要提交，不要覆盖 `data/onenav.db3`。
- 只解析，不执行 PHP。

## 关键目录

- 页面在 `src/routes/`，API 业务在 `src/lib/server/api/methods/`。
- 登录态、主题枚举、移动端判断在 `src/lib/server/`。后台页面在 `src/routes/admin/`，交互在 `src/lib/components/admin/`。
- 内置首页就是现在的 Svelte 页面，不读取 `templates/`。用户下载的主题只写数据卷 `data/templates`。
- `db/onenav.simple.db3` 是初始化种子库。`db/sql/*.sql` 留给 `exe_sql` 按文件名执行，是数据库迁移脚本，不是 PHP，要留在仓库里。

## 认证

- 登录态不是 session，而是 `key` cookie。值是 `md5(USER + ENCRYPTED_PASSWORD + onenav + User-Agent)`。
- API 鉴权：`token=md5(USER + SecretKey)` 或请求头 `X-Token`。没传 token 时退回 cookie。
- 后台用同一套 cookie 判断。

## 验证

- `npm run check` 必须是 0 error。
- 路由和接口用 `npx tsx scripts/verify-*.ts`。这些脚本用临时库，不要对现网 `data/onenav.db3` 执行 SQL、升级或导入。

# OneNav

OneNav is a bookmark navigation site, implemented with SvelteKit. The container start command is `node build`.

## Local development

Use Node 24, the same as `node:24-alpine` in the `Dockerfile`. `package.json` has no `engines` field. The image comment says better-sqlite3 requires Node 22 or newer. Build and runtime both use Node 24 so the native-module ABI stays the same.

```bash
npm install
npm run dev
```

The development server address is whatever the terminal prints. When `data/config.json` is missing, opening the site goes to `/install`. The login page is `/login`, and the admin area is `/admin`.

## Configuration

There is no user table. The account is in `data/config.json`. At runtime the program reads only this file:

```json
{
  "username": "name",
  "encrypted_password": "digest",
  "email": "you@example.com"
}
```

`encrypted_password` is the hexadecimal digest of `md5(username + password)`, with the username and password concatenated directly. `/install` requires a username of 3–32 lowercase letters or digits, and a password of 6–16 characters from digits, letters, and `!@#%^*.()`.

When only `data/config.php` is left and the JSON file is missing, reading the config extracts `USER`, `ENCRYPTED_PASSWORD`, and `EMAIL` with a regular expression and writes `data/config.json`. The PHP file is deleted after those three fields match. If the check fails, `data/config.php` is kept. An existing `data/config.json` is left unchanged. The program only parses these three constants. It does not run PHP.

Keep `data/config.json` and `data/config.php` on the machine. Do not commit them.

## Data

The bookmark database is `data/onenav.db3`. The file is copied from `db/onenav.simple.db3` only when it is missing. An existing database is not overwritten. The image build does not create `data/onenav.db3`. `data/onenav.db3` is runtime data. Do not commit it.

## Docker

Build and run locally:

```bash
docker build -t onenav .
docker run -d --name onenav \
  -p 3000:3000 \
  -v /your/data/directory:/app/data \
  onenav
```

Use the published image:

```bash
docker pull ghcr.io/zeroornull/onenav:latest
docker run -d --name onenav \
  -p 3000:3000 \
  -v /your/data/directory:/app/data \
  ghcr.io/zeroornull/onenav:latest
```

The container listens on `0.0.0.0:3000` (override with the `HOST` and `PORT` environment variables). The left side of `-p` is the host port and can be changed; keep `3000` on the right. The data volume is `/app/data`. Configuration and the database are both there. The process runs as user `onenav` (uid 1001), so the mounted directory must be writable by that user.

A push to `refactor/svelte` or `main` makes `.github/workflows/image.yml` build `linux/amd64` and `linux/arm64`, then push `ghcr.io/zeroornull/onenav:latest` and a tag for that commit. The workflow can also be started manually.

## Other

The admin area still has subscription, upgrade, themes, SQL, and AI search. Downloaded themes are written to `data/templates` on the data volume, and the homepage is a Svelte page; `db/sql/*.sql` is run by `exe_sql` by filename, and the AI search API is `ai_search`.

## 6. 本地开发与部署（Phase 1–2）

### 6.1 依赖与版本

项目依赖见 `package.json`：
- Next.js 14（App Router）
- Prisma + Postgres
- NextAuth v4
- Zod
- Tailwind + shadcn/ui

Node 版本：
- README 里写的是 Node 18+（可运行）
- 你的本机实际是 Node v25（也可运行，但团队建议统一 LTS：Node 20/22）

### 6.2 环境变量

模板：`env.example`

本地使用：

1) 复制：
```bash
cp env.example .env
```

2) 编辑 `.env`：
- **DATABASE_URL**（Postgres 连接串）
- **NEXTAUTH_URL**（本地 `http://localhost:3000`）
- **NEXTAUTH_SECRET**（必须）
- **XAI_API_KEY**（必须）
- **XAI_BASE_URL**、**XAI_MODEL**（可选，默认已提供）

> 注意：`.env` 已在 `.gitignore` 里忽略，绝对不要提交到 repo。

### 6.3 初始化数据库

确保本地 Postgres 已启动，且创建数据库：

```sql
CREATE DATABASE goalflow;
```

Prisma 初始化：

```bash
npm run db:generate
npm run db:push
```

可选：
- `npm run db:studio` 打开 Prisma Studio

### 6.4 启动开发服务

```bash
npm install
npm run dev
```

访问：
- `http://localhost:3000`

### 6.5 MVP 验证路径（Phase 1–2）

1) 打开 Landing
2) 注册用户：`/auth/signup`
3) 登录：`/auth/signin`
4) Dashboard：`/dashboard`
5) Create Goal：`/goals/create`
   - 输入一个 goal title
   - 系统会调用 `/api/goals/analyze` 生成 3–5 个问题
   - 回答完后调用 `/api/goals/create` 创建 goal + 计划
6) 自动跳转 Goal Detail：`/goals/:id`

### 6.6 部署（MVP 指南）

Phase 1–2 主要是 Web + DB + LLM：

- 部署到 Vercel（推荐）：
  - 配置环境变量（同 `.env`）
  - Postgres 可用 Neon/Supabase/Railway
  - 注意：Vercel Serverless 环境下 Prisma 的连接管理（目前 `lib/prisma.ts` 已做 dev 缓存）

后续 Phase 3–4（邮件+定时任务）才会引入：
- Resend/Postmark
- Vercel Cron（替代本地 node-cron）
- OneTimeToken 的落地页


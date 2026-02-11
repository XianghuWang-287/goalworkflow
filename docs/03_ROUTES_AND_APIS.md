## 3. 路由与 API（App Router）

### 3.1 页面路由（`app/**`）

- **Landing**：`GET /`
  - 文件：`app/page.tsx`
  - 内容：产品介绍 + 登录/注册入口

- **注册**：`GET /auth/signup`
  - 文件：`app/auth/signup/page.tsx`
  - 依赖 API：`POST /api/auth/signup`

- **登录**：`GET /auth/signin`
  - 文件：`app/auth/signin/page.tsx`
  - 依赖 NextAuth：`signIn("credentials")`

- **Dashboard**：`GET /dashboard`（需登录）
  - 文件：`app/dashboard/page.tsx`
  - 行为：Server Component，通过 `getServerSession()` 校验登录；查询 `Goal` 列表

- **创建 Goal（含问答）**：`GET /goals/create`（需登录）
  - 文件：`app/goals/create/page.tsx`（Client Component）
  - 两步流程：
    - Step1：`POST /api/goals/analyze` 得到问题
    - Step2：回答完后 `POST /api/goals/create` 创建 goal+plan

- **Goal 详情**：`GET /goals/:id`（需登录）
  - 文件：`app/goals/[id]/page.tsx`
  - 行为：查询 `Goal`（含 active plan、tasks、checkins、eventLogs、weeklyReviews），渲染：
    - Today tasks
    - Plan Overview（Day 卡片含 checkin 状态指示：✓ done / ◐ partial / ✗ missed）
    - Phase 进度条
    - Plan Version History
    - Recent check-ins
    - Timeline
    - Weekly Reviews 历史卡片（展示过往 review 的 metrics/wins/blockers/chosen option）
    - Weekly Review 按钮：
      - 当前周所有天已过去且都有 checkin 时显示
      - 有 pending review 时显示"Continue Review"（直接跳转，不重复生成）
      - review 已完成（chosenOption 已选）后隐藏

- **Authenticated Weekly Review**：`GET /goals/:id/review`（需登录）
  - 文件：`app/goals/[id]/review/page.tsx`（Client Component）
  - 行为：GET `/api/weekly-review?goalId=xxx` 获取最新 review，显示 metrics/wins/blockers + 三选项
  - 选择后 PATCH `/api/weekly-review` 提交 → 生成新 plan → 跳转回 goal detail

- **Token Checkin**：`GET /checkin/:token`
  - 文件：`app/checkin/[token]/page.tsx`
  - 行为：通过邮件链接 token 完成 checkin，无需登录

- **Token Weekly Review**：`GET /review/:token`
  - 文件：`app/review/[token]/page.tsx`
  - 行为：通过邮件链接 token 查看 review + 选择下周方案，无需登录

### 3.2 API 路由（`app/api/**`）

#### Auth

1) `POST /api/auth/signup`
- 文件：`app/api/auth/signup/route.ts`
- 入参（JSON）：
  - `name: string`
  - `email: string`
  - `password: string`（>=6）
- 出参：
  - 201：`{ message, userId }`
  - 400：`{ error }`（缺字段/密码短/邮箱已注册）
  - 500：`{ error }`
- 副作用：
  - 写 `User`（`password` 使用 bcrypt hash）

2) `GET|POST /api/auth/[...nextauth]`
- 文件：`app/api/auth/[...nextauth]/route.ts`
- NextAuth handler（credentials provider）
- 关键配置：
  - `lib/auth.ts`：`session.strategy = "jwt"`
  - 登录校验：查询 `User` 后 `bcrypt compare`

#### Goals

1) `POST /api/goals/analyze`
- 文件：`app/api/goals/analyze/route.ts`
- 目的：根据用户输入 goal title/category，生成 3–5 个澄清问题（含建议选项），以降低用户思考成本并提升计划质量。
- 入参：
  - `title: string`（required）
  - `category?: string`
- 出参（`GoalAnalysis`）：
  - `goalType: "simple_habit" | "learning" | "complex"`
  - `needsMoreInfo: boolean`
  - `questions?: Array<{ question, type, field, suggestions?, placeholder? }>`
  - `estimatedQuestions?: number`
- 当前鉴权：
  - **无 session 校验**（可以考虑改为 require login，防滥用与计费风险）

2) `POST /api/goals/create`
- 文件：`app/api/goals/create/route.ts`
- 目的：创建 Goal，并用 LLM 自动生成 7 天计划，落库 Plan/Task，写 EventLog。
- 入参：
  - `title: string`（required）
  - `category?: string`
  - `answers?: Record<string,string>`（来自问答组件）
- 鉴权：
  - 必须登录（`getServerSession()`）
- 处理步骤：
  1. `extractGoalSpec(goalSpecInput)`：LLM + Zod（失败重试 2 次）结构化 GoalSpec
  2. 创建 `Goal`
  3. `generatePlan(goalSpec, startDate)`：LLM + Zod（失败重试 2 次）生成 Plan（习惯类更简化）
  4. 创建 `Plan`
  5. 按天按任务展开创建 `Task`
  6. 创建 `EventLog`：`goal_created`
- 出参：
  - 201：`{ goalId, message }`
  - 401：`{ error: "Unauthorized" }`
  - 400：`{ error }`
  - 500：`{ error }`

### 3.3 新增 API 路由（Phase 3-5）

#### Checkin

1) `POST /api/checkin`（需登录）
- 文件：`app/api/checkin/route.ts`
- 入参：`{ goalId, status: "done"|"partial"|"missed", note? }`
- 行为：创建 Checkin 记录

2) `POST /api/checkin/token`（Token 鉴权）
- 文件：`app/api/checkin/token/route.ts`
- 入参：`{ token, status, note? }`
- 行为：验证 token → 创建 Checkin

#### Weekly Review

1) `POST /api/weekly-review`（需登录）
- 生成新的 weekly review（AI 分析 checkin 数据 → metrics/wins/blockers/options）

2) `GET /api/weekly-review?goalId=xxx`（需登录）
- 获取最新 weekly review

3) `PATCH /api/weekly-review`（需登录）
- 入参：`{ goalId, optionIndex: 0|1|2 }`
- 行为：选择下周方案 → 调整 GoalSpec → 生成新 Plan → supersede 旧 Plan → 创建 Tasks → 发放 Badges

4) `GET /api/weekly-review/token?token=xxx`（Token 鉴权）
- 验证 token + 返回 review 数据

5) `POST /api/weekly-review/token`（Token 鉴权）
- 入参：`{ token, optionIndex }`
- 行为：同 PATCH，但通过 token 鉴权

#### Badges / Profile / Tokens / Cron

- `GET /api/badges?goalId=xxx` — 查询徽章
- `GET|PUT /api/profile` — 用户画像 CRUD
- `POST /api/tokens` — 生成 one-time token
- `POST /api/cron/daily-email` — Cron: 发送每日 checkin 邮件
- `POST /api/cron/weekly-review` — Cron: 触发每周 review 邮件

### 3.4 UI 组件与交互

- Navbar：`components/navbar.tsx`
  - 使用 `useSession()` 判断登录态
  - 登录态：显示 Dashboard + email + Sign out
  - 未登录：显示 Sign in / Sign up

- Goal 问答组件：`components/goal-questions.tsx`
  - 输入：`questions[]`
  - 行为：逐题展示（Question i / N）
  - 支持：
    - `select`：按钮建议选项 + “自定义输入”
    - `text` / `number`：输入框
  - 输出：`answers: Record<string,string>`


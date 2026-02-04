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
  - 行为：查询 `Goal`（含 active plan、tasks、checkins、eventLogs），渲染：
    - Today tasks
    - 7-Day Plan
    - Week overview
    - Recent check-ins
    - Timeline

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

### 3.3 UI 组件与交互

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


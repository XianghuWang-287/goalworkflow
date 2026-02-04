## GoalFlow 开发技术文档索引

这套文档面向**接手开发 / 部署运维 / 二次开发**，覆盖：架构、数据模型、路由/API、LLM/xAI 约束与 JSONGuard、Goal→问答→计划生成链路、UI 页面、运行与排错。

### 快速入口

- `docs/01_ARCHITECTURE.md`：整体架构、端到端链路、关键设计决策
- `docs/02_DATA_MODEL_PRISMA.md`：Prisma 数据模型解释（表/关系/字段用途）
- `docs/03_ROUTES_AND_APIS.md`：Next.js App Router 页面路由 + API 路由（入参/出参/鉴权/副作用）
- `docs/04_LLM_XAI_AND_JSON_GUARD.md`：xAI 调用封装、严格 JSON、Zod 校验、重试与 fallback
- `docs/05_GOAL_QA_FLOW.md`：Goal Analyzer 问答流程（问题结构、建议选项、答案如何合并进 GoalSpec）
- `docs/06_LOCAL_DEV_AND_DEPLOYMENT.md`：本地启动、数据库初始化、环境变量、部署注意事项（MVP）
- `docs/07_TROUBLESHOOTING.md`：常见报错与定位路径（含你遇到的 `constraints.join`）


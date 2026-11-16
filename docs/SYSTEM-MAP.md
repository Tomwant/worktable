# 系统逻辑清单（改动前必读）

> 用途：动手改任何功能前先扫这份清单，确认「这个数据该落在哪个页面 / 哪张表 / 哪个接口」。
> 2026-10-22 因为没区分「每日发现」和「知识库」的职责，把 67 期完整报告塞进了灵感列表，返工一次。

---

## 一、模块职责边界（最容易搞错的地方）

| 页面 | 承载什么 | 明确不放什么 |
|---|---|---|
| **工作台** `home` | 今日问候、进度环、近 7 天趋势、连续天数、知识沉淀计数 | —— |
| **计划打卡** `checkin` | 年计划 → 月计划 → 打卡项 → 每日打卡记录 | —— |
| **资金管理** `finance` | 收支流水、期初余额、月度预算 | —— |
| **每日发现** `discover` | **零散灵感碎片**：刷到的一句话、一个观点、一条链接，手动录入为主 | ❌ 完整报告 / 长文 / 定时任务产出的成期内容 |
| **知识库** `knowledge` | **完整报告归档**：定时任务产出的 HTML / Markdown 成期内容、导入的外部 HTML 报告（图文混排） | ❌ 一句话灵感（那是每日发现） |
| **脑图** `mindmap` | 由计划数据实时生成的可视化，不落库 | —— |

**判定口诀**：有文件名、有期号、几十 KB、自带排版 → 知识库；一句话、一条链接、手动敲的 → 每日发现。

---

## 二、数据表（全部 MyISAM，无崩溃恢复）

| 表 | 行数量级 | 归属模块 | 关键字段 |
|---|---|---|---|
| `year_plans` | 3 | 计划打卡 | id, year, name, category, description |
| `month_plans` | 4 | 计划打卡 | id, year_plan_id（绑年计划，年度累计靠这个）, year, month |
| `check_tasks` | 4 | 计划打卡 | id, month_plan_id, name, category |
| `daily_checkins` | 7 | 计划打卡 | id, check_date, items_json（每项 isFinish / note） |
| `categories` | 8 | 全局 | name（唯一列） |
| `transactions` | 0 | 资金 | id, type(income/expense), amount, record_date |
| `finance_config` | 1 | 资金 | id=1, opening_balance, month_budget |
| `knowledge_entries` | 0 | **知识库** | id, source(ENUM checkin/discover/**import**), source_label, source_id, title, content(纯文本), origin_date, **attachment_url**, attachment_type |
| `daily_discovers` | 67 → 待清 | **每日发现** | id, record_date, title, source, series, period, link, content, tags_json |

**知识库附件约定**：原稿落盘 `server/uploads/knowledge/<id>.html`，`attachment_url = /uploads/knowledge/<id>.html`，前端用 `<iframe sandbox="">` 预览。删除条目时同时删该文件。

---

## 三、后端接口

| 接口 | 做什么 | 是否参与全量 PUT |
|---|---|---|
| `GET /api/state` | 返回除「每日发现 / 知识库正文 / 资金」外的业务数据 | —— |
| `PUT /api/state` | 全量重建：`year_plans / month_plans / check_tasks / daily_checkins / categories` | 是（**只碰这 5 张**） |
| `DELETE /api/state` | 清空全部业务数据（危险） | —— |
| `GET/POST /api/discovers` | 列表（只回摘要）/ 单条写入（幂等键：日期+标题+来源） | 否 |
| `GET/DELETE /api/discovers/:id` | 取全文 / 删单条 | 否 |
| `POST /api/discovers/sync` | 手动触发产出目录同步 | 否 |
| `GET/POST/DELETE /api/transactions` | 资金流水 | 否 |
| `GET/PUT /api/finance` | 期初余额 / 月预算 | 否 |
| `GET /api/knowledge` | 知识库列表（含正文与附件地址） | 否 |
| `POST /api/knowledge/import` | 导入 HTML 报告（同名同日期 409，`force:true` 放行） | 否 |
| `DELETE /api/knowledge/:id` | 删条目 + 清理原稿文件 | 否 |

**红线**：全量 `PUT /api/state` 只重建上面 5 张表。任何新模块都必须走独立接口，否则它的数据会被任何一次全量保存抹掉。

---

## 四、前端数据流

- `src/stores/index.js` → `db`（reactive）+ `pushSync()`（400ms 防抖 → 写 localStorage + PUT /api/state）
- `initApi()`：先 `GET /api/state`，再 `loadKnowledge()`、`loadDiscovers()` 补独立模块
- `localOnly(fn)`：改 `db` 但跳过 `pushSync`（用于独立接口模块，避免多余的全量 PUT）
- `src/stores/domain.js`：业务方法（`saveYear` / `saveCheckin` / `saveDiscover` …）
- `src/stores/ui.js`：纯展示派生（问候语、进度环）
- 视觉唯一来源：`src/style.css`（Vue 组件模板里不写样式）

**LLM 渲染**：`src/utils/markdown.js`（`renderMarkdown` / `looksLikeHtml`），`DiscoverReader.vue` 有现成的「HTML 走 iframe / Markdown 走 v-html」双分支，可复用。

---

## 五、定时任务链路（2026-10-22 重建）

三个 WorkBuddy 自动化，产出落在 WorkBuddy 自己的目录，**任务本身只负责写文件，不调接口**：

| 任务 | 产出目录 | 格式 | 命名 |
|---|---|---|---|
| 金融概念 8:30 | `C:/Users/LEGION/WorkBuddy/automation-2026-09-09-23-33-35` | HTML | `金融概念_第NN期_主题_YYYY-MM-DD.html` |
| 概率学 8:30 | `…/automation-2026-09-09-23-36-48/概率学每日推送` | Markdown | `YYYY-MM-DD_第N期_主题.md` |
| 实时新闻 9:00 | `…/automation-2026-09-09-23-38-42/outputs` | HTML | `美股每日新闻简报_YYYY-MM-DD.html` |

- 后端 `syncOutputs()` 启动扫一次 + 每 5 分钟（`OUTPUT_POLL_MS`）跟一次
- 幂等键：`source_label + source_id（文件名）`；内容长度没变就跳过写库
- 新闻文件名无期号 → 按日期升序自动编号
- 目录可用 `.env` 覆盖：`OUTPUT_DIR_FINANCE` / `OUTPUT_DIR_PROBABILITY` / `OUTPUT_DIR_NEWS`
- `D:/spring-workbench/inbox/*.json` 收件箱机制保留，作为手动投递备选（写 `daily_discovers`）

---

## 六、环境与红线

- 端口：后端 3001；前端 `vite` 自动从 5173 起，被占就递增（5173 常年被「门店管理」项目占着，工作台实际在 5174）
- 品牌名唯一来源：`app.config.json`
- 不可改：localStorage key `spring-workbench-v2`、库名 `spring_workbench`
- 测试一律用实机（真实库 / 真实目录 / 用户自己的端口），只有不可逆覆盖前才先备份
- 批量删除前先列明细（路径 + 大小 + 是什么），等用户点头

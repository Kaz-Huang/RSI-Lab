# RSI LAB — Cloudflare 自进化网站 MVP

线上控制台：https://rsi-lab.kaz-1a8.workers.dev/

实际被改进的阅读页：https://rsi-lab.kaz-1a8.workers.dev/site

管理密钥在本机 `ADMIN-ACCESS.txt`，不提交到版本库。首次打开控制台输入密钥即可，登录有效期 12 小时。

`blueprint/index.html` 是项目的独立方案演示页面。它只展示设计思路和模拟数据，不连接自进化 Worker；运行网站源码见本仓库根目录。

## 已实现

- Cloudflare Worker 托管控制台、阅读页和 API，D1 持久保存真实状态。
- 每天北京时间 03:00（`0 19 * * *` UTC）观察一次；支持手动运行。
- 已开启自动驾驶：Cron 或手动触发会自动完成提案、门禁和发布，不等待人工审批；管理入口只用于监控、暂停和回滚。
- 每次唤醒都把当前版本、运行记录和失败记忆交给 Workers AI（`@cf/meta/llama-3.3-70b-instruct-fp8-fast`）生成新的视觉方向；模型不可用或输出不合规时，使用基于当前状态和请求标识的程序生成器，不回到预写的主题序列。
- 读取实际线上样式配置，以 WCAG 相对亮度公式检查正文对比度，以固定产品规则检查字号、行高。
- 每轮可以发布一套完整的视觉方向；固定评测检查设计词汇、可读性底线和页面稳定性，让改版有明显差异而不是只做像素级微调。
- 候选有基线、差异、检查结果、前后真实页面预览、版本和时间记录。
- 自动门禁通过后即时切换网站样式配置；日常发布不需要管理员审批。
- 每次自动发布前重新检查暂停开关、基线版本与固定评测；一次唤醒最多发布一个改动。
- 每个正式发布版本会在 D1 中保留完整设计配置；GitHub Actions 每 5 分钟读取公开的已发布版本快照，并为每个尚未归档的版本单独 commit + push 到 `evolution/releases/`。失败轮次和无变化轮次不会产生提交；同步不需要把 GitHub 写入密钥存进 Cloudflare。
- 回滚最近一次正常发布，保留全部历史，暂停自动运行和发布。
- 拒绝/回滚记忆阻止同一参数再次提案；全部达标或剩余候选被阻止时记为“不改”。
- 操作审计、证据 JSON 导出；页面请求按日期和版本聚合，不存 IP 或访客标识。
- 使用 D1 revision 的 compare-and-swap 原子提交版本、运行、记忆与审计；并发冲突重新读取检查。手动请求带幂等键，Cron 按 UTC 日期去重。
- 管理端需密钥；HttpOnly/SameSite Cookie、生产 Secure、请求 Origin 校验、请求大小限制、输出转义。

## MVP 边界

这是**规则驱动的受控自动进化闭环**，不是大模型自主代码 Agent，也没有证明递归自改进收益。

基线正文颜色沿用提案的 `#86927a`，字号 12px；阅读页白色背景，颜色对比度约 3.28:1。自动驾驶不会按预写顺序轮换主题：每一轮根据当前配置、历史运行和失败记忆生成一套新的布局、颜色、字体、留白和视觉文案。优先使用 Workers AI，失败时由确定性的状态种子生成独特候选；旧版本中的固定主题只作为兼容渲染词汇，不是未来路线。字号 16px、行高 1.8 是可读性底线，不声称它们是 WCAG 的强制值。

本版把进化范围限制为真实页面渲染器允许的设计令牌：颜色、布局、字体、字号、行高、圆角、留白、内容宽度和视觉区文案；页面正文内容、业务逻辑、数据库结构、调度和规则不能由引擎修改。生成器与评测器在不同模块；它们仍在同一个 Worker 信任域，并非独立安全沙箱。

无需长时生成/构建任务，所以当前用有原子状态转移的短执行 Cron，未启用 Workflows、R2 或隔离 CI。控制台显示的是实际配置计算与工程记录，不是浏览器性能、用户转化或模型成本的假数据。页面请求量包含重复访问与机器人，不代表 UV。

固定保留上限 200 轮；到达后自动暂停以避免单行状态无限增长，不静默删除历史。系统遇到门禁异常时也会保持原版本并记录 `auto_reject`；管理员只在需要查看证据、主动暂停或回滚时介入。外部反馈、任意站点导入、图片素材库、A/B 测试、CI 验证和模型策略迭代尚未实现。

## 本地运行

需要 Node.js 22+ 与 pnpm。已锁定依赖版本。

```sh
pnpm install
# 创建 .dev.vars，写入仅本地使用的 ADMIN_KEY=随机密钥
pnpm db:local
pnpm dev
```

打开 http://localhost:8787/ 。本地数据与线上 D1 分离。交付时 `.dev.vars` 使用明显标记为测试用途的密钥，不要上传该文件或用于线上。

```sh
pnpm build
pnpm test
pnpm exec wrangler deploy --dry-run
```

测试覆盖人工兼容链路、动态视觉方向、Workers AI 模拟输出、自动发布、遗留待审批候选接管、自动拒绝、自动暂停和回滚；另用真实本地 Workers/D1 运行 API 集成测试，覆盖认证、跨站请求拦截、并发自动运行、自动发布、真实页面样式变化和回滚。

## 部署与维护

生产 Worker 使用专属的 `rsi-lab` 和 `rsi-lab-mvp`，没有修改其他项目。源码中的配置可继续用 Wrangler 部署；部署会保留 `ADMIN_KEY` Secret 并注入 D1 与 Workers AI：

```sh
pnpm exec wrangler login
pnpm db:remote
# 仅首次部署或轮换密钥时设置，不要把密钥放在命令参数、源码或网页 URL 中
pnpm exec wrangler secret put ADMIN_KEY
pnpm deploy
```

`/health` 返回服务健康信息。管理页的“导出证据”包含全部实验记录与版本配置，不包含密钥。生产密钥轮换后旧会话自动失效；常规退出只清除当前浏览器 Cookie。自动驾驶开启后，Cron 或手动触发都会经过同一套自动门禁；首轮遗留候选会在下一次触发时自动接管。生产环境仍保留紧急暂停和回滚入口。

GitHub Actions 使用仓库内置的 `GITHUB_TOKEN`，权限限制为 `contents: write`；版本同步只公开设计配置、版本号、发布时间和改版理由，不导出运行记忆或审计记录。Actions 定时任务可能受 GitHub 排队影响，因此提交通常在发布后的几分钟内出现。若仓库停用 Actions 或关闭工作流写权限，自动归档会暂停；启用工作流或恢复权限后可手动运行 `Record live site releases` 补齐遗漏版本。

回滚的是阅读页配置，不回滚 Worker 代码，也不会删除 D1 历史。代码回退用 Cloudflare Workers 的版本回退功能；与业务数据恢复分开处理。

## 后续阶段

1. 增加第二个模型提供方和离线模型评测，比较生成方向的长期质量与成本。
2. Workflows 编排隔离 CI，R2 保存截图与浏览器报告，用签名回调和候选哈希绑定证据。
3. 接入脱敏真实观测与用户反馈，设定主指标与样本量。
4. 冻结留出集，以相同预算比较有记忆和无记忆策略，保留负向与不确定结果。

技术参考：[Workers 最佳实践](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)、[D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

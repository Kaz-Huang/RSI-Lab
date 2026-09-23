# RSI LAB 项目方案

`index.html` 是独立的单文件方案演示，指标和流程数据均为演示内容。它与根目录的 Cloudflare Worker 应用分开部署。

在仓库根目录运行以下命令可单独发布此静态页面：

```sh
pnpm exec wrangler deploy blueprint --config blueprint/wrangler.jsonc
```

部署后页面入口为 `/`。

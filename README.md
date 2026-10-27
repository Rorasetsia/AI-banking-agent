# 小苔 · AI Banking Agent 预览版 v0.8.3

面向指导老师和同学的独立模拟银行，支持自然语言任务、条件确认、储蓄规划、预算可行性和风险问卷衔接。本分支仅包含可部署网页源码，不包含原小程序、本机账户、API密钥或开发记录。

[点击部署到 Render（登录后确认 Free）](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FRorasetsia%2FAI-banking-agent%2Ftree%2Fcodex%2Fpreview-v0.8.3)

1. 登录 Render，核对分支 `codex/preview-v0.8.3`、Blueprint 路径 `render.yaml`。
2. 唯一服务为 Free Web Service，无磁盘、无外部数据库。配置 `DEEPSEEK_API_KEY`，密钥仅填 Render 的受保护环境变量，不提交 GitHub。
3. 点击 Deploy；Live 后把该服务实际生成的 `https://…onrender.com` 发给试用者。GitHub 地址不是试用网页。

配置自动采用 Node 24、新加坡、`npm ci --no-audit --no-fund && npm run build` 构建和 `node scripts/start-hosted.mjs` 启动，健康检查 `/api/health`。不需要购买域名，不依赖开发者电脑开机。

## 试用条件

每个浏览器自动开启独立模拟会话，合成初始余额 ¥28,650.42。可以先输入“我今年要攒十万块”，按提示补充收入、支出；需要理财匹配时再完成风险问卷。模拟办理仍需操作密码和云域名下的设备验证，不涉及真实银行或真实资金。不要输入真实银行密码、银行卡号或身份证。

Render Free 连续 15 分钟无访问会休眠，再次打开可能等待约一分钟；休眠、重启或重新部署后试用记录可能重置。请另外保存截图和反馈。免费托管受平台额度限制；DeepSeek API 调用使用账号余额，另计费用。

自动部署关闭，更新后在 Render 手动部署指定版本。源码撤回可切回此前提交；已经清空的试用数据不能靠源码回滚恢复。

[详细部署说明](docs/26_免费在线试用部署_2026-10-27.md) · [Render 免费限制](https://render.com/docs/free)

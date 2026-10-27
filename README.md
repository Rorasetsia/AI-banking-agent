---
title: 小苔 AI Banking Agent
sdk: docker
app_port: 7860
---

# 小苔 · AI Banking Agent 模拟银行预览版

当前应用 **0.8.6 / ModelScope preview v5**：通用业务主回复与关键数据移入卡片，依据收为单行；待确认方案提供明显入口。安全中心按密码、设备验证两步说明，密码默认隐藏，错误靠近操作按钮；嵌入页不允许新增设备时提前解释。保留0.8.5储蓄优选与备选方案。已包含上一版布局兼容、有限重连和模拟环境文案。保留v4的严格代理校验、官方父页面限制，以及Secure/HttpOnly/SameSite=None/Partitioned会话Cookie；其他托管入口保持原有策略。

## 已有创空间怎样更新

本轮修改包括前端、后端和构建配置，必须上传新版完整源文件夹，不能只替换启动脚本。将文件夹中的 Dockerfile、package.json、src、server 等放在空间根目录，避免多嵌套一层目录。原密文 DEEPSEEK_API_KEY、明文 BANK_PUBLIC_ORIGIN、Docker框架、免费CPU及7860端口保持原设置，然后重新部署。

运行日志应显示 `ModelScope preview v5 / app 0.8.6`；页面应显示“模拟环境”。如仍出现旧文案，请刷新页面并核对上传的src目录。

若浏览器禁止会话Cookie，新版会在有限重试后给出明确提示；请允许当前页面使用Cookie，或更新Chrome/Edge再重连。网页不能替用户修改浏览器隐私设置。部署代码不包含模型调用额度，仍使用原服务端密钥。

本分支用于魔搭 ModelScope Docker 创空间，保留 React/Vite 前端、Node24 后端、SQLite 独立合成账户和真实 DeepSeek 对话。不是实际银行，不涉及真实资金。

## 创建与部署

1. 在 https://modelscope.cn/ 注册登录，绑定已实名认证的阿里云账号。官方 Docker 说明：https://www.modelscope.cn/docs/studios/docker 。
2. 创建“编程式创空间”，SDK 选择 **Docker**。仅选界面标记为免费的基础 CPU。2026-10-27官方公共接口返回 `platform/2v-cpu-8g-mem`、`resource_type: free`；以实际账号可用配额为准，不选付费升级、不充值、不开通付费 PAI 实例。
3. 上传本分支源码到创空间的 master 分支，根目录直接包含 Dockerfile、package.json、src、server、shared。上传的是源码文件，不是ZIP压缩包本身。保留平台初始 .gitattributes，不强推、不覆盖未知文件。
4. 在创空间“设置”的**秘密变量/Secret**中添加 `DEEPSEEK_API_KEY`。模型调用仍使用既有API余额，与免费托管分别计算。Key不写入README、GitHub或聊天。
5. 运行入口默认监听 `0.0.0.0:7860`。普通变量 `BANK_PUBLIC_ORIGIN` 填独立应用的精确HTTPS来源，如 `https://平台分配的实际域名`，无路径/末尾斜杠；如平台已注入STUDIO_HOST可自动采用该域名。不要填创空间管理页 `modelscope.cn/studios/...`。
6. 点击“上线”，先检查构建日志，再检查运行日志。看到ModelScope preview v5 / app 0.8.6标记后，使用平台全屏应用页面验收。

## 分享与初始条件

分享 `https://www.modelscope.cn/studios/Rorastesia/moss-banking-preview?mode=full`。实测浏览器直接打开ms.show也会被平台重定向回内嵌页，所以不能仅靠独立链接绕过iframe限制。BANK_PUBLIC_ORIGIN仍填ms.show来源，不改成父页面地址。

每个浏览器自动生成独立模拟账户，初始余额¥28,650.42。先试“我今年要攒十万块”，补充月收入和必要支出；理财匹配时填写风险问卷。不填写真实银行密码、银行卡或身份证。

已确认的平台限制：魔搭iframe未授予publickey-credentials-create，新设备登记在该托管方式下受限。模拟资金操作仍要求原操作密码和设备核验，不能绕过。此免费托管当前适合页面、AI、方案和只读流程收集意见，不能宣传已经验证全部资金办理。原独立部署环境保留完整安全流程。

免费资源可能休眠并在访问后唤醒，容器重启可能清空试用数据。本部署不启用收费存储、不迁移原本机库，不承诺长期免费政策、无限额度或所有网络可达。上线后从校园网及手机流量实测完整AI对话与设备确认。

## 当前状态与撤回

部署适配文件已准备，不等于创空间已经创建或上线。保留Render预览分支与本地原库；本轮Docker配置可停止使用，切回先前Git提交。不要恢复或替换本机数据库。

详细说明见 `docs/30_魔搭免费试用部署_2026-10-27.md`。

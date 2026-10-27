---
title: 小苔 AI Banking Agent
sdk: docker
app_port: 7860
---

# 小苔 · AI Banking Agent 模拟银行预览版

本分支用于魔搭 ModelScope Docker 创空间，保留 React/Vite 前端、Node24 后端、SQLite 独立合成账户和真实 DeepSeek 对话。不是实际银行，不涉及真实资金。

## 创建与部署

1. 在 https://modelscope.cn/ 注册登录，绑定已实名认证的阿里云账号。官方 Docker 说明：https://www.modelscope.cn/docs/studios/docker 。
2. 创建“编程式创空间”，SDK 选择 **Docker**。仅选界面标记为免费的基础 CPU。2026-10-27官方公共接口返回 `platform/2v-cpu-8g-mem`、`resource_type: free`；以实际账号可用配额为准，不选付费升级、不充值、不开通付费 PAI 实例。
3. 上传本分支源码到创空间的 master 分支，根目录直接包含 Dockerfile、package.json、src、server、shared。上传的是源码文件，不是ZIP压缩包本身。保留平台初始 .gitattributes，不强推、不覆盖未知文件。
4. 在创空间“设置”的**秘密变量/Secret**中添加 `DEEPSEEK_API_KEY`。模型调用仍使用既有API余额，与免费托管分别计算。Key不写入README、GitHub或聊天。
5. 运行入口默认监听 `0.0.0.0:7860`。普通变量 `BANK_PUBLIC_ORIGIN` 填独立应用的精确HTTPS来源，如 `https://平台分配的实际域名`，无路径/末尾斜杠；如平台已注入STUDIO_HOST可自动采用该域名。不要填创空间管理页 `modelscope.cn/studios/...`。
6. 点击“上线”，先检查构建日志，再检查运行日志。运行中显示应用启动后，以独立应用地址进行验收。

## 分享与初始条件

页面禁止内嵌，创空间内置iframe可能空白；使用“在新窗口打开/独立应用”入口，分享其真实HTTPS地址。每个浏览器自动生成独立模拟账户，初始余额¥28,650.42。先试“我今年要攒十万块”，补充月收入和必要支出；理财匹配时填写风险问卷。资金操作仍需设置模拟操作密码及该域名下设备验证，不填写真实银行密码、银行卡或身份证。

免费资源可能休眠并在访问后唤醒，容器重启可能清空试用数据。本部署不启用收费存储、不迁移原本机库，不承诺长期免费政策、无限额度或所有网络可达。上线后从校园网及手机流量实测完整AI对话与设备确认。

## 当前状态与撤回

部署适配文件已准备，不等于创空间已经创建或上线。保留Render预览分支与本地原库；本轮Docker配置可停止使用，切回先前Git提交。不要恢复或替换本机数据库。

详细说明见 `docs/30_魔搭免费试用部署_2026-10-27.md`。

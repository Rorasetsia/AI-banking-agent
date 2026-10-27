# v0.8.6 业务卡片与安全操作体验

本轮仅改独立网页项目，保留0.8.5储蓄辅助决策。原小程序、原账户库、原8787服务均未修改；云端未部署，需用户整包上传。

## 结果与边界

- 通用银行业务将主回复放进卡片，开支报告突出流入、流出、净流入；主要操作前置，“依据与条件”默认一行折叠。共享AgentTaskCard适用于现有转账、卡片及理财等计划，不按截图单独套模板。
- 待确认方案在卡片内有深绿主按钮；历史关联卡片也保留明显入口，依据真实方案状态显示待确认、已执行或其他状态。确认弹窗先显示最后一步验证和执行，再显示关闭、修改、取消。
- 安全中心改为密码→设备验证两步：密码输入框对齐、默认隐藏且可显示；错误在当前表单内提醒并聚焦，取消注册不再误称交易失败。设备备注只是方便辨认，系统PIN和本应用交易密码分别说明。
- 注册create与验证get权限分开。浏览器明确拒绝注册时，在收集密码前解释限制；权限接口不存在、抛错或不认识该特性时不擅自判为禁止。支持HTTPS及原localhost边界，服务端Origin/RP/UV、密码和设备双证明均保留。
- 没有设备时不会显示无意义的密码执行区；魔搭页面若不允许注册，直接说明当前免费预览可分析和制定方案、无法完成该设置。没有自动绑定、模拟成功、只凭密码执行或全局放宽权限。

## 魔搭限制实证

真实魔搭官方父页面，浏览器仅将应用子域名映射到本地候选HTTPS桥，测试库为内存。原生父页面策略：publickey-credentials-create=false、publickey-credentials-get=true。新UI提前提示、没有设备密码输入区、无注册options请求；方案确认区同样解释限制。见`.runs/card-security-20261027/frame-check-final.log`。这不是云端已更新或真实线上办理成功；前端不能授予父页面未开放的权限。

官方机制说明：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/publickey-credentials-create 。独立ms.show链接可能仍被平台导回iframe，不把它当成绕过方案。

## 验证

- 类型检查和Vite构建成功，最终产物`.runs/card-security-20261027/build-final.log`；现有体积/第三方构建提示未增加依赖。
- 全部293自动测试通过，含新增5项卡片内容和设备环境测试，详full-tests.log。测试覆盖现金流展示来源一致及转账、卡片、理财共享计划入口语义。
- 真实Chrome桌面及390px手机共25项主流程检查：卡片主内容、紧凑条件、明显计划入口、密码显隐、输入框对齐、错误位置、取消无扣款及无横向溢出，详browser.log；final-views.log补验最终手机排布与错误可见。
- 隔离内存库、localhost:8825、modelRequired=true；3次真实DeepSeek业务对话：开支报告、10元转账计划、5元待确认计划。browser.log的realModelCalls仅计首次显式断言，结合final-views.log中llm消息和新方案回执确认共3次。
- 浏览器CDP虚拟WebAuthn认证器生成真实签名，经服务端完成设备注册、密码proof、设备proof和计划确认，10元仅执行一次。另一5元计划保留待确认。虚拟认证器用于自动验收，不冒充实机指纹/Windows Hello硬件验收。
- 单独注入一次NotAllowedError模拟用户取消注册，确认提示为设置未完成、没有设备注册和扣款；成功路径没有伪造服务端证明。
- 首次帧测试的本地桥设置modelRequired=true但未提供密钥，因此没有生成测试计划；修正QA桥为明确规则测试fixture后通过。产品始终保持真实模型必需，没有把规则模式重新暴露给用户。

## 撤回与交付

基线位于`.runs/card-security-20261027/baseline`。`python scripts/rollback-card-security.py`仅预览，添加`--apply`才恢复本轮18项源码改动；新文件移除，账户和密钥不碰。已在隔离副本实际执行还原，验证数据哨兵保留，后续修改冲突时在写入前整体拒绝。

完整上传目录`output/cloud/modelscope-upload-v0.8.6`，ZIP为`output/cloud/moss-v0.8.6-modelscope-source.zip`。只包含白名单源码，不含本机账户、密钥、QA脚本和证书。上传文件夹内所有内容，保持Docker/免费CPU/7860和现有平台变量，重新部署后核对`ModelScope preview v5 / app 0.8.6`。旧0.8.5包保留整包撤回。

## 协作与费用

按deepseek-web-development流程，DS high只读审阅1次设备环境模块，发现注册/验证权限、取消文案和云端错误指引问题；Sol实施跨组件整合并完成真实浏览器、服务端和撤回验收。没有额外GPT子代理。

DS共10011 tokens，缓存命中640输入tokens；按技能记录的2026-10-18价格估计0.00433752–0.00867504美元，非账单实付。回执在本批ds-review/receipt.json；GPT Plus节省比例未测量，不按API费用推算。

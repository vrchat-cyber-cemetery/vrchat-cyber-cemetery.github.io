# GitHub App一次性设置

状态：已于2026-10-07注册并安装（App ID 5219672，installation 168744732，覆盖主站与两个分片、不含world）；webhook关闭，变量与Secret已导入主仓库，[证据](evidence/automation-app-2026-10-07.json)。第3节合成验证与App模式工作流仍待实现。

## 1. 组织后台注册

由组织所有者注册Cyber Cemetery Automation，所有权选择vrchat-cyber-cemetery，首页可先使用组织GitHub地址。关闭webhook，不配置常驻接收服务，不要求投稿者OAuth登录此App。

配置仅需要：Metadata读，Contents写，Pull requests写，Issues写，Actions写。安装时只选主站、world-data-0、world-data-1；不要选world。动作令牌按具体作业进一步缩小仓库与权限。

## 2. 导入变量和Secret

- 主仓库变量AUTOMATION_APP_CLIENT_ID保存Client ID。
- 主仓库Secret AUTOMATION_APP_PRIVATE_KEY保存生成的私钥。
- 私钥通过GitHub设置页或CLI标准输入直接导入，不提交Git，不贴进Issue、回执或发布payload。
- 使用官方create-github-app-token，实施时固定版本与提交SHA；不要把安装令牌写入永久配置。

当前CLI具备repo／workflow范围，但没有修改组织级Actions策略的admin:org，不能据此报告组织全局策略已配置。注册安装在组织设置中完成；仓库级校验／部署不需要个人运行服务。

## 3. 实施验证

先用合成Issue验证App PR能触发CI，再触发一份合成分片部署。确认令牌只覆盖指定作业，数据仓库用自己的GITHUB_TOKEN部署Pages；撤销测试后配置状态改为installed。真实奖励仍需完整实现和独立维护者条件。

[GitHub官方Token范围](https://docs.github.com/en/actions/concepts/security/github_token) · [官方App Token Action](https://github.com/actions/create-github-app-token)

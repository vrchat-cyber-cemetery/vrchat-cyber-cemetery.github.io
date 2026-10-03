# 赛博墓地 Cyber Cemetery

社区维护的数字纪念墓园，使用GitHub协作和静态发布，在共享VRChat世界中展示。“这里埋葬了什么”可以是人物、身份、关系、记忆或其他事物。

## 当前进度

投稿网页和同仓库Actions试点已实现：填写、GitHub附件、自动校验、人工审核、初始额度消费、网页发布与预留定位码。VRChat世界、自动评审兑换和App跨仓库发布仍在后续阶段。

## 开发入口

- [GitHub详细开发计划](plans/GITHUB-DEVELOPMENT.md)
- [需求基线](requirements/REQUIREMENTS.md)
- [治理与额度规则](requirements/GOVERNANCE.md)
- [运行时协议](plans/RUNTIME-DATA.md)
- [Unity开发计划](plans/UNITY-DEVELOPMENT.md)
- [贡献指南](CONTRIBUTING.md)

## 仓库与发布地址

本仓库是内容与治理的权威来源。两个数据仓库仅发布图文包；[world](https://github.com/vrchat-cyber-cemetery/world)保存世界工程。

主站：<https://vrchat-cyber-cemetery.github.io/>。Pages只发布构建的静态页面，不复制源码、成员或账本目录。维护步骤见[试点手册](docs/OPERATIONS.md)。

## 本地验证

使用Node.js24，执行npm ci、npm run check、npm run build:site；验证文档、配置、业务规则、图片处理和30项协议模型。npm run preview用于本地检查。

## 许可

自有代码与开发文档采用[MIT](LICENSE)。纪念内容、投稿图片及第三方素材不自动套用MIT，见[内容授权说明](CONTENT-LICENSE.md)。

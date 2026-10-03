# 赛博墓地 Cyber Cemetery

社区维护的数字纪念墓园，使用GitHub协作和静态发布，在共享VRChat世界中展示。“这里埋葬了什么”可以是人物、身份、关系、记忆或其他事物。

## 当前进度

已建立仓库与文档骨架。GH-00负责初始化；站点发布、投稿处理、真实奖励和Unity世界在后续阶段实现，当前未开放真实墓碑投稿。

## 开发入口

- [GitHub详细开发计划](plans/GITHUB-DEVELOPMENT.md)
- [需求基线](requirements/REQUIREMENTS.md)
- [治理与额度规则](requirements/GOVERNANCE.md)
- [运行时协议](plans/RUNTIME-DATA.md)
- [Unity开发计划](plans/UNITY-DEVELOPMENT.md)
- [贡献指南](CONTRIBUTING.md)

## 仓库与发布地址

本仓库是内容与治理的权威来源。两个数据仓库仅发布图文包；[world](https://github.com/vrchat-cyber-cemetery/world)保存世界工程。

计划主站：<https://vrchat-cyber-cemetery.github.io/>。Pages尚未启用；不将仓库存在等同于站点已上线。

## 本地验证

使用Node.js24，执行 npm ci、npm run check。检查包括文档链接、JSON配置、工具测试和原有30项协议模型检查。

## 许可

自有代码与开发文档采用[MIT](LICENSE)。纪念内容、投稿图片及第三方素材不自动套用MIT，见[内容授权说明](CONTENT-LICENSE.md)。

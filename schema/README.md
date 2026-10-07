# 数据契约索引

每个 JSON 文件是一个 JSON Schema draft-07 契约,以 `$comment` 标注数据类别。源数据以本仓库为权威、人工或工作流写入;运行时导出由构建从源数据生成,不手工编辑,世界与网页只消费导出。

## 源数据(仓库为权威)

| 契约 | 覆盖实体 | 说明 |
| --- | --- | --- |
| entry.schema.json | 墓碑条目 | 接纳后的完整批准详情,含稳定墓位与发布序号 |
| member.schema.json | 社区成员 | GitHub 数字身份、余额与初始授予标记 |
| review.schema.json | 评审 | 绑定投稿修订的结构化意见;利益回避不自动发奖 |
| ledger-event.schema.json | 账本事件 | 单条不可变记账行,按操作幂等 |
| ledger-operation.schema.json | 账本操作 | ledger/ 下操作文件信封,链接社区操作与账本行 |
| allocation.schema.json | 额度授予 | allocations/ 下授予决策记录及其依据 |
| publication.schema.json | 发布 | 发布请求与结果:单调序号、源提交、档案哈希 |
| project.schema.json | 项目配置 | config/project.json 站点与容量契约 |
| policy.schema.json | 社区政策 | config/policy.json 批准政策 |
| automation-app.schema.json | 自动化App | App 安装范围与凭据位置 |

## 运行时导出(生成产物)

| 契约 | 覆盖实体 | 说明 |
| --- | --- | --- |
| catalog.schema.json | 根目录 | catalog.json:发布序号与64区预期修订 |
| region.schema.json | 区域概要 | regions/NN.json:文字概要与8个组包预期修订 |
| pack-metadata.schema.json | 组包JSON | packs/NNN.bin 内嵌JSON:8槽批准详情与七图标志 |

账本事件、操作信封与运行时导出由 tools/check-business.mjs 和 tests/ 在每次检查时用这些契约验证,不是死文档。

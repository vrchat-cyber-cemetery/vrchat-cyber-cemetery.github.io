# GitHub侧详细开发计划

更新：2026-10-07。组织：[vrchat-cyber-cemetery](https://github.com/vrchat-cyber-cemetery)。GH-00完成，当前上线同仓库投稿／网页试点，范围见[手册](../docs/OPERATIONS.md)。GH-01全部完成：主站与两个数据分片Pages在线，577固定地址直链验证通过，见[运行时地址证据](evidence/runtime-addresses-2026-10-07.json)与[状态快照](evidence/status-2026-10-07.json)。

## 1. 仓库、工作区与交付范围

### 当前试点交付

正式站点https://vrchat-cyber-cemetery.github.io/已部署。创建／本地预览、GitHub表单和附件、自动回执、维护者人工审核发布、初始1次接纳消费、分享页及预留定位码已实现。[试点证据](evidence/submission-pilot-2026-10-03.json)记录34业务／配置测试、30模型检查和真实GitHub自动回执。

因组织App无凭据，采用显式记录的same_repository兼容模式，不自动生成PR。自动评审兑换、跨仓库BC1和Unity端仍未完成，下面相关任务不因网站上线而标记完成。自审负向测试被正确拒绝，合成Issue已关闭且未消耗额度。

| 仓库 | 本地位置（相对外层工作区） | 职责 |
| --- | --- | --- |
| [主仓库](https://github.com/vrchat-cyber-cemetery/vrchat-cyber-cemetery.github.io) | vrchat-cyber-cemetery.github.io/ | 内容源、治理、工具、主站、需求与计划 |
| [分片0](https://github.com/vrchat-cyber-cemetery/world-data-0) | world-data-0/ | 图文包000～255的静态发布 |
| [分片1](https://github.com/vrchat-cyber-cemetery/world-data-1) | world-data-1/ | 图文包256～511的静态发布 |
| [世界源码](https://github.com/vrchat-cyber-cemetery/world) | world/ | 未来Unity／Udon工程、固定地址、客户端验收 |

全部公开，默认main，自有代码和开发文档MIT。投稿正文、图片、素材和SDK保持各自授权。外层不是Git仓库，workspace.json登记映射；原始18文件迁移时哈希匹配，见 [迁移证据](evidence/migration-2026-10-03.json)。

首轮交付仓库骨架、文档与批准政策、基础CI、初始提交和推送。Pages、App、真实投稿、奖励和Unity工程均有独立的后续完成条件。

## 2. 已确定配置

- 工具：Node.js24、ESM、Node内置测试；Ajv8.20.0配置校验，Sharp0.35.5为后续图片处理依赖，package-lock锁定解析结果。
- 内容：九种buried_type，0～3相关玩家，每碑最多七张逻辑图片，正式ID与固定墓位独立。
- 运行时：64区×64槽，8碑一组，512原子包，577预置地址；详见[运行时计划](RUNTIME-DATA.md)。
- 构建：GitHub托管Windows runner运行固定版本／校验值的DirectXTex texconv；不自建常驻服务。
- 当前状态：Pages按Actions发布静态产物，自动校验启用；same_repository模式人工审核发布，评审兑换关闭，App未注册。
- 身份：社区成员使用GitHub数字账号ID，VRChat绑定可选；不以显示名或实例playerId领取额度。

### 2.1 试点政策 pilot-v2

每成员一次性初始1次，3次经独立确认的有效评审换1次；每份投稿最多2个获奖评审任务。邀请／点击／转发不发奖，赞成、要求修改和拒绝使用同一质量标准。自审、重复评论和利益相关评审不自动领奖。

编辑不收费，接纳前拒绝／取消不扣次；接纳内容、墓位与一次消费共同落地。常规撤下不自动退款，维护错误补偿留记录，部署重试不重复收费。额度不交易、不转让、不跨社区自动合并，墓位不自动复用。

当前维护者为Ero-Cat；在真实奖励开放前落实第二位能够独立确认贡献的维护者，本人的贡献不能自行确认。配置决策已批准不等于奖励功能已实现。

## 3. GitHub App与权限

完整计划采用组织App。凭据未配置时，同仓库试点使用GITHUB_TOKEN处理回执、审核和显式workflow_dispatch发布；不自动生成PR。App就绪后再接入自动PR／跨仓库，继续限定安装范围。

| 作业 | 令牌与目标 |
| --- | --- |
| 生成投稿PR | App令牌，主仓库Contents／Pull requests／Issues写权限 |
| 触发分片工作流 | App令牌，两个分片Actions写权限 |
| 用户进度与回执 | 主仓库Issues写权限，仅更新固定评论 |
| Pages部署 | 各仓库自己的GITHUB_TOKEN，Pages写与OIDC权限 |
| PR预检 | 只读GITHUB_TOKEN，无App私钥 |

App私钥仅存主仓库AUTOMATION_APP_PRIVATE_KEY Secret；Client ID放AUTOMATION_APP_CLIENT_ID变量。分片下载公开、已批准的构建档案并校验清单，不需要复制私钥。注册步骤见 [App设置](GITHUB-APP-SETUP.md)。

当前CLI缺少admin:org，首轮不修改组织级Actions策略；仓库级配置按已有repo权限完成。App已于2026-10-07注册安装到主仓库与两个分片（不含world），见[App证据](evidence/automation-app-2026-10-07.json)；App模式投稿PR与跨仓库发布工作流仍待实现。[Token范围](https://docs.github.com/en/actions/concepts/security/github_token) · [App Token Action](https://github.com/actions/create-github-app-token)

## 4. 工作流与状态契约

| 工作流 | 触发与行为 | 实施阶段 |
| --- | --- | --- |
| CI | main push、PR、手动；文档／配置／工具／协议模型检查，只读权限 | GH-00 |
| issue-intake | Issue创建／编辑，读取默认分支处理程序，维护同一草稿和回执 | GH-02 |
| entry-validation | 草稿PR校验，审核绑定具体头提交与Issue修订 | GH-02／03 |
| accept-entry | 授权维护者发起，最新状态检验，接纳与消费共同落地 | GH-05 |
| build-publication | 从批准快照生成主站、区域与两个分片档案及哈希 | GH-03 |
| publish-shard | 受限App触发，核对批准来源与哈希，使用自身Token部署 | GH-04 |
| finalize-publication | 两分片就绪后激活主站并更新发布回执 | GH-04／06 |
| review-rewards | 独立确认后去重结算，记录有效评审与兑换事件 | GH-05 |
| withdraw-entry | 授权撤下，先安全主站再清理包、页面与受控历史档案 | GH-04／07 |
| backup／reconcile | 可恢复导出、失败操作补处理，不重新发奖或消费 | GH-07 |

投稿状态与部署状态分开。Issue关闭、PR合并或构建启动都不等于世界已经可见。

发布请求最少含publication_id、单调发布序号、source_sha、协议／布局版本、档案地址与SHA-256；分片状态返回相同标识与就绪结果。默认分支上的受信任代码执行，档案只允许已知静态文件，不执行产物中的程序。

## 5. 分阶段任务

### GH-00 仓库初始化：本轮

- [x] GH00-01 创建四公开仓库、本地独立Git、main、origin、noreply身份及初始提交。
- [x] GH00-02 原始18文件迁移并核对哈希；外层保留导航和workspace.json。
- [x] GH00-03 README、MIT、内容授权说明、忽略规则、CODEOWNERS及职责配置。
- [x] GH00-04 写入本计划和已批准pilot-v1；自动投稿／奖励开关关闭。
- [x] GH00-05 基础CI与本地检查，确认四仓库初始推送及远程CI成功。
- [x] GH00-06 记录完成证据，四仓库初始提交干净检出与验证通过。

出口已满足：四仓库对应正确，迁移18文件哈希一致，73本地文档链接／48需求／24验收映射通过，9配置测试＋30模型检查通过；四份初始提交远程CI及干净检出通过。

### GH-01 基础契约与静态站点

- [x] GH01-01 实现entry、member、review、ledger-event、allocation和publication的完整Schema，区分源数据／运行时导出。
- [x] GH01-02 根据config生成真实站点配置与577固定地址清单，供world编辑器工具导入。
- [x] GH01-03 首页、投稿／评审指南及世界未上线提示；不输出虚构世界ID。
- [x] GH01-04 空目录、64区概要、512小型无图组包及HTTP直链检查。
- [x] GH01-05 启用主Pages，设置投稿标签、Issue模板、CODEOWNERS和世界未上线提示；两个数据Pages已随空组包以workflow模式启用。

出口：主站与两数据站可访问，空协议数据稳定，地址无重定向。

### GH-02 简单投稿与审核

- [x] GH02-01 Issue Form只必填埋葬对象、类型和公开／授权声明；标题可自动建议，其余可选。
- [x] GH02-02 textarea拖图／粘贴附件，允许纯文字后补图；不要求用户JSON或Fork。
- [x] GH02-03 App模式已上线：投稿创建/编辑自动生成/更新结构化草稿PR（create-github-app-token固定v2.2.2提交），接纳后PR自动关闭；无凭据时回退GITHUB_TOKEN。
- [x] GH02-04 同Issue编辑复用同一submission/<编号>分支更新草稿；/publish同时绑定内容修订与PR头提交SHA，任一变化即拒绝旧指令。
- [x] GH02-05 /verify将人物同意、图片授权、角色权限、利益回避四项核验写入账本并作为/publish硬前置；举报、撤下、恢复与申诉共用请求表单和维护者指令入口。

出口：无写权限用户能完成投稿、补充和跟踪；未批准内容不会进入发布包。

### GH-03 构建与硬预算

- [x] GH03-01 校验九类型、三玩家、七图、唯一ID／墓位和资源引用；孤儿媒体与缺失引用在check-business双向拦截。
- [x] GH03-02 Sharp规范化（旋转/等比inside 1024²/扁平化背景/JPEG82/1MB上限）；草稿PR携带previews/<编号>.json真实缩放与背景报告。
- [x] GH03-03 texconv固定may2026+SHA-256（lib/publication.mjs的TEXCONV）；图集按协议分格、DDS解析校验2048²/单mip/DXT1/恰2MiB。带图路径已实现并测试，待首份带图投稿真机验收。
- [x] GH03-04 同一source_sha生成发布快照：包+清单+发布记录（publication schema）；区域概要与分享页由同提交的pages工作流产出。
- [x] GH03-05 Windows runner构建（真实运行，PB-000004），两分片zip档案记录容器SHA-256与source_sha，发布记录入Git。
- [x] GH03-06 单包2,228,256字节、分片256包544.008MiB、主站700MiB预算在构建内强制；源图与Git历史不入站预算。

出口：100条及4,096条合成集可重建，超限明确失败。

### GH-04 跨仓库发布

- [x] GH04-01 发布记录data/publications/PB-xxxxxx.json保存单调序号、source_sha、档案哈希；失败尝试（PB-000001~003）留档可追溯。
- [x] GH04-02 App dispatch两分片；分片核对main上的记录与档案哈希后以自身Token提交并部署Pages。
- [x] GH04-03 activate作业轮询两分片线上manifest的publication_id/source_sha并抽查包哈希，全部匹配才激活记录并重新部署主站。
- [x] GH04-04 分片乱序守卫：dispatch序号不大于已部署序号即拒绝覆盖；发布编排concurrency串行；消费幂等由操作ID保证。
- [ ] GH04-05 撤下先发布安全状态，重建组包并清理网页、预览与受控历史发布档案；同步时占位。

出口：故障、重试和旧缓存组合下状态可解释，未就绪不激活。

### GH-05 额度与有效评审

- [x] GH05-01 GitHub数字ID成员注册与一次性初始1次，不因改名／换绑重新领取；已覆盖初始授予与创建消费。
- [x] GH05-02 /review claim认领并绑定修订、/review submit提交结构化意见（同一质量标准）、/review confirm独立确认；单投稿奖励任务上限2个，作者不可认领。
- [x] GH05-03 /exchange按3次经独立确认且无利益冲突的评审兑换1次；兑换以评审组合为唯一操作防重放，奖励评审标记后不再计入，邀请发奖恒为0。
- [x] GH05-04 初始授予／创建消费账本与最新状态接纳，entry／墓位／消费同一Git变更落地；评审奖励事件仍后续实现。
- [x] GH05-05 /revoke-review撤销奖励并记录负向账本（余额不足则暂停该成员新增消费）、/compensate补偿记账、/suspend与/resume暂停恢复；撤销不删除任何已发布墓碑。
- [ ] GH05-06 第二位独立维护者与测试证据落实后开启真实奖励；App和实现未就绪不得仅切换开关。

出口：余额1并发两次最多成功1次，重复领取／回调／部署不会重记账。

### GH-06 分享、回执和定位

- [x] GH06-01 稳定分享页无需登录可读，提供创建、评审、参观和举报指引。
- [ ] GH06-02 投稿回执已实现，发布回执代码已实现但没有真实published条目证据；真实世界入口仍为空，待发布闭环验收。
- [x] GH06-03 01-01～64-64短码及内部减1映射，页面四步指引与未同步解释。
- [x] GH06-04 隐藏／撤下的稳定URL为通用不可用页，去掉身份、正文、图和专属预览。
- [ ] GH06-05 页面新手填写和长文本路径已完成本地／线上检查；真实GitHub发布回执、世界入口和PCVR到达待验收。

出口：新手从表单到回执，再按码找到正确位置；未发布不会被误告成功。

### GH-07 维护与开放

- [x] GH07-01 四仓库main禁止强推/删除；主仓库以规则集强制必需CI（仅自动化App旁路），人工直推被拒、PR+CI合并与App推送均实证（PB-000005在规则下激活）；分片因自身Token直推暂缓必需CI，见运维手册。
- [ ] GH07-02 第二维护者加入后启用独立审批，真实评审核验始终利益回避。
- [x] GH07-03 四仓库git bundle备份并从bundle恢复通过全量检查；干净检出重建包与线上逐字节一致；全历史密钥扫描为0；Fork隔离由Secret不随Fork与无密钥历史保证。
- [x] GH07-04 运维手册补齐五个playbook（失败发布引用PB-000001~003真实事故、撤下、App密钥轮换、满园、交接）与备份恢复规程。
- [ ] GH07-05 AC-01～24证据已回填（[回填清单](evidence/acceptance-backfill-2026-10-07.json)：17项验证/实证、2项待首个真实接纳、5项属世界侧）；封闭试点与正式开放待推进。

## 6. 固定接口与测试

主站：catalog.json、regions/00.json～63.json、entries/CC-000001/；数据0：packs/000.bin～255.bin；数据1：packs/256.bin～511.bin。完整URL见config和[协议](RUNTIME-DATA.md)。

必须测试：迁移哈希／链接；表单拖图／修订；未审内容过滤；重复发奖／并发消费；公平反对意见；512包预算；分片失败／乱序／撤下／回执；无绑定短码定位；备份与Fork恢复。既有30项离线模型继续运行，但不能代替Unity／Udon实际调用和PCVR验收。

源码与账本以本仓库为权威；分片不授予额度，不重新分配墓位。实施顺序GH-00→GH-01／02→GH-03→GH-04→GH-05／06→GH-07。自建服务器、常驻机器人及客户端写凭据不进入本方案。

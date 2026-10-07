# 运行手册

更新:2026-10-07(pilot-v2)。适用四仓库:主仓库(源、治理、工作流)、world-data-0/1(运行时分片)、world(未来Unity工程)。

## 当前可用流程

网站填写/预览 → GitHub Issue表单和附件 → Actions校验/固定回执 + **结构化草稿PR**(App令牌,`submission/<编号>`分支,投稿编辑自动更新) → **/join自愿加入的独立确认人**或维护者 `/verify` 四项核验 → `/publish <修订> <PR头提交SHA>` 接纳(修订与SHA双绑定) → Pages网页与分片发布 → 分享链接和预留定位码。

发布链:Windows构建(texconv may2026固定SHA)→ 分片zip档案+SHA-256 → 发布记录入Git → App dispatch两分片(乱序守卫+哈希核对)→ 分片部署Pages → 主站轮询双分片状态与包哈希 → 激活记录。全程幂等,失败尝试留档(`data/publications/`,PB-000001~003为真实失败案例)。

## 角色

- **维护者**(config/policy.json数字ID):全部权限——撤下/隐藏/恢复、补偿、暂停、密钥相关。
- **独立确认人**(任何GitHub用户,`/join`自愿加入):对**非本人**投稿`/verify`+`/publish`、`/review confirm`。加入与每次确认入公开账本,`/suspend`可失效,可重新`/join`。
- **成员/投稿者/评审者**:公开表单投稿;`/review claim`认领(单投稿≤2奖励任务)、`/review submit`提交意见;`/exchange`兑换(真实奖励开关未开)。

任何人不能处理自己的投稿——这是独立性的底线,用小号绕过会在公开账本中完全可见。

## 维护者操作

回执折叠区给出投稿修订SHA与草稿PR:

- `/verify <修订>`:记录人物同意、图片授权、角色权限、利益回避四项核验(发布硬前置)。
- `/publish <修订> [PR头SHA]`:草稿PR存在时SHA必填且必须匹配当前头提交。
- `/hide|/dispute|/remove|/restore CC-xxxxxx`:可见性变更;撤下保留墓位不退款。
- `/compensate <数字ID> <数量> <理由>`、`/revoke-review RV-xxxxxx`、`/suspend|/resume <数字ID>`:账本与管理。

## Playbook:失败发布

真实案例与处置(均已留档):

1. **PB-000001**——分片清单缺`region/group/revision`,分片check失败。处置:修复构建器;该记录标记`failed`;序号机制改为按已注册记录单调推导,重试生成新PB编号。教训:发布记录必须留档标记,不得删除重用编号。
2. **PB-000002**——dispatch步骤用`head -1`选中历史记录,载荷哈希与实际档案不符。处置:dispatch/activate改为使用本次构建的记录文件;整个发布编排加concurrency串行。
3. **PB-000003**——分片publish作业缺`contents: write`,提交403。处置:补权限;重跑新PB。
4. 通用:activate轮询超时=分片未就绪,检查分片Actions;不要手动"激活"绕过轮询——那正是该闸存在的意义。工作流级故障(如`pull_requests`键schema被拒导致事件不绑定)表现为"回执/PR没有出现":用`gh api .../actions/workflows/<file>`看名称是否退化为文件路径。

## Playbook:撤下

`/remove CC-xxxxxx`即刻改变源状态→下次Publish website重建页面(条目页变通用不可用页);分片侧等下一次发布(或手动触发Build publication)重建组包。安全顺序:先主站(源状态先行)后分片重建;同步期间分片可能短暂残留旧包,世界端按目录修订拒绝。外部截图与他站副本不保证召回。

## Playbook:App密钥轮换

1. 组织设置→Developer settings→Cyber Cemetery Automation→Private keys→Generate a new key(旧密钥立即失效前先新增)。
2. `gh secret set AUTOMATION_APP_PRIVATE_KEY -R vrchat-cyber-cemetery/vrchat-cyber-cemetery.github.io < 新.pem`。
3. 触发一次Build publication验证token链(ship作业create-github-app-token成功即验证)。
4. 删除旧密钥,本地`.pem`粉碎。私钥只在Secret,任何仓库Git历史不得出现(2026-10-07全历史扫描为0)。

## Playbook:满园(4,096墓位)

接纳时报"墓园预留位置已满,本次没有扣除次数"。应对:政策决定扩容(新分片站+世界更新地址清单)或维持不自动复用现状;不要手工腾挪墓位——定位码与墓位的稳定映射是公开承诺。

## Playbook:维护者交接

1. 新维护者加入组织,`gh api users/<login> --jq .id`取数字ID,写入config/policy.json的maintainers。
2. 交接者导出备份(git bundle,见下),新维护者干净检出跑`npm run check`。
3. 确认其能执行/verify与/publish、能看到Actions Secrets设置页(不阅读值)。
4. 真实奖励(GH05-06)在第二位独立维护者就绪后方可开启——届时policy.json `real_rewards_enabled: true`。

## 备份与恢复(2026-10-07演练通过)

- 备份:四仓库`git bundle create <文件> --all`;产物存工作区`backups/`。
- 恢复:`git clone <bundle>`即可完整重建;恢复的主仓库`npm run check`全绿。
- 确定性:干净检出重建的包与线上部署**逐字节一致**(抽样000/127/255/256/511比对SHA-256相同)。
- Fork隔离:仓库历史扫描无密钥材料;Actions Secret不随Fork复制,GitHub Actions凭据仅限本仓库。
- 频率:每次发布激活后或每月一次;备份与提交一起离线保存。

## 检查与开发

`npm run check`(语法门禁/文档/配置/业务校验/地址清单/组包构建/66项测试/30项协议模型)、`npm run build:site`、`npm run build:publication`、`npm run preview`(仅本地)。CI在每次push运行;main分支已禁强推/删除。

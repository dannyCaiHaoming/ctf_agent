# Throwback 固定上游准备状态：隔离无模型验证

## 结果与范围

候选 A 的有限前提成立：本机固定镜像可在默认 CMD 下，重复复现固定上游发布的初始数据库，并提供预定应用页面。此前“challenges/keys 为空即可判定缺 seed”的假设不成立。本次未执行 populate，没有证据要求追加 seed。

这只证明固定版本部署和非秘密初始状态一致，不证明漏洞可解、Solver能力、私有答案、judge认可或 solved。没有实现或接入产品 readiness gate、challenge schema、registry 或 prepareRun guard；离线 required/NA 函数只是审阅用最小判据原型。

专用工作区：`/Users/caihaoming/.codex/worktrees/readiness-source-validation/pentest-agent`；detached HEAD `81cc7fc06497088d9391c9ed93cc405694f6cf2e`。继承输入含未提交修改，本次均未改变；139 项输入 SHA-256 与入场清单一致。没有修改主区，没有 commit/push。

## 固定来源与实测

- NYU_CTF_Bench ref：`4c5744f55a31a58e03d6118c9dbb1c18e5bbdfa9`，路径 `development/2015/CSAW-Quals/web/throwback`。
- 本地九文件 blob 对照见 `local/source-check.json`，全相符。镜像部署布局只核对四个直接运行文件，不将九个本地文件都称为镜像文件。
- 镜像 digest：`sha256:ec0deee9a8a45ac74494e7dfc92357711fcf0b1e1c58543f09d6f824f3d9be98`，WorkingDir `/root/throwback`，无 Entrypoint，默认 CMD `python serve.py`。
- 两容器创建时均指定 `--pull=never --network=none --label ctf.readiness.owner=<唯一名> --name <唯一名>`，无挂载、无发布端口。未检查或修改历史 throwback-server-1。
- 每个容器均先 create，CMD 未执行时用 docker cp 流式读取白名单四文件，在内存中计算 hash。SQLite bytes仅短暂写临时文件供只读 schema/count，随后 unlink；无 DB、配置、HTTP正文或原始日志进入证据目录。
- 四文件 `serve.py`、`CTFd/__init__.py`、`CTFd/config.py`、`CTFd/ctfd.db` 精确匹配已核对上游 hash。DB SHA-256 始终为 `cd025072f989db229040b70d22b8d2f7c54845825280f3830da863690c5dbb3d`；Git blob `985961989297abec1130ea99893ad914b418532d`。
- 启动前、启动后、GET后以及第一次容器restart后，schema/count/hash均未变化。counts：challenges=0、keys=0、files=0、solves=0、teams=1、config=5、pages=1。这里只读 count 和固定表 schema，没有查行值；count相同本身不证明内容，精确DB哈希是另一项独立证据。
- SQLite URI `sqlite:///ctfd.db` 的路径由 Flask `Flask('CTFd').root_path` 与现有 Flask-SQLAlchemy 源码中的 `info.database = os.path.join(app.root_path, info.database)` 核实，实际解析 `/root/throwback/CTFd/ctfd.db`。只构造 Flask 路径对象，未调用 CTFd.create_app。备用 `/root/throwback/ctfd.db` 不存在；GET后瞬时 `/proc` FD未捕获DB（连接已关闭），因此不把FD缺失当路径证明。
- GET仅容器内部loopback `/`、`/login`。两者均200，长度分别3678/3734，含 `/challenges`、`/scoreboard` 链接；login含 POST form 和 name/password input。模板标记从本地已哈希对照的 `throwback_templates.tar.gz` 内存读取验证，不保存模板正文。没有POST、登录、攻击或打开解法。
- 两次独立容器ID不同；首次容器StartedAt从 `2026-10-25T04:02:15.989318425Z` 变为 `2026-10-25T04:03:02.07701546Z`。重启后GET再次200；旧实例/代次的观测不能直接复用。

## 失败与边界

第二容器启动后立即GET的两路径出现URLError，保留 `http-second-startup-transient.json`；稍后对相同实例重新实际GET通过，`http-second.json`及`second-after-get.json`属于就绪后新观测，不能把最初启动瞬间说成通过。默认CMD未修改，没有拉取、构建、装依赖或运行seed。

SQLite路径核对最初使用的源码精确子串 `os.path.join(app.root_path, database)` 返回false；原因是实际库变量名为 `info.database`，后续读取该库唯一相关行确认公式，并记录库源码hash与Flask root_path。此为探针匹配错误，未修改服务、配置或判据。

没有原始logs读取或保存，因此没有用日志证明内部初始化。这里依赖启动前/后分阶段实测，避免将create_all产生的新DB误当镜像原始DB。本例内置DB本身已经一致且未变化。

## 离线判据与检查

`offline-check.py`可复放白名单元数据断言：7阶段文件/DB一致性、2组真实HTTP正例、15个判据case。required缺观察、仅TCP、错source/material/image/instance/StartedAt/policy/同实例DB hash以及NA均明确标记为人工元数据变异；第二实例ID和首次restart StartedAt失效使用真实身份过渡。没有实际污染DB来伪造负例，未声明原型已集成产品。

执行命令及结果：

```text
python3 <audit>/offline-check.py
=> phase_hash_checks=7, http_positive_checks=2, offline_cases=15, all_passed=true
python3 AST parse probe.py/http-probe.py/offline-check.py
=> all passed
./node_modules/.bin/vitest run tests/contract/g-team-integration.test.ts -t 'E prepareRun binds'
=> 1 passed, 3 skipped; exit 0
139 input hashes recheck
=> 0 mismatch
```

容器操作使用 docker create/start/exec/cp/restart/rm；`probe.py <id> <phase>`产生schema/count/hash/身份投影；`http-probe.py`由 `docker exec -i <id> python -`在容器内运行，仅输出状态/长度/布尔。创建、重启、清理ID见白名单投影。产品源码未变，未运行全仓typecheck/build/test；定向测试只证明现有准备材料绑定回归，不证明readiness集成。

## 收口建议与未决项

可将本题准备来源收口为固定本地发布快照＋默认镜像部署＋即时非秘密检查契约，移除“必须额外seed”这一无依据要求。最小契约应绑定source/material/image、当前容器ID/StartedAt、初始DB hash及实际HTTP标记；启动失败保留unknown/blocked，不自动修复或seed。

本轮没有证据表明必须新增通用自动准入接口；是否将该本地契约接入prepareRun属于后续产品范围判断，由主会话决定。固定源和HTTP可用并不说明题目可解或judge可用；准入观测之后的状态变化也不受本快照保证。

已按创建时唯一label核对两ID后删除，仅清理自有容器；保留worktree及审计目录供独立review。publish清单仅最小元数据、脚本、报告与检查日志，不包含入场全量baseline或上游正文。

## 独立 review 补充：启动命令证据层级

`container-command-record.json` 准确转录本会话实际执行的两次 docker create、各次 start、首次容器一次 restart、两次 rm -f 的参数。create 均指定固定 digest、pull=never、network=none、唯一 label/name，镜像参数之后没有 command，也没有 entrypoint 或 working directory 覆盖参数。这是实际工具调用的执行命令记录，**不是事后容器 inspect 证明**。

`image-command.json` 在容器清理后对同一固定 image 作白名单只读 inspect，记录 Image ID、Cmd、Entrypoint、WorkingDir。镜像 Cmd 为 `["python", "serve.py"]`、WorkingDir 为 `/root/throwback`；Entrypoint 的 index 查询返回 null。本次直接字段查询两次因该key缺失而失败，随后改为同字段index查询成功；失败与解释均记录，未修改镜像。

原有阶段 identity 只留存实例ID、image、StartedAt、state及隔离投影；没有留存每个实际容器的 Config.Cmd/Config.Entrypoint/Config.WorkingDir。容器已删，不能追补这种直接证据。默认启动结论的依据是“实际 create 无覆盖参数的命令记录＋固定镜像配置＋启动/HTTP实测”，不能称为“已留存实际容器启动配置 inspect”。本补充未重跑、新建或修改目标，其他实测与判据结果不变。

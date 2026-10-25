# 独立只读复核

结论：现有证据足以推翻“challenges/keys 空即缺 seed”的前提，并支持将 Throwback readiness 的设计收口为固定本地准备与即时非秘密检查契约；不支持 solvable、judge 或 solved。没有要求新增 challenge schema、registry 或自动 prepareRun guard 的证据。

已复核 plan-copy、upstream/metadata、local/source-check、七阶段安全投影、HTTP投影、路径/模板投影、三脚本、离线病例、定向日志、report 与 publish-manifest。未运行 Docker、HTTP、目标、模型；未读取配置/DB行值或解法；独立重算139输入hash均相符。主区未动另由主会话复核，不冒充本审计已核对。

- 来源：九项本地blob与固定ref对照相符；镜像只证明四个运行文件，并非九项全覆盖。启动前DB已精确匹配上游，固定表counts为0/0/0/0/1/5/1。两实例及restart的hash/schema/count不变，故没有依据要求populate或额外seed。hash一致与页面可用仍不证明漏洞、答案或judge。
- 身份：两不同ID，首次实例StartedAt在restart后变化；七阶段网络none、0 mounts、无发布端口。旧ID/StartedAt观测失效病例使用真实身份转换，但判定函数仍是离线原型。
- HTTP：两次重建及restart后均记录 /、/login 200、3678/3734 bytes与预定链接/登录表单布尔；标记由已hash模板投影支持。第二实例首次URLError保留，后续成功为新观测。HTTP JSON不自带容器ID/StartedAt，关联依赖文件命名与执行记录，不应宣称为产品级原子绑定。
- 路径：URI和Flask root_path加现有库解析规则支持目标DB路径；FD扫描为空未被误用。投影不是SQLite打开系统调用追踪，报告已准确限定推理方式。
- 离线：15总病例=1真实正例投影+12合成人工元数据病例+2真实身份转换；没有真实破坏DB/镜像负例。函数没有集成产品，也未验证通用readiness框架。现有prepareRun定向测试1 passed/3按名称过滤skipped，仅证明材料绑定准备回归；当前TCP不代表业务ready。
- 安全：probe仅输出固定文件hash和固定表schema/count，临时DB读取后unlink；HTTP仅状态/长度/布尔与路径，不保存正文。publish清单24项不含DB/配置/HTTP正文/全量baseline/上游正文。cleanup投影仅列两个自有ID且label_matched/removed为true。

## 启动与清理补证复核

已复核新增 container-command-record.json、image-command.json 及report追加限制，publish-manifest共26项hash全部相符。两次create准确转录记录均指向既有两ID、固定digest、pull=never、network=none、唯一label/name，镜像参数之后没有命令，亦无entrypoint或working directory覆盖。其余五条为两个start、首次restart及两个按明确ID的rm -f。与既有阶段身份、HTTP及cleanup投影相容。

镜像白名单只读inspect记录同digest的WorkingDir=/root/throwback、Cmd=[python, serve.py]、Entrypoint index查询null。直接字段查询因key不存在的两次失败已保存且解释正确，没有把失败隐藏为成功。输出不含Env或其他秘密。

因此，原默认CMD可追溯缺口已由“实际命令转录＋固定镜像配置＋阶段与HTTP实测”的证据链补足，足以支持本轮有限默认镜像部署结论。命令转录属于执行者保存的实际调用记录；不是容器Config inspect，也不是本审计重新执行的观测。容器已删，不能声称留存了每个实际容器Cmd/Entrypoint/WorkingDir直接投影。report已明确保留此层级，当前不构成设计收口阻断。

清理命令仅针对两个创建ID，结合原label_matched/removed结果投影支持只清自有容器；本审计未再次访问Docker验证删除状态。HTTP JSON未自带ID/StartedAt的原限制仍成立，关联依赖文件命名与实际执行记录；这不应被升级成产品级原子绑定保证。

最终可定范围：固定本地准备＋真实run前即时非秘密检查契约，不新增通用gate。部署改变、重启或状态改变后重新观测，失败保留unknown/blocked；不以本批历史ready替代下次即时准备。不存在需要重跑目标才能解决的实质阻断；不据此宣称solvable、judge或solved。

# CTF 工具接入与预装取舍分析

日期：2026-10-29（Asia/Tokyo）。状态：**分析输入，不是设计决策、实施计划或运行授权。** 本文扩展[单个解题 Agent 的能力缺口分析](2026-10-29-single-agent-capability-analysis.md)，只讨论授权 CTF、用户本地 Docker 题目、明确授权的实验靶场及题目附件；不讨论现实未授权目标或大规模扫描。

## 1. 结论与证据口径

**当前 Web 最值得保留的是 A+D 收敛行为、现有受管 HTTP，以及经 `job.run` 使用的少量离线分析程序；不应把增加目录爆破器或通用扫描器当成修复方向。** 下一类工具的高价值来自真正接入附件、Crypto、Pwn 后出现的计算或格式能力缺口，而非“工具箱看起来不够全”。

本文使用五种来源标记：

- **【本地】** 本次读取的源码、角色与仓库文档，是静态接口证据，不是执行验收。
- **【用户新事实】** 用户告知：2026-10-29，main 上 r8-2 使用 A+D 收敛改动，约 12 分钟 **SOLVED Throwback（Web）**。本次未访问该 run 原始记录、未核对 main 或重新统计时间；接受为本次分析前提，不伪装成本次独立核验。
- **【网络·官方】** 工具作者仓库、官方文档、发行版包索引，支持功能与安装路径判断。
- **【网络·实战／社区】** 解题者本人 writeup、出题者说明、教学实验和社区经验，支持“有人实际这样使用”；不是使用率调查，也不证明工具是成功的必要条件。
- **【训练知识／分析判断】** 未在本次逐项核实的通用技术常识，或结合项目证据作出的适配与优先级判断；不冒充网页结论。

**本次已访问互联网**，检索了 GitHub、CTF writeup、官方文档与社区讨论。没有访问 writeup 中的题目服务，没有下载或执行其脚本，没有把答案、字典或 payload 集导入产品。部分页面只取得搜索摘录，以下在使用处注明；ExifTool 官网访问失败后改查作者 GitHub，Ghidra 一个旧文档路径失效后改查官方 headless API。网络材料只供 run 外研究，不授权正式 Solver 联网检索。

【分析判断】r8-2 更新了前文“行为修复尚待 r8”的时态：当前已有一次成功的用户报告，最近的核心失败应按**过度枚举、已有线索未转为动作**理解，不再按“缺少进攻工具”理解。这支持下调扫描工具优先级，但单题前后结果不是控制变量实验，不能把全部提速归因于 A+D，也不能据此断言跨题收敛已解决。原分析文件本次不修改。

## 2. 当前执行面与不能混淆的边界

【本地】本次先读前分析、根目录 [CLAUDE.md](../../../CLAUDE.md)、[AGENTS.md](../../../AGENTS.md)、[核心设计 §1.5–1.6](../specs/2026-10-22-ctf-agent-design-v1.md#15-工具知識資料與隔離)，并核对下列实现；补读产品运行规则、插件 schema 和控制服务相关分支。

| 当前能力 | 对预装工具的具体意义 |
| --- | --- |
| [job-tools.ts](../../../apps/launcher/src/job-tools.ts)：直接 `spawn(argv[0], argv.slice(1))`，固定 work cwd、环境白名单、stdin ignore，无 PTY | 大多数 CLI／脚本可直接使用；不会自动解释管道、重定向、shell 展开，也不能等待人类输入。长脚本先写入 work，再把脚本路径交给解释器。工具必须提供非交互参数或命令文件 |
| 同文件：每 session 2 个、每题 8 个活动 job；默认 60 秒、最长 600 秒，同时受 operation deadline 限制 | 这些是进程与时间限制，不是 HTTP 请求数、CPU、内存、磁盘或扫描范围限制。一次 job 可以内部发出大量请求；“只用了一个工具调用”不能证明省成本 |
| [插件 schema](../../../apps/opencode-plugin/src/index.ts)：公开 `job.run` 只有 argv、timeout_ms 等，不暴露 wait_ms；[control-service.ts](../../../apps/launcher/src/control-service.ts) 等待终态收束 | 内部存在短等待代码，不等于 Solver 获得交互 shell。不能靠启动后台代理／调试器就宣称已交付持续会话；进程组收束还可能终止遗留子进程 |
| job stdout/stderr 各保存最多 1 MiB、32 KiB 续读；[workspace-tools.ts](../../../apps/launcher/src/workspace-tools.ts) 可写脚本／二进制到 work | 适合短报告、选定字段与离线计算。超量输出会截断；保存到文件也不等于有无限磁盘配额或可直接交付大文件 |
| [http-tools.ts](../../../apps/launcher/src/http-tools.ts)：origin 核对、连接地址绑定、逐跳重定向限制、同题简化 CookieJar、响应捕获 | 能承担构造／修改请求、读响应和常规登录会话，但不是 HTTP CONNECT 代理，不会执行 JS，也不是 Burp 的流量拦截 GUI。二进制自带 `--proxy` 无法直接指向此函数 |
| [artifact-tools.ts](../../../apps/launcher/src/artifact-tools.ts)：固定 file／job／HTTP 来源 bytes、hash、范围和完整性 | CLI 日志可成为 job artifact；它不能因此升级为受管 HTTP 的逐请求来源证明。工具写出的“发现漏洞”或“找到 flag”仍不是 verified／accepted／solved。当前文件快照上限 1 MiB，不宜把完整磁盘镜像或巨大解包树当一个 artifact 发布 |
| [Recon](../../../product/opencode/agents/recon.md)、[Domain Solver](../../../product/opencode/agents/domain-solver.md) 优先测试已有具体线索、按问题与停止条件交回 | 预装工具不改变角色权力。不能把新扫描器变成每题默认起手流程，也不能新增一个工具内自主 planner／模型求解循环 |

【本地＋分析判断】**可通过 argv 启动，不等于已经具备该二进制，也不等于安全隔离已成立。** 本次未检查镜像软件清单、原生 ARM64 安装、网络 namespace 或运行性能。设计 §1.5 明确要求其他网络工具同样受 scope 限制；`checkArgv` 只是参数形状检查，环境白名单和 cwd 也不是 OS 沙箱。本文不会把 HTTP origin 校验推导成任意 job 的出口约束。

### 2.1 可执行程序不等于知识仓库，但打包内容必须分辨

【分析判断，遵守本次明确约束】不引入漏洞百科、知识平台、wordlist／payload 仓库。当前 checkout 的 CLAUDE.md 主要通过核心设计与 AGENTS.md 指向产品边界，未找到上述禁令的逐字表述；禁令在本次用户要求及前分析 §5 中明确，本分析照此执行，不虚构 CLAUDE.md 原文。

| 对象 | 本文处理 |
| --- | --- |
| 解释器、文件解析器、数学库、CLI 引擎 | 属于可执行能力，通常适合固定版本预装并复用 job；不是给模型增加解法知识库 |
| 通用路径／密码字典、现成 payload 集、跨题解法和历史答案素材 | 不建议引入。装了扫描程序不构成携带这些资源的理由 |
| 工具随包内置的检测签名、攻击实现、默认字典、联网查询模块 | 不能笼统全称“只是二进制”。格式 magic 与离线数学实现不同于通用爆破字典、历史 CTF 素数表或在线知识检索；需按固定版本实际内容判断，不能用改名绕过禁令 |
| 本题源码、HTML、已观察请求中明确出现的有限输入 | 属于题内证据。逐条检验这些事实不等于导入通用 wordlist；但不把它扩写成自动生成的大字典，更不把这种解释当成准许目录爆破的授权 |

## 3. 标准 Web 工具：真实用途与本项目适配

下表“可 job”是技术可表达性，所有网络使用仍以**本题明确授权 endpoint、可验证的出口约束、剩余 deadline**为前提。优先级是本项目的判断，不是工具流行度排名。

### 3.1 端口与服务发现：nmap

- **做什么／真实使用：**【网络·官方】端口、服务版本及 NSE 脚本探测，见 [Nmap 手册](https://nmap.org/book/man.html)。【网络·实战】H1-212 解题者并行用了 nmap 与 dirsearch，但报告这轮没有得到有用线索；[原始参赛 writeup](https://github.com/Hacker0x01/h1-212-ctf-solutions/blob/master/writeups/H1-212CTF-jackds.md)。说明它确实进入实战工具箱，不证明它每题必需。
- **可 job：** 是，CLI 批次运行；不需要 Zenmap GUI。非 root 场景应选择可用的连接式探测；原始包功能不能默认要求提权。【训练知识／分析判断】
- **scope 与时限：** 给定一个 Web origin，不等于授权同 IP 全端口、其他容器或整个网段；NSE 还可能进行额外应用交互。已知服务入口时重新扫端口通常不能回答当前业务假设，过滤端口重试又会吃掉时间。
- **建议：C，当前不纳入默认 Web 镜像。** 只有接入明确授权服务发现的实验题，才转为 A：预装、单题有界 job，不新增 nmap 专用 managed API；如果底层无法约束其网络 scope，继续不启用。**ARM64：** Ubuntu Noble 官方包索引列有 [arm64 nmap](https://packages.ubuntu.com/noble/arm64/net/nmap)，这是可获得性证据，不是本镜像验收。

### 3.2 人工 Web 工作台：Burp Suite

- **做什么／真实使用：**【网络·官方】Proxy 拦截浏览器流量，配合 Repeater 等模块修改与重放；[Burp Proxy 文档](https://portswigger.net/burp/documentation/desktop/tools/proxy)。【网络·实战】H1-212 使用 Burp 修改 Host；[Hilltop 出题者 writeup](https://blog.michellewayz.com/hilltop-ctf-writeups/)用 Burp 保存表单请求再交给 sqlmap。属于人工 Web 解题中有实证的工作台。
- **可 job：** 能启动进程不等于能操作桌面工作流。当前 job 没有 GUI 控制、交互输入和持续代理会话契约；为桌面 Burp 接插件／额外自动化适配不是零成本预装。
- **重叠与缺口：** 常规改请求、Cookie、读响应与现有 HTTP 有重叠；浏览器流量拦截、动态 JS 请求、可视化历史并未被现有 HTTP 覆盖，不能说两者完全等价。若实际题目需要浏览器，应聚焦浏览器隔离与观察，不为模拟人工习惯先加整套 Burp。
- **建议：C，不进入当前无人值守解题镜像。** 人工教学另用不影响这个判断。**ARM64：** 官方当前明确支持 Linux ARM64，嵌入浏览器对 JAR 启动有额外限制；不采用“Burp 不支持 ARM”这一过时理由，见[系统要求](https://portswigger.net/burp/documentation/desktop/getting-started/system-requirements)。不引入的主因是接口、生命周期与当前收益。

### 3.3 目录、参数与请求枚举：分别看四种工具

| 工具 | 做什么；真实使用证据 | 能否直接 job／ARM64 | 对本项目的建议与张力 |
| --- | --- | --- | --- |
| **dirsearch** | 【网络·官方】路径发现、扩展名与递归等功能，[作者仓库](https://github.com/maurosoria/dirsearch)。【网络·实战】[H1-212](https://github.com/Hacker0x01/h1-212-ctf-solutions/blob/master/writeups/H1-212CTF-jackds.md)确实调用，初始无收益；[SIGINT 2017 解题者](https://blog.jameshemmings.co.uk/2017/01/22/sigint-ctf-2017-writeup/)则用它发现入口 | CLI 可 job。Python 路径有 ARM64 移植基础；固定版本 Python 要求、依赖和附带默认数据须核对，不能承诺已有兼容镜像 | **C。** 核心价值依赖路径候选集；默认字典／递归与本次禁令和收敛方向冲突。不能把已知业务线索暂放一边，换成更快找目录 |
| **ffuf** | 【网络·官方】替换 URL、header、body 中输入，按状态／长度等筛选，有时间、速率与递归控制，[官方仓库](https://github.com/ffuf/ffuf)。【网络·实战】[PatriotCTF Curly Fry 解题者](https://ctftime.org/writeup/33608)实际使用；其通用字典做法不照搬 | CLI 可 job；Go 程序，可评估原生 linux/arm64 构建，具体发布资产未逐项核验。可用非交互方式，无 GUI 必需 | **C（当前），四者中唯一保留的条件性候选。** 若以后确有大量来自本题证据的有限对照输入、逐个 HTTP 往返成为实测瓶颈，可考虑 A；小集合直接用现有 HTTP 更清楚。速率限制不是总请求预算，时间限制也不是 scope 控制 |
| **gobuster** | 【网络·官方】目录／文件、DNS、vhost 等模式，[官方仓库](https://github.com/OJ/gobuster)。【网络·实战】[Hilltop 出题者的 Fuzz 题](https://blog.michellewayz.com/hilltop-ctf-writeups/)明确用它完成路径发现 | CLI 可 job；Go 的 ARM64 构建路径可行性待所选版本验证，不需要交互桌面 | **C。** 与 ffuf／dirsearch 重叠，DNS／vhost 枚举还容易越出单 origin 的授权语义；不为“工具齐全”同时装三个 |
| **wfuzz** | 【网络·官方】按输入源替换请求中的 FUZZ，覆盖参数、表单、header 等，[作者仓库](https://github.com/xmendez/wfuzz)。【网络·实战】解题教学作者的 [HackTheBox baby todo or not todo 演示](https://www.youtube.com/watch?v=008QxzctzqQ)描述用 wfuzz 枚举 API；本次只读视频描述，未观看完整过程 | CLI 可 job。Python 工具；PycURL／libcurl 等原生依赖的适配属于待核验项【训练知识】，不能仅因 Python 就宣称 ARM64 全部可用 | **C。** 与 ffuf 高度重叠，输入组合和插件更容易扩展搜索空间；当前没有值得承担第二套依赖和参数心智成本的证据 |

【分析判断】**目录爆破会不会让 r7 式游走更严重？会有明确的加重机制，但没有本项目新增工具的因果实验。** r7 已有具体路由线索与 RCE，却继续查文件／环境／数据库；目录爆破只会再生成一批可能入口、相似页面和假阳性，增加解释与追踪负担，不能替模型决定应测试哪条已有线索。r8-2 约 12 分钟成功后，更没有必要用默认扫描填满剩余 30 分钟预算。

【网络·教学／社区】TryHackMe 自己的 [ffuf 教学](https://tryhackme.com/room/ffuf)也提醒包含无关扩展名的大通用字典效率不高。社区 [Experienced players, how much do you automate?](https://www.reddit.com/r/securityCTF/comments/1d1sw8m)中有参与者偏好手工或小脚本，也有 ffuf／wfuzz 使用经验，并提到某些 CTF 不允许噪声自动化；本次仅取得搜索摘录，不能据此估算普及率或替代具体比赛规则。

### 3.4 定向 SQL 注入：sqlmap

- **做什么／真实使用：**【网络·官方】自动检测与利用 SQL 注入，支持请求文件、限定参数、DBMS、technique、批处理等；[官方 Usage](https://github.com/sqlmapproject/sqlmap/wiki/Usage)。【网络·实战】[Hilltop 的 Injection 题](https://blog.michellewayz.com/hilltop-ctf-writeups/)提供了真实的 Burp 请求文件→sqlmap 路径，并按已识别 DBMS 缩小检测范围。这支持定向用途，不支持每个 Web 题都跑全量检测。
- **可 job：** 是，使用非交互批处理及明确输入；不需要 Burp 才能生成请求文件。程序自己的 session／Cookie 不会自动继承 managed CookieJar，敏感登录数据也不应进入普通交接文字。Python 工具本体通常较易迁移 ARM64【训练知识】，仍需核对固定版本与可选依赖。
- **scope／deadline：** crawl、扩大参数范围、广泛数据库枚举和盲注提取可能发出大量请求；批处理接受默认选项不等于缩小授权。只针对已有 SQLi 证据的已知请求、已知参数和必要结果；不默认 dump-all，不做公网查询或越题访问。
- **建议：C（当前默认 Web 镜像），A（以后明确接入 SQLi 题且有实测需求时）。** 它比目录爆破更有定向增量价值，但 Throwback 的成功不提供 SQLi 工具需求。工具内置算法／测试逻辑与额外 payload 仓库不同；若某版本依赖的数据形态触及禁令，就不能以“可执行工具”为名全包导入。网络边界不能成立时，条件性 A 不成立。

### 3.5 通用 Web 检查：nikto

- **做什么／真实使用：**【网络·官方】依靠测试数据库与插件检查服务配置、已知危险文件／版本等；[Nikto 官方仓库](https://github.com/sullo/nikto)。【网络·实战】[Simple CTF 解题者记录](https://github.com/ALMADADALI/Walkthrough-and-Writeup/blob/main/TryHackme%20Labs%20walkthrough/Simple_ctf.md)有实际 Nikto 输出；本次取得搜索摘录，足以支持“被使用”，不足以证明其结果促成最终成功。
- **可 job／ARM64：** Perl CLI 可批次执行，不需要 GUI；Perl 解释器及模块仍需在所选 ARM64 镜像验证【训练知识／分析判断】。
- **建议：C。** 通用检测数据库与本次不扩知识／payload 资产的方向张力大，告警可能只是配置线索，难以证明当前题目动作语义；对已有可用入口的题，扫描噪声和模型读回成本不划算。不为 nikto 单独造 managed tool。

【网络·研究，搜索摘录】[NYU CTF Bench 论文](https://openreview.net/attachment?id=itBDglVylS&name=pdf)对 Smug Dino 的分析记述：部分 Agent 转向 nikto、sqlmap、dirb、gobuster 等常规策略；成功轨迹则检查 header／redirect 来推断题意相关机制。本文只把它用作“工具调用不等于有效进展”的外部旁证，不引用其比例，也不把该论文作为本项目 r7 的根因证据。

## 4. Misc／Crypto／Forensics／Pwn 接入后的工具

【本地】Domain Solver 描述已有 Web／Misc／Crypto，但角色文字不是题集接入或可用性验收。以下除轻量文件基础层外，均以实际接入相应授权题型为条件；Pwn／Reverse 尤其不能因这份分析就自动扩入当前交付。

### 4.1 文件、取证和隐写

| 工具／能力类 | 用途与依据 | 建议与 job 方式 | ARM64、资源与证据限制 |
| --- | --- | --- | --- |
| `file`、strings、hex／字节截取、归档目录检查、Python 标准库／JSON／HTML 解析 | 【训练知识】确定文件类型、看局部 bytes、解码与处理已取得响应；Web 附件也有价值 | **A，最高优先。** 先确认现有镜像缺什么，再预装最小集合；直接 job。不是新增 managed “万能分析器” | 原生包／解释器路径通常成熟，仍未实测；归档展开须限制目录、体积、条目与链接，不能写进 OpenCode 根。原始材料保留，派生输出到 work |
| **exiftool** | 【网络·官方】读写大量媒体元信息，[作者仓库](https://github.com/exiftool/exiftool)；读取模式用于附件基线 | **A，轻量优先；随图片／文档附件需求进入。** 无 GUI 必需，读元数据可直接 job；不改原附件 | Perl 工具，ARM64 主要核对解释器与依赖。输出中的注释／命令文本是题目数据，不成为产品指令 |
| **binwalk** | 【网络·官方】检测／提取嵌入数据并作熵分析，当前 v3 已改用 Rust，[官方 README](https://github.com/ReFirmLabs/binwalk/blob/master/README.md?plain=1) | **A，接入归档／固件／嵌入文件题后。** 先识别，按线索提取，不默认无限递归 | 固定 v2／v3 和外部解包器，不能混用旧教程参数。Rust 主程序可构建不代表所有提取依赖都有 ARM64 包；解包扩大磁盘量、误识别与嵌套耗时要有界 |
| **foremost** | 【网络·官方】按头尾及内部结构 carving 恢复文件，[项目说明](https://foremost.sourceforge.net/) | **A，接入损坏文件／磁盘镜像题后，低于基础识别。** job 对已授权附件操作，不读宿主设备 | C 程序的 ARM64 构建／发行包需验证【分析判断】。可能产生大量碎片和重复文件；恢复结果不是原内容完整性的证明 |
| **steghide** | 【训练知识】从受支持的图像／音频格式提取隐藏数据；并非所有图片格式通用。【网络·实战】[RaziCTF Rhazes 解题者](https://ctftime.org/writeup/24516)用题面线索得到口令后提取 | **A，接入对应隐写题后。** CLI 可通过显式参数避免口令交互；不引入密码字典或自动爆破包 | 原生库／编译依赖需验证；官方文档本次访问失败，不能声称已核实当前发行版 ARM64 支持。没有口令线索时保留缺口，不套全套密码搜索 |
| **zsteg** | 【网络·官方】PNG／BMP LSB 等检测与提取，[作者仓库](https://github.com/zed-0xff/zsteg)；不是通用 JPEG 解码器 | **A，接入图片隐写题后。** Ruby CLI 可 job，选定通道／位顺序／提取方法；不默认穷举所有组合 | 核对 Ruby／gem 与图片解析依赖。多种看似字符串的命中可能只是噪声，必须回到格式／题目语义验证 |
| `tshark`、Pillow 等专门格式能力 | 【训练知识】前者离线解析 PCAP，后者分析像素／裁剪等；分别针对网络取证和图像题 | **A，按附件类型选装。** 优先 CLI／脚本，PCAP 读取不需要实时抓包或抓包特权；不默认装完整 GUI 工作台 | 原生扩展与解码器须验证；不能由“能解析 PCAP”推出“允许抓取宿主网络” |

【网络·实战】[TJCTF neofeudalism 解题者](https://ctftime.org/writeup/37144)记录 binwalk、exiftool、strings 未提供结果，随后用 zsteg；[YauzaCTF Doberman 解题者](https://ctftime.org/writeup/14762)则记录元数据与常见隐写工具无收益，转向像素分析。这些案例同时说明工具真实被使用和**不能把逐个跑工具当成通用解题流程**。上表推荐的是按格式与假设选择能力，不是固定顺序全跑。

### 4.2 Crypto：数学能力优先于自动尝试全集

| 工具 | 所需能力与来源 | 接入建议 | ARM64 与收敛风险 |
| --- | --- | --- | --- |
| **Python 数学／密码库**：PyCryptodome、SymPy、gmpy2；按题再选 z3-solver | 【训练知识】分别覆盖密码原语、大整数／符号运算、快速数论与约束求解；[PyCryptodome 官方安装说明](https://www.pycryptodome.org/src/installation)支持按环境准备依赖 | **A，Crypto 接入时第一优先。** 固定解释器／环境，脚本经 job；不逐个包装 host API。模型建立假设，库计算结果 | 纯 Python 包与含 C／GMP／求解器库要分开核对 wheel、ABI 和源构建；数学计算也可能超时／耗内存，不能只有“最终会算完”的期待 |
| **SageMath** | 【训练知识】有限域、多项式、格与数论等复杂数学计算；不是自动判断题目漏洞的系统 | **A，实际题目需要时预装。** 使用脚本／批处理，避免交互 REPL；大型依赖在 run 外准备，不为 Web 默认背负完整环境 | 【网络·官方】[Sage 安装指南](https://doc.sagemath.org/html/en/installation/conda.html)支持 Linux／macOS 的 arm64/aarch64 conda 路径。具体依赖锁定、镜像体积和 600 秒 job 限制仍须验收；不能把 x86 模拟跑通当原生 ARM64 通过 |
| **RsaCtfTool** | 【网络·官方】弱 RSA 参数分析与恢复，集合多种方法，[官方仓库](https://github.com/RsaCtfTool/RsaCtfTool)；【网络·实战】[PowerRSA writeup](https://ctftime.org/writeup/28709)有使用记录，本次仅取得搜索摘要 | **C，默认整包不引入。** 有明确 RSA 题需求时，可重新评估指定离线算法的 A 用法；不新建自动选攻击框架 | 官方清单同时包含 Factordb 在线查询、Wolfram Alpha、Past CTF Primes 等。在线知识服务／历史题材不符合本次边界；“试全部方法”还会放大游走。Python 外的 Sage／数学依赖也要原生核验；不要为维持大幅裁剪版本制造维护 fork |

这里的“算法实现”与“知识平台”需要具体判断：用大整数库计算本题给定参数是执行能力；查询在线因子库或导入过去 CTF 素数素材不是同一件事。离线数学方法仍可很昂贵，须围绕已知参数和终止条件，不默认暴力分解全部整数。【分析判断】

### 4.3 Pwn／Reverse：批处理够用时不急着造交互终端

【网络·实战】[CSAW 2021 Password Checker 的解题者](https://ctftime.org/writeup/30159)同时使用 Ghidra、GDB、pwntools；[TJCTF 2025 i-love-birds 的解题者](https://ctftime.org/writeup/40312)也给出 GDB／pwntools 使用记录。这些是题型内的真实需求证据，不意味着当前 Web 应预装全套。

| 工具 | 用途与 job 适配 | 建议 | ARM64／接口限制 |
| --- | --- | --- | --- |
| **pwntools** | 【训练知识】ELF、字节打包、汇编／ROP 辅助以及进程／TCP tubes。完整脚本可以自己与子进程交互，外层 job 的 stdin ignore 不阻止这种脚本内交互；`interactive()` 等待人工输入则不适配 | **A，Pwn 接入优先；部分 Crypto TCP 题亦可能需要。** 复用 job，不新增 pwntools managed API；网络 tubes 仍必须受 endpoint 边界约束 | [官方安装文档](https://docs.pwntools.com/en/stable/install.html)列出 Python、binutils 与原生开发依赖；需要匹配目标架构的工具链。安装成功不等于能在 ARM64 上执行 x86 ELF |
| **gdb／gdb-multiarch** | 【网络·官方】支持 `-batch` 与命令文件，[GDB 模式文档](https://sourceware.org/gdb/current/onlinedocs/gdb.html/Mode-Options.html)。预先设定断点、执行、导出寄存器／内存可以单个 job 完成 | **A，Pwn／动态逆向接入时。** 固定的批处理优先；只有必须保留活进程、读回后由模型决定下一步时才考虑 B 的通用交互生命周期 | ptrace／容器限制及目标架构单独验证；不默认给产品 root／全局特权。multiarch 能理解多种架构不等于宿主可原生运行那些程序；调试输入也需脚本／文件安排 |
| **radare2** | 【网络·官方】CLI 逆向、分析与调试工具，[官方仓库](https://github.com/radareorg/radare2)；【训练知识】可用命令脚本、批处理／JSON 输出，默认交互界面不是必需 | **A，Reverse 接入的条件性候选。** 先选一套满足需求的静态分析工具，避免和 Ghidra 同时作为每题必跑项；本次未收集足够单题样本评价它与 Ghidra 的使用率 | 核对 ARM64 主程序及所需插件，不运行中装插件；全程序深分析可能很慢，按函数／区域取结果 |
| **Ghidra** | 【网络·官方】反汇编／反编译，除 GUI 外有 [AnalyzeHeadless 官方入口](https://ghidra.re/ghidra_docs/api/ghidra/app/util/headless/AnalyzeHeadless.html)与 [headless 导入示例](https://ghidra.re/ghidra_docs/GhidraClass/BSim/BSimTutorial_Ghidra_Command_Line.html) | **A，确需反编译的 Reverse／Pwn 题接入后。** 预装 headless 及短导出脚本，经 job 输出相关函数；不因其有 GUI 就像 Burp 一样整体排除，也不建 Ghidra 服务平台 | Java 可用不保证原生 decompiler／其他组件有匹配 ARM64 构件。本次未核实所选版本完整 Linux ARM64 包；在构建期查证并验证，不能假定 zip 跨架构通用。项目缓存、分析时间与内存也要控制 |

【训练知识／分析判断】跨架构执行是独立问题：ARM64 上静态读取 x86 ELF，与在本地运行／调试它完全不同。可能需要另行准备匹配题目的执行环境或经验证的模拟路径；不能隐含挂宿主 Docker socket、提权或扩大题目网络。QEMU 等只有在题型接入确实依赖时再评估，本次不列为默认安装任务。

## 5. A／B／C 汇总与预期价值排序

此处 **A＝固定版本预装，复用 job；B＝仅为缺失的 scope／预算／证据或持续资源控制增加最小 managed 能力；C＝当前不引入**。条件性建议不构成实施授权，排名不是预排 roadmap。

| 优先级 | 能力类 | 当前选择 | 何时改变／预期价值 |
| --- | --- | --- | --- |
| 1 | 离线文件识别、解码、已保存响应解析、归档检查 | **A** | Web 附件已有用处，通常依赖少、网络噪声低；先盘点现有镜像，避免重复安装 |
| 2 | Crypto 基础库，按需 Sage | **A，依赖实际 Crypto 接入** | 补足精确计算，收益来自原本算不了／依赖不存在；不是解决 Throwback 游走 |
| 3 | exiftool、binwalk；按格式 steghide／zsteg；按恢复需求 foremost／PCAP 工具 | **A，依赖对应 Misc／Forensics 附件接入** | 新格式能力价值明确，仍按假设调用，不机械全跑 |
| 4 | pwntools、批处理 GDB、按需一套静态逆向／反编译工具 | **A，依赖 Pwn／Reverse 接入** | 能表达实际二进制实验；先解决目标架构和执行环境，而不是增加模型角色 |
| 5 | JS 浏览器／模型逐步交互的 TCP、PTY | **B，只有具体题目阻塞时** | 现有 job 的有限批次确实不能表达持续交互才增加；host 绑定句柄、scope、取消、游标和证据，复用 OpenCode 决策循环 |
| 6 | sqlmap 定向 SQLi | **C 当前；条件性 A** | 先有 SQLi 题与已知请求／参数，再评估；底层出口限制成立且无需额外专用 host wrapper 才直接 job |
| 7 | nmap 服务发现 | **C 当前；条件性 A** | 仅当题目明确授权发现服务且没有既定 endpoint 时；当前单 origin Web 价值低 |
| 8 | ffuf 有限请求对照 | **C 当前；条件性 A** | 四种 fuzzer 至多重新考虑它一项，且不能携带通用字典。若所需其实是少量受管 HTTP 批处理，优先比较现有 HTTP 的小扩展 |
| 排除 | Burp 桌面工作流、重复 dirsearch／gobuster／wfuzz、通用 nikto、RsaCtfTool 默认全集、字典／payload／历史解法仓库 | **C** | 分别因 GUI／生命周期成本、功能重复、过度枚举、外部知识与题材耦合等原因；不靠“CTF 常用”豁免项目约束 |

### 5.1 什么情况才值得 B，而不是给每个二进制套一层

【分析判断】**现阶段没有理由新增 `nmap.run`、`sqlmap.run`、`binwalk.run` 这类成套 managed API。** 普通离线程序的身份、终态、取消和固定输出已有 job／artifact 承接；重复包装增加参数翻译、版本维护与调试成本。

网络自动化若日后值得引入，才讨论它不能自己保证的控制：固定授权目标／端口／协议，限制内部请求量与并发、到期停止，保留逐请求或足够复核的来源事实。只限制 argv 中第一个 URL 不能控制重定向、DNS、插件回连等实际出口；只传 `--proxy` 也不能证明程序所有流量都经过它。已有网络隔离可以解决的，不再另造通用代理平台；达不到约束时暂不启用该工具。

如果收益需求只是“比较少量已知 HTTP 请求”，前分析的有界 HTTP 对照仍是 B 的较小候选，复用 origin／会话／证据逻辑；**r8-2 之后其优先级需用剩余实际开销重新判断，不能直接继承为必做第一项。** 同样，通用 PTY／TCP 只为真实持续交互缺口进入，不为让交互工具列表更完整。

### 5.2 ARM64 预装的完成含义

【本地＋分析判断】核心设计要求 Ubuntu ARM64 产品形态；本次只找到部分上游可用性证据，**没有任何一个新工具获得“本项目镜像已验证可用”的结论**。以后选定 A 时，应在 run 外固定工具与依赖版本，确认原生 ARM64 可执行、所需格式／算法可用、默认无联网更新／外部查询，并由实际 `job.run` 验证非交互退出、超时／取消和输出读取。轻量工具不因此变成新增验收平台；只复用既有入口验证实际选入的一项。

宿主 shell 的虚拟环境激活不自动传入 job 的环境白名单；Sage／Python 等应使用构建时准备好的确定路径或固定启动方式。大文件要保留原始材料与必要派生片段，当前 1 MiB artifact 限制是潜在附件能力边界，不能静默截断后声称全部证据已交付。安装、接线、内容正确、独立验证与 solved 分开报告。

## 6. 对后续判断的影响与本次边界

本次完成的是指定文件的分析写作，未修改前分析、角色、工具代码、镜像或设计；没有运行 git、构建、测试、工具安装、真实模型或题目服务。遵守 no-git 要求，本次不声称检查过分支／dirty 状态；只在确认目标文件不存在后创建，避免覆盖已有文档。未读取 r8-2 原始 run，未测试镜像 ARM64／隔离／性能，网络实战案例也不是本项目验收结果。

以后若另行授权比较工具收益，应把 A+D 作为行为基线，固定题目初态、模型/provider、版本、token 预算与 30 分钟 deadline；记录实际网络请求量、无进展枚举时间、线索到直接实验的延迟、首个有效候选及最终判定。不能只看工具调用数下降：把数千次网络请求塞进一次 job，可能更快耗尽 deadline。工具型题集的收益与已知 Throwback 单题结果分开，不能把本次读过的 writeup 解法注入自主评估后声称泛化成功。

**最高建议：保留收敛基线，先用现有 job 配少量按需预装的离线工具；当前不新增通用 Web 扫描／目录爆破工具。真正接入 Misc／Crypto／Pwn 后，再按格式、数学与架构缺口选择工具。本文仅为分析输入，真实收益只能由另行明确授权的 CTF 运行证明；本次已访问互联网。**

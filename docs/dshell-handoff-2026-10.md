# dshell 交接文档（2026-11-04）

给接手的人。这份只写**当下现场状态**与**为什么**——架构/协议/包职责看
[`dshell-architecture.md`](./dshell-architecture.md)、[`dshell-packages.md`](./dshell-packages.md)，
上手顺序看 [`README.md`](./README.md)。

本文里的每条读数都是 2026-11-04 在本机（Windows + WSL2，`<repo-root>`）复跑或复扫得到的，
命令一起写出来了，可以直接推翻我。

**这份文档取代 2026-10-19 那一版**——那一版的版本号、测试计数和工作区状态三条都已过时。
文件名里的 `2026-10` 是**第一次交接的日期，为了链接不断而保留**：别的文档（roadmap 的
目录、README 的文档表）引用的就是这个文件名，改名要连那些链接一起改。

## 0. 三句话状态

1. **分支领先 main 9 个提交，全部未发版**。`feat/dshell-wsl-device`，HEAD `fc42e01`
   （2026-11-02），已推 origin。12 个包的 `package.json` **仍是 `0.1.16`**，
   npm `latest` 也是 `0.1.16`，最新 tag `dshell-v0.1.16` 指向 `b3d72f9`（2026-10-31）。
2. **门禁全绿**：`vitest` 75 files passed + 1 skipped，**773 tests passed / 44 skipped**；
   `tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 均 exit 0。
3. **WSL 这条线现在整条通了**：本文上一版记录的 exec 门丢 stdout 的洞**已修并复量**
   （`ProcessCommand` 改成真 duplex，读写两侧分开），文件面板依赖的三条 exec 都答得出内容；
   shell 门（ConPTY）一直是好的。见 §3 ①。**但这些修复还没有提交**，工作区是脏的。

## 1. 现场快照

| 事项 | 读数 | 怎么复核 |
|---|---|---|
| 当前分支 | `feat/dshell-wsl-device`，已推 origin，**领先 main 9 个提交** | `git status -sb`、`git rev-list --count main..HEAD` |
| HEAD | `fc42e01`（`refactor(dshell): WSL becomes its own package behind a provider registry`） | `git log --oneline -1` |
| main | `a38d27c` | `git log --oneline -1 main` |
| 工作区 | **脏**：17 处修改、1 处删除、1 个新文件（本文写作时，均未提交） | `git status --short` |
| 包 | **12 个**，全部 `0.1.16` | `for d in packages/dshell/*/; do node -e "console.log(require('./$d/package.json').version)"; done` |
| npm 上 | `latest` = `0.1.16` | `npm view @nexus-aethra/dshell-bundle dist-tags --registry=https://registry.npmjs.org/` |
| tag | 最新 `dshell-v0.1.16` → `b3d72f9`（2026-10-31）；**0.1.17 线还没有 tag** | `git ls-remote --tags origin 'refs/tags/dshell-v*'` |
| dsh pin | `dsh-v0.2.1-rc.3`（`dsh-upstream.json`） | `cat dsh-upstream.json` |
| 测试 | 75 files passed + 1 skipped / **773 tests passed / 44 skipped** | `pnpm run test` |
| 类型 | 干净（`tsc -b tsconfig.host.json`、`tsc -b tsconfig.client.json` 均 exit 0） | `pnpm run typecheck` |
| 工具链 | **本机 Node 是 `v22.14.0`，而 `package.json` 的 `engines` 要 `>=24.11.0`** | `node -v` |
| WSL 实测机 | Windows + WSL2 `Ubuntu-24.04`（默认）+ 一个 dshbox 容器 distro | `wsl.exe --list --verbose` |

**Node 版本那条要当真**：门禁是在 v22.14.0 上跑绿的，而 `engines` 要求 `>=24.11.0`。
发布前在一个满足 engines 的 Node 上再跑一遍门禁。

## 2. 这 9 个未发版的提交是什么

| 提交 | 内容 |
|---|---|
| `a3e86b1` | 切会话时记住 prompt |
| `d64bc9b` | WSL2 distro 作为一个内建设备 |
| `a7a5d2a` | WSL 的 mount 路径留在 Windows 的命名规则里（id 带冒号，Windows 目录名不合法） |
| `8b986cb` | 管理台（一个设置页） |
| `f299b94` | WSL 那一行读起来像一种自己的登录方式（`auth: 'wsl'`） |
| `bca50b9` | WSL 卡片 + 图标 |
| `95ded8b` | 所有设备共用一套卡片外框 |
| `8e7a5a3` | ConPTY 重绘空行的修复 |
| `fc42e01` | WSL 变成自己的包，藏在一个 device-provider registry 后面 |

第 9 个提交是这批里结构性的那个：WSL 支持原先长在 `dshell-ssh` 里（一个 transport 文件、
device store 里的 WSL 分支、router 里的探测循环、forward 接缝里写死的拒绝语、客户端里的
卡片和 locale），每一条都让 SSH 包背上了它不拥有的词汇。现在 `dshell-ssh` 拥有一个
**device-provider registry**，SSH 包再也不提 `wsl` 这个词。契约见
[`dshell-architecture.md` § 20](./dshell-architecture.md)。

## 3. 没做完 / 要知道的事

### ① WSL 的 exec 门曾经是坏的，已修并复量

**修之前**（2026-11-04，本机 Windows + WSL2 `Ubuntu-24.04`，实测不是推测）：

```
doors.exec(device, 'echo HELLO')    -> { exitCode: 0, stdout: '', stderr: '' }   <- 错
doors.open(device, 'echo VIAOPEN') -> stdout 'VIAOPEN\n'                          <- 对
```

**原因是一条 duplex 背了两个方向。** `packages/dshell/wsl/src/transport.ts` 只造了一个
`PassThrough`，两头都接在子进程上：子进程的 stdout 写**进**这条流，而对这条流的写入又去
喂子进程的 stdin。于是无 stdin 契约里那句 `stream.end()`（关写侧）把**读侧也关了**，
子进程的 stdout 在收集器看到它之前就没了。

**修法就是照 SSH 传输层的形状拆开。** `ProcessCommand` 现在造一个真 `Duplex`：
**写侧是子进程的 stdin，读侧是子进程的 stdout，两侧永不相碰**——关写侧不再关读侧。
`packages/dshell/ssh/src/channel-process.ts` 本来就是三条独立的 `PassThrough`（stdin /
stdout / stderr），两个方向分开接；WSL 传输层现在与它一致。同一个门还补了两件小事：
`DeviceExecOptions.env` 现在会并进 `wsl.exe` 的环境，`openStdin` 为 true 时不再关写侧。
spawn 是可注入的（`WslSpawn`，默认是真的 `wsl.exe`），所以这条契约用假子进程就能证明，
不依赖一台有 WSL 的机器。

**修之后（同一台机器复量）**：

```
doors.exec(device, 'echo HELLO')      -> { exitCode: 0, stdout: 'HELLO\n', stderr: '' }
doors.exec(device, 'echo A; echo B')  -> stdout 'A\nB\n'
doors.exec(device, 'printf xyz')      -> stdout 'xyz'
doors.exec(device, 'echo OUT; echo ERR 1>&2') -> stdout 'OUT\n', stderr 'ERR\n'
router.test 的探针                    -> LAPTOP-65SFEHRB|gpumem|Linux 5.15.167 (microsoft-standard-WSL2)
router.ensureDeviceRoot 的探针        -> /home/gpumem
```

回归测试在 `packages/dshell/wsl/tests/wsl.spec.ts`（exec 门那一组 11 条）：**8 条在修前的代码上
失败、11 条在修后的代码上全过**——剩下 3 条两种形状都过（断言空答案的那条，以及旧形状恰好
能serve 的几条）。

**这个洞原先损失什么**：文件面板的 `resolve()` / `stat()` / `list()` 三条都走 exec 门
（`packages/dshell/ssh/src/remote-fs-shell.ts`），所以那时 WSL 设备上的文件面板什么都看不到；
`router.test` 的探针、`router.ensureDeviceRoot` 的探针同样答空——`8e7a5a3` 加的
`ensureDeviceRoot` 与加载期 provider 探测，对 WSL 实际没生效。现在这几条都答得出内容了。

**容器里复验时又发现并修掉一个洞**：`env` 只在宿主进程侧设置，`wsl.exe` 默认不把 Windows
环境变量转发进 distro，所以远端读不到——`printenv FOO` 空而 `$HOME` 正常就是信号。改用
`WSLENV`（WSL 自己的桥：列在里面的名字会被拷进 distro）携带，宿主原有列表保留。修后
`printenv DSHELL_PROBE` → `passed`。

**一直好着的（同一台机器量到的）**：**shell 门**（ConPTY pty）打进 pty 的标记能回来、
提示符渲染正常、会话干净退出；**设备面板的探测**（走 shell 接缝）真实的进程 / 容器 /
端口行都回来了。

### ② 还没做的（这些是欠着的，不是可以顺手带过的）

- **合 main**：分支领先 main 9 个提交，还没合。
- **`0.1.17` 版本号提升**：12 个包的 `package.json` 全是 `0.1.16`。
- **发布**：`pnpm publish`（**不要用 `npm publish`**，见 § 4），按依赖序，`dshell-bundle` 最后。
- **打 tag**：`dshell-v0.1.17` 还不存在；`dshell-v0.1.16` 指向 `b3d72f9`（2026-10-31）。
- **WSL 的真机验收**：目前只在**一台** Windows + WSL2 机器上量过（Ubuntu-24.04 + 一个
  dshbox 容器 distro）。WSL1 被过滤掉了，没验过；非 Windows 主机上 `wsl.exe` 不存在，
  内建行不出现，也还没在那种机器上跑过。
- **提交这批修复**：exec 门的修复、registry 的能力位、文档四件套都还在工作区里**没提交**，
  `git status --short` 能看到。注意 `docs/dshell-upgrade-0.1.6.md` 已删但删除还没进 index——
  在提交之前 `scripts/tests/repo-hygiene.spec.ts` 会因为读不到这个已删文件而红三条，
  那是 index 状态造成的，不是代码问题；把删除一起提交就绿。

## 4. 交接纪律（先读这条再看代码）

- **绝不 `git add -A`**；按路径 add。**不直接提交 main**；合 main、发版、打 tag、推分支
  先问人。本次已获授权推 `feat/dshell-wsl-device`，**仅此一次**，不代表以后可以自己推。
- **发布必须 `pnpm publish`**（`npm publish` 会把 `workspace:` 原样发出去，装的人
  `EUNSUPPORTEDPROTOCOL`；0.1.4 就是这么报废的）。12 个包按依赖序、`dshell-bundle` 最后；
  坏版本撤不掉（token 是 bypass-2FA granular，`npm unpublish` 403），只能 `npm deprecate` +
  改版本号。npm CLI 默认导到 npmmirror（只读），发布/查版本要显式
  `--registry=https://registry.npmjs.org/`。发布细则见
  [`dshell-packages.md` § "The publishing environment"](./dshell-packages.md)。
- **凭据**：npm 发布 token 在 `~/.npmrc.publish`（只有 `NPM_CONFIG_USERCONFIG=$HOME/.npmrc.publish`
  时才生效；默认 `~/.npmrc` 里那枚**已失效**）。真实设备口令不在仓库里、也不要打印内容，
  要用时当场问，用完即弃。别把真实口令写进任何测试 fixture。
- **调试宿主只留一个实例**，临时起的当场收尾。
- 改完就测并把读数读回来（文本/几何/控制台），别拿"门禁绿"当"功能对"。
  **门禁绿也会漏**：`channelOf` 那个 flaky 就是门禁绿着、十次里挂一次——
  判据是"连续跑十次全绿"，不是"跑一次绿"。

## 5. 接手第一步

```sh
cd <repo-root>
git status -sb                 # 现在应显示领先 origin 且工作区脏（修复还没提交）
pnpm i
pnpm run test && pnpm run typecheck     # 期望 773 passed / 44 skipped + 干净
pnpm --filter "@nexus-aethra/dshell-*" run build
```

> 本机 `pnpm` 不在 PATH 上时，用 `node_modules\.bin\vitest.CMD run` 和
> `node_modules\.bin\tsc.CMD -b tsconfig.host.json` / `tsconfig.client.json` 直接跑。

**第一件该做的事是把这批修复提交掉**（§ 3 ② 最后一条）：exec 门的修复、registry 的能力位、
文档四件套，全在工作区里。提交时**把 `docs/dshell-upgrade-0.1.6.md` 的删除一起带上**——
不带上 `scripts/tests/repo-hygiene.spec.ts` 会红三条（它去读一个已经不在磁盘上的 tracked 文件）。
然后按 § 3 ② 的次序走：合 main → `0.1.17` → 发布 → tag，每一步都先问人。

**分支模型**（`dshell-setup.md` 写死了这条）：`main` 只放已发布的线，**不直接提交**；
一个开发方向一条分支，走 PR **squash-merge** 进 main，合完删分支。判断"某分支的活是否已进 main"
要**比树**（`git diff --stat origin/main <branch>` 为空即已进），不要看祖先关系——squash 之后
祖先关系必然骗人。

文档索引在 [`docs/README.md`](./README.md)；这批改动的规范在
[`dshell-architecture.md` § 20](./dshell-architecture.md)（device-provider 扩展点）与 § 19
（设备传输层）；包职责在 [`dshell-packages.md`](./dshell-packages.md)。
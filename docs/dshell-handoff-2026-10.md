# dshell 交接文档（2026-10-19）

给接手的人。这份只写**当下现场状态**与**为什么**——架构/协议/包职责看
[`dshell-architecture.md`](./dshell-architecture.md)、[`dshell-packages.md`](./dshell-packages.md)，
上手顺序看 [`README.md`](./README.md)。

本文里的每条读数都是 2026-10-19 在本机（Linux，`/home/wpp/nexus/Nexus-Shell`）复跑或复扫得到的，
命令一起写出来了，可以直接推翻我。

## 0. 三句话状态

1. **宿主 `ssh` 依赖已经整个拆掉**：设备连接改走内置的 `ssh2` 客户端，Windows 上不再需要装
   OpenSSH Client，也不再读写用户的 `~/.ssh`。改动已提交（`7728876`）并推到
   `origin/feat/dshell-device-metrics`，领先 main **18 个提交**。
2. **门禁全绿、真机验收通过**：561/561 测试、typecheck 干净、build 通过；DSHBox 容器里对
   `root@43.138.••.•••` 跑通了连接测试、helper 部署、设备终端（含 settle 标记、resize、Ctrl+C）、
   文件列举/写入/回读/搜索。
3. **没发版、没打 tag**：0.1.14 线只发到 `0.1.14-alpha.3`（npm `alpha` dist-tag），
   `latest` 仍是 `0.1.13`。合 main、发版、打 tag 都还没做——按规矩先问 wpplight。

## 1. 现场快照

| 事项 | 读数 | 怎么复核 |
|---|---|---|
| 当前分支 | `feat/dshell-device-metrics`，**已推 origin 并设了上游**，领先 main 18 个提交 | `git status -sb`、`git rev-list --count main..HEAD` |
| HEAD | `7728876`（`feat(dshell/ssh): the transport is a library, not the host's ssh`） | `git log --oneline -1` |
| main | `600406e`（`feat(dshell): support dsh 0.2.1-rc.2`） | `git log --oneline -1 main` |
| 工作区 | 干净，只剩 8 个未跟踪的 `assets/*.mp4` | `git status --short` |
| 版本 | 11 个包全部 `0.1.14-alpha.3` | `for d in packages/dshell/*/; do node -e "console.log(require('./$d/package.json').version)"; done` |
| 测试 | 50 files / **561 tests passed**，约 2 s | `pnpm run test` |
| 类型 | 干净（清 tsbuildinfo 后 `tsc -b tsconfig.host.json && tsc -b tsconfig.client.json`） | `pnpm run typecheck` |
| npm 上 | `latest` = `0.1.13`，`alpha` = `0.1.14-alpha.3` | `NPM_CONFIG_USERCONFIG=~/.npmrc.publish npm view @nexus-aethra/dshell-bundle dist-tags --registry=https://registry.npmjs.org/` |
| tag | 最新是 `dshell-v0.1.13`；**0.1.14 线没有 tag**（wpplight 明确要求过） | `git ls-remote --tags origin 'refs/tags/dshell-v*'` |
| 工具链 | Node `v24.21.0`（nvm）、pnpm `9.15.0`（`~/.local/bin/pnpm` 包装脚本） | `node -v`、`pnpm -v` |
| 宿主检出 | `dsh/`（未跟踪）在 `dsh-v0.2.0-rc.2-1923-g1be013386c`；根 `package.json` 用 `link:./dsh/packages/...` 覆盖全部 dsh 包 | `git -C dsh describe --tags` |
| 容器 | `dshell-metrics-run` 与 `normal-usage` 都在跑，dsh `v0.2.1-rc.2` | `dshbox ps` |

## 2. 这一批改动是什么，为什么

**一句话**：把 dshell 对宿主 `ssh` 的依赖整个换成内置的 `ssh2` 客户端。

**为什么值得做**。宿主 `ssh` 是 dshell 唯一供不上的依赖，它有四个问题同时成立：
Windows  stock 安装没有它（要用户自己去加 OpenSSH Client 可选功能）；它读
`~/.ssh/config` 和 `~/.ssh/known_hosts`——用户自己的文件，dshell 不该往里写；
每条命令都要付一次进程创建，而 harness 又把本地进程包一层 systemd scope
（架构文档 §13 实测单次 0.39 s）；还有一个只有 Windows 上才炸的 spawn ENOENT。

换成进程内客户端，四个问题一起消失，而且设备终端从此是**一个会话**而不是
包在别人外面的壳。

### 落地形状

| 文件 | 是什么 |
|---|---|
| `ssh/src/transport/transport.ts` | `DeviceTransport`：按设备 + 凭据指纹池化连接，三扇门——`exec`（收集后关）、`open`（保活）、`shell`（pty） |
| `ssh/src/transport/known-hosts.ts` | dshell 自己的 known_hosts，OpenSSH hashed 格式，只读写数据目录，绝不动用户那份 |
| `ssh/src/transport/auth.ts` | 凭据装配：私钥原文、密码去一个尾换行、keepalive 15s×3、readyTimeout 10s |
| `ssh/src/transport/errors.ts` | `classifyDeviceError`：读 ssh2 的 `.level` 分成 auth / hostKey / unreachable / transport |
| `ssh/src/channel-process.ts` | **关键接缝**：实现 dsh 的 `SubprocessHandle`，harness 那边看到的是它熟悉的对象，字节始终没出进程 |
| `ssh/src/shell-quote.ts` | 只做引用，不重写命令文本 |
| `terminal-bridge/src/pty.ts` | 新增 `DeviceShellSession`；`RawSessionBase` 抽出本地与设备共用的 settle/回放/读取/信号 |

删除：`ssh/src/runner.ts`（ssh 命令行拼装 + ControlMaster）、askpass helper、
`ssh-client.ts`（Windows 上的 ssh 解析）。随之 `dshell/ssh/ctl/`  sockets 也没了，
数据根迁移不再需要为它开 skip 名单。

### 远端命令行一字未改

`LC_ALL=C` 照旧前缀，命令文本原样传递。settle 标记仍靠注入的 `PROMPT_COMMAND`
打 OSC `133;D`——容器里从设备终端的回放里能直接读到那行 `printf "\033]133;D;%s\007" "$?"`。

### 验收读数（2026-10-19，容器 + 真机）

容器是 `dshell-metrics-run`，注入的是本地最终构建的 `lib/`（原因见 §3）。

| 项 | 读数 |
|---|---|
| 连接测试 | `已连接 root@VM-0-6-ubuntu（Linux 7.0.0-30-generic） · 1096ms`，`主机密钥 SHA256:ptAAuu4t…（已信任）` |
| helper 部署 | `present`，摘要 `9b38e674…` 与设备上一致，319 ms |
| 设备终端 | 远端提示符 `root@VM-0-6-ubuntu:~#`；OSC `133;D;0` + `3008;…exit=success` |
| Ctrl+C | `sleep 30` → `exitCode: 130`（128+SIGINT） |
| 文件列举 | `/root` 带类型与大小 |
| 文件写入 | local→remote `done`，32 字节，设备上 `cat` 回读内容正确 |
| 设备搜索 | `grep -rl` 在设备上命中 |
| 无宿主 ssh | 容器内只有一条到 `:22` 的连接，来自 harness 进程自身（`ss -tnp \| grep <pid>`） |

**另做过一次容器外预检**：用纯 JS 版 ssh2（不编译原生绑定）直连真机，确认 TOFU 校验、
密码认证、exec 都通——因为容器里 `ssh2` 的 `install.js` 会被 pnpm 放行但大概率编译失败，
要先证明纯 JS 路径可用。

## 3. 没做完 / 要知道的事

### ① 容器验收走的是「注入 lib」，不是 `dshbox build`

`/usr/bin/dshbox`（0.1.8，9/22 构建）的 daemon 有个 bug：`LABEL dshbox.allow-build` 里
`@` 开头的 key 会被写成**未加引号**的 YAML，而 YAML 把行首 `@` 当保留指示符，于是
`allowBuilds:` 那张表直接解析失败：

```yaml
allowBuilds:
  @deepseek-ai/dsh-subprocess-local@0.2.1-rc.2: true   # ← bad indentation of a mapping entry
```

修复在 DSHBox 工作区里（`src-tauri/crates/dshboxd/src/sealed.rs` 的
`add_pnpm_build_approval`，会把 key 加引号；那边分支 `fix/host-launch-and-resource-slots`，
**未提交未发布**）。所以这次走的是技能 `dshell-container-acceptance` 里的
「被顶掉了：注入本地 lib」路径：

```sh
dshbox container stop <id>
cp -a packages/dshell/<pkg>lib/. <instance>/profile/profiles/web/node_modules/@nexus-aethra/dshell-<pkg>/lib/
# ssh2 是新增依赖，容器里没有，要把它的依赖闭包（ssh2/asn1/bcrypt-pbkdf/safer-buffer/tweetnacl）
# 复制进 dshell-ssh/node_modules/；build/Release 下的原生绑定不要带，走纯 JS
dshbox container start <id>
```

**接手时先确认 daemon 版本**：`strings /usr/lib/dshbox/server/linux-x64/dshboxd | grep 'reserved indicator'`
有输出说明修复已装上，可以回到 `dshbox build` 路径；没有就继续注入。

第 0 步（证明加载的是哪份代码）判据：`ls .../dshell-ssh/lib/transport/` 有四个文件、
`.../dshell-mode/lib/data-root.js` 里 `skip` 出现 0 次。

### ② 三类能力明确不支持，已写进文档

架构文档 §19 与 README（中英）都写明了，不是待办：

- **硬件密钥**（`sk-*` / FIDO / PKCS#11）——签名必须发生在持有密钥的设备或守护进程里，`ssh2` 两者都没有。
- **`~/.ssh/config`**——`ProxyJump`、`ProxyCommand`、`Include`、`Match`、per-host 选项都不读。跳板机后面的设备，得把跳板机本身作为设备登记。
- **agent 转发 / `ssh-add`**——agent 是宿主的，dshell 只用保险箱里那份凭据认证。

安全节奏也跟着变成跟随 `ssh2` 的发布计划，而不是操作系统的。版本钉死 `1.17.0`。

### ③ 一个已经犯过并且修掉的错，值得记住

这次重写 `passphrase.spec.ts` 时，把测试服务器的**真实 root 口令**当 fixture 写进了断言
（`expect(config.password).toBe('20250406Ilove!')`）。HEAD 里从来没有这个值——原来的测试
用的是 `/k/web.password` 这种假路径。提交前已全部换成 `'not a real password'`，7 个测试重跑通过。

**口令本身已经进过本次会话记录，wpplight 需要改密。** 教训：往测试里写凭据 fixture 时，
值必须是显然为假的，哪怕"只是本地跑跑"。

### ④ 真实 `/compact` 回路仍未验

上一轮交接就卡在这：dev 宿主报 `MISSING_CREDENTIAL … provider route "minimax-cn"`。
需要一把能用的模型 key，然后起宿主 → 建一个会持续长输出的终端会话 → `/compact` → 再提一个问题 →
看时间线先后是否还乱。判据在架构文档 §12 与 `block-model.spec.ts`。

## 4. 演示视频资产（未跟踪，勿 `git add -A`）

8 个成片在 `assets/`。打码与复扫结论仍是 2026-10-16 那次的，**没有重新扫过**：

| 文件 | 时长 | 内容 |
|---|---|---|
| `dshell-promo-1440p.mp4` / `-720p.mp4` | 357.0 s（595 拍 @100 BPM） | 交叉合成成片：开屏 + 六张讲解卡分别插在六个分镜前 + 尾卡 |
| `dshell-promo-intro-1440p.mp4` / `-720p.mp4` | 52.8 s（88 拍） | 只有讲解卡的 reel |
| `dshell-demo-1800p.mp4` | 325.8 s | 演示片（分镜合集） |
| `logo-intro-methods-compare.mp4` / `logo-intro-with-demo.mp4` / `logo-intro.mp4` | — | 开屏设计稿 |

时间轴换算（1 拍 = 0.6 s）与拍数表 `SEG`、录制环境（`Xvfb :99` + Chrome + x11grab）、
以及 `/tmp/intro2/` 中间源已丢失这些背景，见上一版交接文档
（`git show 73c426c:docs/dshell-handoff-2026-10.md`）。

**隐私打码**：设备公网 IP 已按马赛克遮挡，复扫判据是 tesseract 5.5.0、字符白名单 `0-9.`、
每 4 s 抽一帧、2× 放大后 OCR、`grep '43\.138'` 计数。讲解卡 3 的文案里**故意**留着
`43.138.••.•••`（只露前两段）。任何要对外发布的东西出现这个 IP，都要走同一套打码 + 复扫到 0 命中。

## 5. 跨平台结论（已因本次改动而改变）

**以前**：SSH 设备会话依赖宿主 `ssh`，Windows stock 装直接不可用。

**现在**：设备侧（连接、认证、主机密钥、helper、终端）全部是进程内的 `ssh2`，
不依赖宿主有没有 ssh、也不读 `~/.ssh`。这是本次改动在 Windows/macOS 上最大的收益。

仍然只在 Linux 上成立的两处（都在 `catch` 后返回 `undefined`，且 `undefined` 与 `null`
是刻意区分的——"无法判断" ≠ "没有前台程序"，所以不会误退全屏）：

- 终端前台程序检测：`terminal-bridge/src/foreground.ts` 读 `/proc/<pid>/stat`
- 会话 shell 的 cwd 解析：`terminal-bridge/src/index.ts` 的 `readlink /proc/<pid>/cwd`

设备侧 helper 明确允许 `linux|darwin`（`ssh/src/helper/run.ts:90`）——那是**远端设备**的
平台，与宿主 OS 无关；`sha256sum` 也只在设备上执行。

**前提仍要说清**：以上是读代码 + Linux 本机跑出来的推断，没有在真机 macOS 上验过；
`node-pty@1.2.0-beta.15` 在 mac 上的原生编译、dsh 桌面版 mac 包本身都没验过。

## 6. 交接纪律（先读这条再看代码）

- **绝不 `git add -A`**。工作区的 `??` 有 8 个成片 mp4，只按路径 add；未跟踪文件不删。
- **不直接提交 main**；合 main、发版、打 tag、推分支——先问 wpplight。本次已获授权推
  `feat/dshell-device-metrics`，**仅此一次**，不代表以后可以自己推。
- **凭据**：npm 发布 token 在 `~/.npmrc.publish`（只有 `NPM_CONFIG_USERCONFIG=/home/wpp/.npmrc.publish`
  时才生效；默认 `~/.npmrc` 里那枚**已失效**，别被骗）。`~/.bashrc` 把 registry 导成 npmmirror，
  所以发布/查版本要显式 `--registry=https://registry.npmjs.org/`。
  **SSH 设备（`root@43.138.••.•••`）的口令不在仓库里、也不要打印内容**；要用来真机验收时
  当场问 wpplight，用完即弃。别把真实口令写进任何测试 fixture（见 §3 ③）。
- **发布必须 `pnpm publish`**（`npm publish` 会把 `workspace:` 原样发出去，装的人
  `EUNSUPPORTEDPROTOCOL`；0.1.4 就是这么报废的）。加 `--no-git-checks --access public`，
  11 个包按依赖序、`dshell-bundle` 最后。发完 packument 有 2–3 分钟读侧延迟，
  轮询到全部跟上再改 README 的 pin（中英两个 README 同 commit）。
  坏版本撤不掉（token 是 bypass-2FA granular，`npm unpublish` 403），只能 `npm deprecate` + 改版本号。
- **调试宿主只留一个实例**，临时起的当场收尾。
- 改完就测并把读数读回来（文本/几何/控制台），别拿"门禁绿"当"功能对"。
  **门禁绿也会漏**：本次那个 `channelOf` flaky 就是门禁绿着、十次里挂一次——
  判据是"连续跑十次全绿"，不是"跑一次绿"。

## 7. 接手第一步

```sh
cd /home/wpp/nexus/Nexus-Shell
git status -sb                 # 应显示与 origin/feat/dshell-device-metrics 同步
pnpm i
pnpm run test && pnpm run typecheck     # 期望 561/561 + 干净
pnpm --filter "@nexus-aethra/dshell-*" run build
git status --short             # 只剩 assets/*.mp4 八个未跟踪，就是干净现场
```

想复现设备验收，按 §2 的表逐项跑；起容器用 `dshell-container-acceptance` 技能，
先读 §3 ① 判断该走 build 还是注入。

**分支模型**（`dshell-setup.md` 写死了这条）：`main` 只放已发布的线，**不直接提交**；
一个开发方向一条分支，走 PR **squash-merge** 进 main，合完删分支。判断"某分支的活是否已进 main"
要**比树**（`git diff --stat origin/main <branch>` 为空即已进），不要看祖先关系——squash 之后
祖先关系必然骗人。

文档索引在 [`docs/README.md`](./README.md)；本次改动的规范在
[`dshell-architecture.md` §19](./dshell-architecture.md)（设备传输层）与 §15（数据根）。

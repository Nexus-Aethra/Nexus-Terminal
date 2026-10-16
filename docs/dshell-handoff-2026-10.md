# dshell 交接文档（2026-10-16）

给接手的人。这份只写**当下现场状态**与**为什么**——架构/协议/包职责看
[`dshell-architecture.md`](./dshell-architecture.md)、[`dshell-packages.md`](./dshell-packages.md)，
上手顺序看 [`README.md`](./README.md)。

本文里的每条读数都是 2026-10-16 在本机（Linux，`/home/wpp/nexus/Nexus-Shell`）复跑或复扫得到的，
命令一起写出来了，可以直接推翻我。

## 0. 三句话状态

1. **0.1.13 已经发完并收尾**：11 个包在 npm 上、tag `dshell-v0.1.13` 在 origin、桌面版 profile 已升级。
2. **有一批改动没提交**：分支 `fix/compaction-block-order` 与 `main` 同一个 commit（`bb59132`），
   全部工作在**工作区**里（14 个源码文件改动 + 5 个新源码/测试文件），门禁与浏览器回放验收都过了，只差提交/合 main/发版。
3. **两件事卡在环境上没做完**：真实 `/compact` 回路（缺模型 key）、dshbox 容器验收（GitHub 克隆被挡）。

## 1. 现场快照

| 事项 | 读数 | 怎么复核 |
|---|---|---|
| 当前分支 | `fix/compaction-block-order`，**0 个 commit 领先 main** | `git status -sb`、`git rev-list --count main..HEAD` |
| main / origin/main / HEAD | 都是 `bb59132`（`docs(dshell): the install recipe's example names 0.1.13`） | `git rev-parse --short HEAD main origin/main` |
| 工作区改动 | 15 files changed, 169 insertions(+), 191 deletions(-)（14 个源码/文档 + `docs/README.md` 索引） | `git diff --stat` |
| 未跟踪文件 | 5 个新源码/测试（`packages/dshell/mode/src/client/images.d.ts`、`running-whale@2x.png`、`mode/tests/block-model.spec.ts`、`mode/tests/agent-block.spec.ts`、`terminal-bridge/tests/blocks.spec.ts`）、`scripts/dshell-ui-order-acceptance.mjs`、本文件、`assets/*.mp4`（8 个成片） | `git status --short` |
| 测试 | 40 files / **418 tests passed**，1.85s | `pnpm run test` |
| 类型 | 干净（`tsc -b tsconfig.host.json && tsc -b tsconfig.client.json`，exit 0） | `pnpm run typecheck` |
| 客户端构建 | `pnpm --filter @nexus-aethra/dshell-mode run build` → `lib/client.js` 1.09 MB（1 089 869 B，199 ms） | — |
| 工具链 | Node `v24.21.0`（nvm）、pnpm `9.15.0`（`~/.local/bin/pnpm` 包装脚本）——版本是钉死的，理由见 [`dshell-setup.md`](./dshell-setup.md) | `node -v`、`pnpm -v` |
| npm 上 | `@nexus-aethra/dshell-bundle` → `0.1.13` | `NPM_CONFIG_USERCONFIG=~/.npmrc.publish npm view @nexus-aethra/dshell-bundle version --registry=https://registry.npmjs.org/` |
| tag | `dshell-v0.1.13` → `bb59132`，**已在 origin** | `git ls-remote --tags origin refs/tags/dshell-v0.1.13` |
| 桌面版 | `~/.dsh/profiles/desktop/package.json` 第 16 行 pin `0.1.13`，头像已验收 | `grep -n dshell-bundle ~/.dsh/profiles/desktop/package.json` |
| 宿主检出 | `dsh/`（未跟踪）在 `dsh-v0.2.0-rc.2` = `639ed01539`；根 `package.json` 用 `link:./dsh/packages/...` 覆盖全部 dsh 包 | `git -C dsh describe --tags` |
| README 前置条件 | `README.md:60` 写 **dsh `0.2.0-rc.2`** | — |

## 2. 在途改动（未提交）：三件事

### ① 压缩后块顺序回归（分支名的由来）

**症状**：终端会话里只要触发过一次 `/compact`，之后再提问，时间线的块就错位。

**根因**：斜杠命令**没有 turn 号**。旧判据写的是 `block.turn === host.turn`，
于是"两边都没有 turn 号"被当成了身份匹配——压缩产生的承载块抢到第一个无 turn 的位置，
把它后面所有无 turn 的历史一起拖过去。

**修法**：承载块带上 `commandId`；无 turn 号时按 `commandId` 匹配，只有 commandId 也缺失时
才回退到时间戳。锚点：

- [`packages/dshell/mode/src/client/block-model.ts:102`](../packages/dshell/mode/src/client/block-model.ts#L102) — 匹配判据
- [`packages/dshell/mode/src/client/blocks.ts:56`](../packages/dshell/mode/src/client/blocks.ts#L56)、[:373](../packages/dshell/mode/src/client/blocks.ts#L373) — 折叠侧带上 `commandId`
- [`packages/dshell/terminal-bridge/src/blocks.ts:119`](../packages/dshell/terminal-bridge/src/blocks.ts#L119)、[:143](../packages/dshell/terminal-bridge/src/blocks.ts#L143)、[:194](../packages/dshell/terminal-bridge/src/blocks.ts#L194) — host 块记录/恢复 `commandId`
- [`packages/dshell/terminal-bridge/src/index.ts:387`](../packages/dshell/terminal-bridge/src/index.ts#L387)、[:401](../packages/dshell/terminal-bridge/src/index.ts#L401) — `command/run` 事件开一个带 commandId、无 turn 的块
- 回归测试：`packages/dshell/mode/tests/block-model.spec.ts`、`packages/dshell/terminal-bridge/tests/blocks.spec.ts`
- 规范已写进 [`dshell-architecture.md` §12](./dshell-architecture.md)（"Slash commands such as `/compact` have no turn number…"）

### ② 工具调用按原生会话的顺序交叉

**症状**：卡片把一次回合里的工具调用**全聚到一起**，和会话文本失去先后。

**修法**（对齐原生 dsh 会话的分组规则）：

- [`packages/dshell/mode/src/client/session-rows.ts:212`](../packages/dshell/mode/src/client/session-rows.ts#L212) — 一条 `assistant/message` 按 `content` 原序切成多行（文本/推理/调用交替），每行带 `callId` 与 `callGroup`（[:37](../packages/dshell/mode/src/client/session-rows.ts#L37)）
- `agent-block.ts` 的 `segmentsOf` / `buildSteps(rows, startedAt, t, resultRows)` / `groupRuns` — 保持流内顺序；**只有同一条消息 + 同类调用**才合并成计数组，答案与 steering 打断分组；结果按 `callId` 回到自己那次调用（哪怕中间插了 steering 消息）；结果有、调用在已加载历史之外的孤儿行**留在原位可见**，不丢
- 折叠语义：折叠只藏过程行，答案始终按原位置显示
- 文案：`locales.ts` 的 `agent.group.commands` → `agent.group.calls`（zh ` 次调用` / en ` calls`）

### ③ 图标换成 dsh 官方鲸尾

dsh 原生早已不在"思考中"用整只鲸鱼 logo，用的是**鲸尾**。

- [`packages/dshell/mode/src/client/dsh-icons.ts:12`](../packages/dshell/mode/src/client/dsh-icons.ts#L12) — `WHALE_TAIL_PATH`，逐字取自原生 `RunningWhaleTail.tsx`
- [`packages/dshell/mode/src/client/agent-block.ts:380`](../packages/dshell/mode/src/client/agent-block.ts#L380) — `WhaleMark`：14px 图标盒里放 28×28 的原生 APNG 蒙版（`running-whale@2x.png`，与 `dsh/packages/client/ui-chat/src/client/chat/running-whale@2x.png` **字节相同**，测试里有断言）+ `TextShimmer` 文案微光
- 动效门控与原生一致：`@supports (mask-mode:alpha)`、`prefers-reduced-motion: no-preference`、`forced-colors: none`，否则回落静态鲸尾
- 构建：`packages/dshell/mode/tsdown.config.ts` 加了 `loader: { '.png': 'base64' }` 并把 png 复制进 `lib/client/`；`src/client/images.d.ts` 声明模块
- 用过的地方：回合卡头、侧边栏终端区行（`terminal-section.ts`）、初始化页 hero（`creation-panel.ts`）——都是 `code` → `whaleTail`
- 测试：`packages/dshell/mode/tests/agent-block.spec.ts`（11 项，含 `renderToStaticMarkup` 的 DOM 断言、蒙版与原生 APNG **字节相同** + `acTL` 块存在）

### 浏览器回放验收读数（2026-10-16，:3080 宿主 + 最终构建）

```json
{ "order": ["answer","group","text","answer","tool","answer"],
  "mask": { "image": [28,28], "box": [14,14], "animated": "block", "still": "none" },
  "reduced": { "animated": "none", "still": "block" },
  "collapsedAnswers": 4, "streamSettled": true, "pageErrors": [] }
```

跑法（脚本已从 `/tmp` 收进仓库）：

```sh
cd dsh && nohup node apps/cli/lib/bin.js web --no-open --port 3080 > /tmp/dsh-web.log 2>&1 &
grep -oE 'http://127.0.0.1:3080/\?token=[A-Za-z0-9_-]+' /tmp/dsh-web.log   # 每次重启 token 都换
node scripts/dshell-ui-order-acceptance.mjs 'http://127.0.0.1:3080/?token=<刚取的那个>'
```

脚本里两处是**本机路径**，换机器要改：第 2 行的 `playwright-core` 绝对路径、第 4 行的 chrome 可执行文件。
它自己造合成事件（不依赖模型），跑完会把测试会话和两个探针会话归档。

## 3. 没做完的两件事

### #99 真实"压缩成功 → 再提问"的回路

合成事件与单测覆盖了判据，但**真机 `/compact` 没跑成**：dev 宿主报
`MISSING_CREDENTIAL … provider route "minimax-cn"`。收尾需要一把能用的模型 key，然后：
起 :3080 → 建一个会持续长输出的终端会话 → `/compact` → 再提一个问题 → 看时间线先后是否还乱。
判据在 §12 文档与 `block-model.spec.ts` 里。

### #94 dshbox 容器（rc.2 + 0.1.13）验收

Boxfile 已经改到位（`~/nexus/DSHBox/examples/boxfile-dshell.dsh`，**DSHBox 工作区里未提交**，
那边分支是 `fix/host-launch-and-resource-slots`）：`FROM …:dsh-v0.2.0-rc.2`、
`allow-build=@nexus-aethra/dshell-bundle@0.1.13,node-pty@1.2.0-beta.15`、bundle + `dsh-ssh`
+ 那 7 条上游行全部钉 `0.2.0-rc.2`。

**卡住的地方**：`dshbox pull template github.com/deepseek-ai/deepseek-harness:dsh-v0.2.0-rc.2`
报 `Git clone failed: SSL error … github.com may be blocked`。要么配
`dshbox config set mirror.github <可达镜像>`，要么换网络。另外这次 `dshbox ps` 20s 没返回，
接手时先确认 `dshboxd` 状态再判断是不是网络问题。

> 为什么必须补那 7 条上游行、以及"link 的开发 profile 能跑"为什么不能当依据：
> 发布与验证两节在 [`dshell-packages.md`:581](./dshell-packages.md#L581)（The publishing environment）与
> [:620](./dshell-packages.md#L620)（Verifying a published artifact）。

### 还有一件要你（和 wpplight）决定

这批改动**是否提交、是否合 main、是否发 0.1.14**。仓库里有两条并行的走法，问清楚再动：

- 特性线（`dshell-setup.md` 的分支模型）：分支 → PR → **squash-merge** 进 main → 删分支。
- 发布线（0.1.13 实际走的）：分支上提版本号 → 发布 → 分支上提 README pin → `git merge --ff-only` 进 main
  → `git tag -a dshell-vX.Y.Z` → 推 main + tag。

合 main、发布、打 tag 都属于对外动作——**先问 wpplight**。

## 4. 演示视频资产

### 成片（`assets/`，未跟踪）

| 文件 | 时长 | 内容 |
|---|---|---|
| `dshell-promo-1440p.mp4` / `-720p.mp4` | 357.0 s（595 拍 @100 BPM） | **交叉合成成片**：开屏 + 六张讲解卡分别插在六个分镜前 + 尾卡 |
| `dshell-promo-intro-1440p.mp4` / `-720p.mp4` | 52.8 s（88 拍） | 只有讲解卡的 reel |
| `dshell-demo-1800p.mp4` | 325.8 s | 演示片（分镜合集） |
| `logo-intro.mp4` | 3.25 s @60 | 设计好的开屏（合成时 tpad 补帧到正好 3.6 s = 6 拍） |

### 时间轴换算（1 拍 = 0.6 s）

开屏 0–3.6 · ①卡 3.6–10.8 / 分镜1 10.8–25.8 · ②卡 25.8–33.0 / 分镜2 33.0–64.2 ·
③卡 64.2–71.4 / 分镜3 71.4–99.6 · ④卡 99.6–106.8 / 分镜4 106.8–194.4 ·
⑤卡 194.4–201.6 / 分镜5 201.6–310.2 · ⑥卡 310.2–317.4 / 分镜6 317.4–351.0 · 尾卡 351.0–357.0。

拍数表就是 `~/nexus/dshell-demo/stage/music.mjs` 里的 `SEG`
（`[6,12,25,12,52,12,47,12,146,12,181,12,56,10]`，`argv[4]` 可传别的表），配乐 `/tmp/score-c5.wav`、`/tmp/score-reel5.wav`。

### 中间源丢了，这点要知道

`/tmp/intro2/` 随 `/tmp` 清理**已消失**：讲解卡页面 `intro5.html`、逐帧渲染 `render5.mjs`、
合成 `assemble5.sh`、打码 `demo-mask.py`、扫描 `scan-ip.sh` 都没了。**成片是好的**，
但要改卡片文案或重新合成，就得重建这套脚本。还在的：

- `~/nexus/dshell-demo/stage/final/s1..s6.mp4` — 六个分镜的**原始录制**（未打码）
- `~/nexus/dshell-demo/stage/music.mjs` — 卡点配乐生成器（含 `SEG`）
- `~/nexus/dshell-demo/stage/` 其余：`run.mjs`（导演层：推镜/字幕/光标）、`prep-take*.mjs`（各分镜录制脚本）、`cards.mjs`、`stills.mjs`
- 录制环境：`Xvfb :99` + Chrome `--ozone-platform=x11` + x11grab

### 隐私打码（公网 IP）

演示里出现的设备公网 IP（本文一律写成 `43.138.••.•••`）已按**马赛克**（不是全黑块）遮挡。复扫判据（2026-10-16）：
tesseract 5.5.0、字符白名单 `0-9.`、每 4 s 抽一帧、2× 放大后 OCR，`grep '43\.138'` 计数。

做法（可复现）：OCR 定位矩形 → `crop=w:h:x:y,scale=iw/10:ih/10:flags=neighbor,scale=w:h:flags=neighbor`
+ `overlay=x:y:enable='between(t,a,b)'`。**坑**：ffmpeg 滤镜图里 `split` 的输出要一次列全再写各条链，
否则报 `No such filter: ''`。

四支成片的复扫读数：

| 文件 | 抽帧 | `43.138` 命中 | 判定 |
|---|---|---|---|
| `dshell-promo-1440p.mp4` | 90 | 1（t=68 s） | 命中点是卡片 3 的文案 `43.138.••.•••`，**非完整 IP** |
| `dshell-promo-720p.mp4` | 90 | 1（t=68 s） | 同上 |
| `dshell-promo-intro-1440p.mp4` | 13 | 2（t=20、24 s） | 同一段卡片文案（reel 里卡 3 落在 18–25.2 s） |
| `dshell-demo-1800p.mp4` | 82 | 0 | 干净 |
| 阳性对照 `stage/final/s4.mp4`（未打码源） | 44 | **36** | 检测器测得到 → 上面的 0 不是假阴性 |

**留给接手的判断**：讲解卡 3 的文案里**故意**写着 `43.138.••.•••`（只露前两段）。要连前两段都不出现，
就在那 7.2 s 窗口再加一层马赛克 overlay（一行滤镜），然后复扫。

> 任何要对外发布的东西里出现这个 IP，都要走同一套打码 + 复扫到 0 命中。

## 5. macOS 兼容性结论（带前提）

**结论**：能装能用；两处能力在 mac 上**静默降级**，不会崩。

- 终端前台程序检测（TUI 全屏自动判定）：[`terminal-bridge/src/foreground.ts:137`](../packages/dshell/terminal-bridge/src/foreground.ts#L137) 读 `/proc/<pid>/stat`
- 会话 shell 的 cwd 解析：[`terminal-bridge/src/index.ts:989`](../packages/dshell/terminal-bridge/src/index.ts#L989) `readlink /proc/<pid>/cwd`

两处都 `catch` 后返回 `undefined`，而 `undefined` 与 `null` 是**刻意区分**的（"无法判断" ≠ "没有前台程序"），
所以在没有 `/proc` 的平台上不会误退出全屏，只是不再自动进/出。其余（PTY、时间线、SSH 设备会话、
文件/管道/用量）不依赖 Linux 专有接口。SSH 设备侧 helper 明确允许 `linux|darwin`
（[`ssh/src/helper/run.ts:90`](../packages/dshell/ssh/src/helper/run.ts#L90)）；`sha256sum` 只在**远端设备**上执行，与宿主 OS 无关。

**前提要说清**：这是读代码 + 本机（Linux）跑的**推断**，没有在真机 macOS 上跑过；
`node-pty@1.2.0-beta.15` 在 mac 上的原生编译、dsh 桌面版 mac 包本身都没验过。要在 mac 上落地，
先做这两项实测再下结论。

## 6. 交接纪律（先读这条再看代码）

- **绝不 `git add -A`**。工作区的 `??` 有 8 个成片 mp4 和别人的东西，只按路径 add；未跟踪文件不删。
- **不直接提交 main**；合 main、发版、打 tag、推分支以外共享动作——先问 wpplight。
- **凭据**：npm 发布 token 在 `~/.npmrc.publish`（只有 `NPM_CONFIG_USERCONFIG=/home/wpp/.npmrc.publish` 时才生效；
  默认 `~/.npmrc` 里那枚**已失效**，别被骗）。`~/.bashrc` 把 registry 导成 npmmirror，所以发布/查版本要显式
  `--registry=https://registry.npmjs.org/`。**SSH 设备（`root@43.138.••.•••`）的口令不在仓库里、也不要打印内容**；
  本机现有位置要问 wpplight（`profile/dshell/ssh/keys/` 这个路径在当前机器上已不存在，别照着找）。
- **发布必须 `pnpm publish`**（`npm publish` 会把 `workspace:` 原样发出去，装的人 `EUNSUPPORTEDPROTOCOL`；
  0.1.4 就是这么报废的）。加 `--no-git-checks --access public`，11 个包按依赖序、`dshell-bundle` 最后。
  发完 packument 有 2–3 分钟读侧延迟，轮询到全部跟上再改 README 的 pin（中英两个 README 同 commit）。
  坏版本撤不掉（token 是 bypass-2FA granular，`npm unpublish` 403），只能 `npm deprecate` + 改版本号。
- **调试宿主只留一个实例**。:3080 是 wpplight 自己的常驻实例，重启已被当作调试流程的一部分，但临时起的要当场收尾。
- 改完就测并把读数读回来（文本/几何/控制台），别拿"门禁绿"当"功能对"。

## 7. 接手第一步

```sh
cd /home/wpp/nexus/Nexus-Shell
pnpm i                      # dsh 包 link 到 ./dsh 检出（未跟踪，当前在 dsh-v0.2.0-rc.2）
pnpm run test && pnpm run typecheck     # 期望 418/40 + 干净
pnpm --filter "@nexus-aethra/dshell-*" run build
git status --short          # 14 个修改 + 5 个新源码/测试文件（另有一批未跟踪的成片 mp4 与本文件），就是你要接手的东西
```

然后按 §2 末尾跑一次浏览器回放验收，确认现场与你一致，再决定提交与发布。

**分支模型**（`dshell-setup.md` 写死了这条）：`main` 只放已发布的线，**不直接提交**；
一个开发方向一条分支，走 PR **squash-merge** 进 main，合完删分支。所以判断"某分支的活是否已进 main"
要**比树**（`git diff --stat origin/main <branch>` 为空即已进），不要看祖先关系——squash 之后祖先关系必然骗人。
发布那一次的例外（0.1.13 走的 `merge --ff-only` + tag）见 §3。
文档索引在 [`docs/README.md`](./README.md)；本次三项改动的规范都并进了
[`dshell-architecture.md` §12](./dshell-architecture.md)。

# dsh-im-bubble

[English](#english) · [中文](#中文)

---

## English

Split one reply into several IM bubbles.

`@xmanrui/dsh-im` sends the final answer as **one** message, and only splits it when
it exceeds 1,800 characters. There is no way for the model to say "this sentence
belongs in its own bubble". This plugin adds that: it registers a tool that sends a
piece of text immediately through dsh-im's public proactive-delivery service
(`ctx.dshIm.send`), so each call lands as a separate message before the final reply.

It does **not** replace or patch `dsh-im`. It only calls the documented delivery
contract, so upgrading dsh-im does not break it.

### Tools

| Tool | What it does |
| --- | --- |
| `im_say` | Send one piece of text as its own message right now. Optional `botId` / `targetId` / `format` (`plain`, `markdown`). |
| `im_targets` | Read-only list of connected bots and their delivery targets. Use it when `im_say` reports an unknown or ambiguous target. |
| `im_target_add` | Create a delivery target (so `im_say` knows who to send to) without clicking through the settings UI. |

`im_say` resolves the target in this order: the arguments you pass → the plugin
config (`botId` / `targetId`) → the only target that exists. With zero targets it
tells you to create one; with several it lists them and asks you to pick.

### Requirements

- `@xmanrui/dsh-im` (or a compatible fork) installed and at least one bot connected.
- One delivery target for that bot, created either in **Settings → IM bots → ⚙ → New
  target**, or with `im_target_add`.

### Install

```sh
dsh plugin add dsh-im-bubble
```

From source:

```sh
dsh plugin add git+https://github.com/nolighter/dsh-im-bubble.git
```

Or copy the folder into `<dsh profile>/node_modules/dsh-im-bubble` and append to
`cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-im-bubble
      name: dsh-im-bubble
```

### Config

Optional, set through the plugin config in the DSH settings (or in the patch entry):

```yaml
- insert:
    - id: dsh-im-bubble
      name: dsh-im-bubble
      config:
        botId: wx_xxxxxxxxxxxxxxxx
        targetId: tgt_xxxxxxxxxxxxxxxx
```

### Notes

- The channel still sends the final answer itself. `im_say` is for the extra
  bubbles; using it for the whole answer duplicates the text.
- A target id is stable and cannot be edited after creation. Delete and recreate if
  the route is wrong.
- `im_target_add` accepts the route as JSON. For WeChat the shape is
  `{"toUserId":"..."}` with `kind: "user"`; other channels differ per dsh-im's own
  validation.

### License

MIT

---

## 中文

把一条回复拆成好几个气泡发出去。

`@xmanrui/dsh-im` 的最终回复只会作为**一条**消息发出，而且只有超过 1800 字才会
按换行切段。模型没法主动说「这一句单独发」。这个插件补上这一块：它注册的工具
直接调用 dsh-im 公开的主动投递服务 `ctx.dshIm.send`，每调一次就是一条独立消息。

它**不替换也不修改** `dsh-im`，只调用已公开的投递契约，所以 dsh-im 升级不会冲突。

### 工具

| 工具 | 作用 |
| --- | --- |
| `im_say` | 立刻把一段文本作为独立消息发出。可选 `botId` / `targetId` / `format`（`plain`、`markdown`）。 |
| `im_targets` | 只读列出已连接的机器人和它们的投递目标。`im_say` 说找不到或目标不唯一时用它确认。 |
| `im_target_add` | 新建一个投递目标（告诉 `im_say` 发给谁），不用去设置界面点。 |

`im_say` 找目标顺序：参数 → 插件配置（`botId` / `targetId`）→ 当前唯一的目标。
一个目标都没有时会提示去建；有多个时会列出来让你选。

### 依赖

- 已安装 `@xmanrui/dsh-im`（或兼容分支），并至少连接了一个机器人。
- 该机器人下有一个投递目标：在 **设置 → IM机器人 → ⚙ → 新建目标** 建，或者用
  `im_target_add` 建。

### 安装

```sh
dsh plugin add dsh-im-bubble
```

从源码装：

```sh
dsh plugin add git+https://github.com/nolighter/dsh-im-bubble.git
```

或者把目录复制到 `<dsh profile>/node_modules/dsh-im-bubble`，再在
`cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: dsh-im-bubble
      name: dsh-im-bubble
```

### 配置

可选，写在插件配置或 patch 条目里：

```yaml
- insert:
    - id: dsh-im-bubble
      name: dsh-im-bubble
      config:
        botId: wx_xxxxxxxxxxxxxxxx
        targetId: tgt_xxxxxxxxxxxxxxxx
```

### 注意

- 最终答复仍由通道自己发送。`im_say` 只负责多出来的那些气泡；用它发整段答复会重复。
- 目标 id 建好之后不能改。路线填错了就删掉重建。
- `im_target_add` 的 route 是 JSON 字符串。微信的形状是 `{"toUserId":"..."}` 配
  `kind: "user"`；其他渠道按 dsh-im 自己的校验来。

### 许可

MIT

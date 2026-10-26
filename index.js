/**
 * dsh-im-bubble — 分条发送插件。
 *
 * 目的:IM 通道只在最终回复超过 1800 字符时才切段,模型没法主动把一句话
 * 单独发成一条。这个插件注册 im_say,直接调用 dsh-im 的主动投递服务
 * (ctx.dshIm.send) 把一段文本立刻发出去,于是可以一句一个气泡地聊。
 *
 * 为什么不用 message_break 那种"宿主拆段":那条路要替换整个 dsh-im 包;
 * 主动投递是 dsh-im 公开的稳定契约,升级不冲突。
 */
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-im-bubble'
export const inject = ['tools']

const LOG_PREFIX = '[dsh-im-bubble]'

function report(ctx, text) {
  console.error(LOG_PREFIX, text)
  try {
    if (ctx.logger && typeof ctx.logger.error === 'function') ctx.logger.error(`${LOG_PREFIX} ${text}`)
  } catch { /* 日志缺席不连坐 */ }
}

/**
 * 冷启动期 ctx.tools 可能还没就绪:宿主有 ctx.inject 时等 tools 服务 ACTIVE
 * 再注册,dsh-meme 同样处理过这个时序坑。
 */
function whenReady(ctx, label, register) {
  const run = (resolved) => {
    try {
      // 用 inject 回调给的 ctx 注册:它上面才带着已就绪的 dshIm 服务
      register(resolved || ctx)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (/duplicate/i.test(detail)) return
      report(ctx, `${label} 注册失败: ${detail}`)
    }
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools', 'dshIm'], run)
      return
    } catch { /* 退回同步注册 */ }
  }
  run()
}

function textOf(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text
}

function routeLabel(target) {
  const bits = [target?.targetId, target?.name, target?.kind].filter(Boolean)
  return bits.length ? bits.join(' / ') : JSON.stringify(target)
}

/**
 * 找一个可用的投递目标。参数优先,其次 config,最后自动找唯一目标。
 * 返回 { botId, targetId, candidates } —— candidates 非空时表示没法唯一确定。
 */
async function resolveRoute(ctx, config, botId, targetId) {
  const wantedBot = textOf(botId) || textOf(config?.botId)
  const wantedTarget = textOf(targetId) || textOf(config?.targetId)
  const dshIm = ctx.dshIm
  if (!dshIm || typeof dshIm.send !== 'function') {
    return { error: 'dsh-im 的主动投递服务不可用(ctx.dshIm.send 缺失),先确认 IM 插件已启用。' }
  }
  if (wantedBot && wantedTarget) return { botId: wantedBot, targetId: wantedTarget }

  let bots = []
  try {
    bots = await dshIm.listBots()
  } catch (error) {
    return { error: `读取机器人列表失败: ${error?.message || error}` }
  }
  if (!Array.isArray(bots) || bots.length === 0) {
    return { error: '没有已连接的机器人。先在 设置 → IM机器人 里连接一个。' }
  }
  const scoped = wantedBot ? bots.filter((bot) => bot.botId === wantedBot) : bots
  if (scoped.length === 0) {
    return { error: `找不到机器人 ${wantedBot}。现有: ${bots.map((b) => `${b.botId}(${b.channel})`).join('、')}` }
  }
  const found = []
  for (const bot of scoped) {
    let targets = []
    try {
      targets = await dshIm.listTargets(bot.botId)
    } catch (error) {
      report(ctx, `listTargets(${bot.botId}) 失败: ${error?.message || error}`)
      continue
    }
    for (const target of Array.isArray(targets) ? targets : []) {
      found.push({ botId: bot.botId, channel: bot.channel, target })
      if (wantedTarget && target?.targetId === wantedTarget) {
        return { botId: bot.botId, targetId: target.targetId }
      }
    }
  }
  if (found.length === 1) return { botId: found[0].botId, targetId: found[0].target.targetId }
  if (found.length === 0) {
    return {
      error: '机器人下还没有可投递目标。打开 设置 → IM机器人 → 齿轮 → 新建目标,保存后再试。',
    }
  }
  return {
    candidates: found.map((row) => ({
      botId: row.botId,
      channel: row.channel,
      targetId: row.target?.targetId,
      label: routeLabel(row.target),
    })),
  }
}

async function doSend(ctx, config, { text, botId, targetId, format }) {
  const body = textOf(text)
  if (!body) return { ok: false, message: 'text 不能为空。' }
  const route = await resolveRoute(ctx, config, botId, targetId)
  if (route.error) return { ok: false, message: route.error }
  if (route.candidates) {
    return {
      ok: false,
      message: '有多个投递目标,必须指定 botId + targetId 之一:'
        + route.candidates.map((c) => `\n- ${c.botId} / ${c.targetId} (${c.channel} ${c.label})`).join(''),
      candidates: route.candidates,
    }
  }
  try {
    const receipt = await ctx.dshIm.send(route.botId, route.targetId, body, {
      format: format === 'markdown' ? 'markdown' : 'plain',
    })
    return {
      ok: true,
      sent: body.length,
      botId: route.botId,
      targetId: route.targetId,
      receipt: receipt === undefined ? null : receipt,
      message: `已作为独立消息发出(${body.length} 字)。`,
    }
  } catch (error) {
    return {
      ok: false,
      message: `发送失败: ${error?.message || error}`,
      code: error?.code || null,
    }
  }
}

export function apply(ctx, config = {}) {
  whenReady(ctx, 'im_targets', (rc) => rc.tools.register(defineTool({
    name: 'im_targets',
    description: '列出 IM 机器人及其投递目标(botId / targetId / 频道),只读。im_say 报"多个目标"或"没有目标"时用它确认。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute() {
      const dshIm = rc.dshIm
      if (!dshIm || typeof dshIm.listBots !== 'function') {
        return { ok: false, message: 'dsh-im 服务不可用,没法列目标。' }
      }
      let bots = []
      try {
        bots = await dshIm.listBots()
      } catch (error) {
        return { ok: false, message: `读取机器人列表失败: ${error?.message || error}` }
      }
      const rows = []
      for (const bot of Array.isArray(bots) ? bots : []) {
        let targets = []
        try {
          targets = await dshIm.listTargets(bot.botId)
        } catch (error) {
          rows.push({ botId: bot.botId, channel: bot.channel, error: String(error?.message || error) })
          continue
        }
        if (!Array.isArray(targets) || targets.length === 0) {
          rows.push({ botId: bot.botId, channel: bot.channel, targets: [] })
          continue
        }
        for (const target of targets) {
          rows.push({
            botId: bot.botId,
            channel: bot.channel,
            targetId: target?.targetId,
            label: routeLabel(target),
          })
        }
      }
      const lines = rows.map((r, i) => (r.targetId
        ? `${i + 1}. ${r.botId} / ${r.targetId} (${r.channel} ${r.label})`
        : `${i + 1}. ${r.botId} (${r.channel}) 无目标${r.error ? ' — ' + r.error : ''}`))
      return {
        ok: rows.some((r) => r.targetId),
        rows,
        message: rows.length === 0
          ? '没有已连接的机器人。'
          : `共 ${rows.length} 行:\n${lines.join('\n')}`,
      }
    },
  })))

  whenReady(ctx, 'im_target_add', (rc) => rc.tools.register(defineTool({
    name: 'im_target_add',
    description: '给机器人新建一个投递目标(im_say 用它确定"发给谁")。没有图形界面时用这个把主动发消息的地址配上。',
    parameters: {
      botId: { type: 'string', description: '机器人 id(先用 im_targets 查)' },
      kind: { type: 'string', description: '目标类型,微信为 user' },
      route: { type: 'string', description: '路由 JSON;微信形如 {"toUserId":"..."}' },
      name: { type: 'string', description: '目标显示名(可选)' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const dshIm = rc.dshIm
      if (!dshIm || typeof dshIm.createTarget !== 'function') {
        return { ok: false, message: 'dsh-im 服务不可用,没法建目标。' }
      }
      const botId = textOf(args?.botId)
      const kind = textOf(args?.kind)
      if (!botId || !kind) return { ok: false, message: 'botId 和 kind 必填。' }
      let route
      try {
        route = typeof args?.route === 'string' ? JSON.parse(args.route) : args?.route
      } catch (error) {
        return { ok: false, message: `route 不是合法 JSON: ${error?.message || error}` }
      }
      if (!route || typeof route !== 'object' || Array.isArray(route)) {
        return { ok: false, message: 'route 必须是对象。' }
      }
      const targetId = `tgt_${randomUUID().replace(/-/g, '').slice(0, 16)}`
      const target = {
        targetId,
        kind,
        route,
        ...(textOf(args?.name) ? { name: textOf(args.name) } : {}),
      }
      try {
        const created = await dshIm.createTarget(botId, target)
        return {
          ok: true,
          target: created ?? target,
          message: `已建目标 ${targetId} (${botId} / ${kind})。`,
        }
      } catch (error) {
        return {
          ok: false,
          message: `建目标失败: ${error?.message || error}`,
          code: error?.code || null,
        }
      }
    },
  })))

  whenReady(ctx, 'im_say', (rc) => rc.tools.register(defineTool({
    name: 'im_say',
    description: '立刻把一段文本作为独立 IM 消息发给用户(一条气泡),用于把回复拆成多条短消息。不要用它发真正的最终答复——最终答复由通道自动发送,用它会和最终答复重复。想在聊天里"一句一句说"时,每句(除最后一句)调一次。',
    parameters: {
      text: { type: 'string', description: '要发出去的这一句(必填,纯文本)' },
      botId: { type: 'string', description: '机器人 id(可选;只有一个目标时可省略)' },
      targetId: { type: 'string', description: '投递目标 id(可选;只有一个目标时可省略)' },
      format: { type: 'string', description: "plain(默认) 或 markdown" },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      return doSend(rc, config, args || {})
    },
  })))
}

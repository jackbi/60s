import { Common } from '../../common.ts'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import type { RouterMiddleware } from '@oak/oak'

interface ScanOptions {
  start?: number
  limit?: number
  pickIndex?: number
  pickRandom?: boolean
}

interface ScanResult {
  total: number
  list: string[]
  pickedByIndex: string | null
  randomItem: string | null
  randomIndex: number
}

class ServiceDuanzi {
  private readonly dataPath = new URL('./duanzi.json', import.meta.url)

  private parsePositiveInt(value: string | null, fallback: number) {
    if (!value) return fallback
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private buildScanResult(items: string[], options: ScanOptions): ScanResult {
    const start = options.start ?? 0
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER
    const pickIndex = options.pickIndex
    const pickRandom = Boolean(options.pickRandom)

    const list: string[] = []
    let pickedByIndex: string | null = null
    let randomItem: string | null = null
    let randomIndex = -1

    for (let index = 0; index < items.length; index++) {
      const item = items[index]

      if (pickIndex === index) {
        pickedByIndex = item
      }

      if (index >= start && list.length < limit) {
        list.push(item)
      }

      // 蓄水池抽样，避免为随机取一条而加载完整数组到内存
      if (pickRandom && Math.floor(Math.random() * (index + 1)) === 0) {
        randomItem = item
        randomIndex = index
      }
    }

    return {
      total: items.length,
      list,
      pickedByIndex,
      randomItem,
      randomIndex,
    }
  }

  private async scanFileFallback(options: ScanOptions): Promise<ScanResult> {
    const content = await readFile(this.dataPath, 'utf8')
    const parsed = JSON.parse(content)
    const items = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    return this.buildScanResult(items, options)
  }

  private async scanFile(options: ScanOptions): Promise<ScanResult> {
    const start = options.start ?? 0
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER
    const pickIndex = options.pickIndex
    const pickRandom = Boolean(options.pickRandom)

    const stream = createReadStream(this.dataPath, { encoding: 'utf8' })
    const rl = createInterface({
      input: stream,
      crlfDelay: Infinity,
    })

    let total = 0
    let parsedCount = 0
    const list: string[] = []
    let pickedByIndex: string | null = null
    let randomItem: string | null = null
    let randomIndex = -1

    try {
      for await (const line of rl) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === '[' || trimmed === ']') continue

        const normalized = trimmed.endsWith(',') ? trimmed.slice(0, -1).trim() : trimmed
        if (!normalized) continue

        let item: unknown
        try {
          item = JSON.parse(normalized)
        } catch {
          continue
        }

        if (typeof item !== 'string') continue

        parsedCount += 1
        const index = total
        total += 1

        if (pickIndex === index) {
          pickedByIndex = item
        }

        if (index >= start && list.length < limit) {
          list.push(item)
        }

        if (pickRandom && Math.floor(Math.random() * (index + 1)) === 0) {
          randomItem = item
          randomIndex = index
        }
      }
    } finally {
      rl.close()
      stream.destroy()
    }

    if (parsedCount === 0) {
      return this.scanFileFallback(options)
    }

    return {
      total,
      list,
      pickedByIndex,
      randomItem,
      randomIndex,
    }
  }

  handle(): RouterMiddleware<'/duanzi'> {
    return async (ctx) => {
      const id = await Common.getParam('id', ctx.request)

      let result: string
      let resultIndex = -1
      let total = 0

      if (id) {
        // 获取指定ID的段子
        const index = parseInt(id)
        const scan = await this.scanFile({ pickIndex: index })
        total = scan.total

        if (index >= 0 && index < scan.total && scan.pickedByIndex) {
          result = scan.pickedByIndex
          resultIndex = index
        } else {
          ctx.response.status = 404
          ctx.response.body = Common.buildJson(null, 404, `未找到ID为 ${index} 的段子`)
          return
        }
      } else {
        // 随机获取段子（默认行为）
        const scan = await this.scanFile({ pickRandom: true })
        total = scan.total

        if (!scan.randomItem) {
          ctx.response.status = 404
          ctx.response.body = Common.buildJson(null, 404, '段子数据为空')
          return
        }

        result = scan.randomItem
        resultIndex = scan.randomIndex
      }

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = result
          break

        case 'markdown':
          ctx.response.body = `# 😄 段子\n\n${result}\n\n---\n\n*第 ${resultIndex + 1} 条段子*`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson({
            index: resultIndex,
            total,
            duanzi: result,
          })
          break
      }
    }
  }

  handleBatch(): RouterMiddleware<'/duanzi/batch'> {
    return async (ctx) => {
      const page = this.parsePositiveInt(await Common.getParam('page', ctx.request), 1)
      const size = this.parsePositiveInt(await Common.getParam('size', ctx.request), 20)

      const start = (page - 1) * size
      const scan = await this.scanFile({
        start,
        limit: size,
      })

      const total = scan.total
      const totalPages = Math.max(1, Math.ceil(total / size))

      if (page > totalPages) {
        ctx.response.status = 400
        ctx.response.body = Common.buildJson(null, 400, `页码 ${page} 超出范围，最大页码为 ${totalPages}`)
        return
      }

      const list = scan.list

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = `第 ${page}/${totalPages} 页，共 ${total} 条\n\n${list.join('\n\n')}`
          break

        case 'markdown':
          ctx.response.body = `# 😄 段子列表\n\n- 当前页: ${page}\n- 每页条数: ${size}\n- 总条数: ${total}\n- 总页数: ${totalPages}\n\n${list
            .map((item, index) => `${start + index + 1}. ${item}`)
            .join('\n\n')}`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson({
            page,
            size,
            total,
            totalPages,
            list,
          })
          break
      }
    }
  }
}

export const serviceDuanzi = new ServiceDuanzi()

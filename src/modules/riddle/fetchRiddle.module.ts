import { readFile, writeFile } from 'node:fs/promises'
import { Common } from '../../common.ts'
import { config } from '../../config.ts'
import { riddleConfig } from './riddle.config.ts'

import type { RouterMiddleware } from '@oak/oak'

interface RiddleItem {
  content: string
  answer: string
}

interface JisuRiddleResponse {
  status: number
  msg: string
  result?: {
    total?: string
    pagenum?: string
    pagesize?: string
    classid?: string
    list?: Array<{
      content?: string
      answer?: string
    }>
  }
}

interface FetchCheckpoint {
  lastFetchPage: number
  updatedAt: string
}

interface UnifiedFetchCheckpoint {
  duanzi?: FetchCheckpoint
  riddle?: FetchCheckpoint
}

class ServiceFetchRiddle {
  private readonly baseUrl = `${config.fetchDataSourceApi}/miyu/search`
  private readonly fixedPageNum = 1
  private readonly fixedPageSize = 1
  private readonly defaultTimes = 10
  private readonly outputPath = new URL('./riddle.json', import.meta.url)
  private readonly checkpointPath = new URL('../../catch/fetch.json', import.meta.url)
  private localRiddlesCache: RiddleItem[] | null = null
  private checkpointCache: UnifiedFetchCheckpoint | null = null

  private parsePositiveInt(value: string | null, fallback: number) {
    if (!value) return fallback
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private pickRandomClassId() {
    const picked = Common.randomItem(riddleConfig)
    const classId = Number.parseInt(picked?.classid ?? '1', 10)
    return Number.isFinite(classId) && classId > 0 ? classId : 1
  }

  private async readLocalRiddles() {
    if (this.localRiddlesCache) {
      return this.localRiddlesCache
    }

    try {
      const content = await readFile(this.outputPath, 'utf8')
      const parsed = JSON.parse(content) as RiddleItem[]
      this.localRiddlesCache = Array.isArray(parsed) ? parsed : []
      return this.localRiddlesCache
    } catch {
      this.localRiddlesCache = []
      return this.localRiddlesCache
    }
  }

  private async readCheckpoint(): Promise<UnifiedFetchCheckpoint> {
    if (this.checkpointCache) {
      return this.checkpointCache
    }

    try {
      const content = await readFile(this.checkpointPath, 'utf8')
      const parsed = JSON.parse(content) as UnifiedFetchCheckpoint
      if (!parsed || typeof parsed !== 'object') {
        this.checkpointCache = {}
        return this.checkpointCache
      }

      this.checkpointCache = parsed
      return this.checkpointCache
    } catch {
      this.checkpointCache = {}
      return this.checkpointCache
    }
  }

  private async saveCheckpoint(state: UnifiedFetchCheckpoint) {
    this.checkpointCache = state
    await writeFile(this.checkpointPath, JSON.stringify(state), 'utf8')
  }

  private async saveLocalRiddles(riddles: RiddleItem[]) {
    this.localRiddlesCache = riddles
    await writeFile(this.outputPath, JSON.stringify(riddles), 'utf8')
  }

  private async fetchRandomOnce(classId: number) {
    const url = new URL(this.baseUrl)
    url.searchParams.set('appkey', config.jisuApiKey)
    url.searchParams.set('pagenum', String(this.fixedPageNum))
    url.searchParams.set('pagesize', String(this.fixedPageSize))
    url.searchParams.set('classid', String(classId))

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': Common.chromeUA,
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = (await response.json()) as JisuRiddleResponse
    if (data.status !== 0) {
      throw new Error(`API ${data.status}: ${data.msg || 'unknown error'}`)
    }

    const list = (data.result?.list ?? [])
      .map((item) => ({
        content: (item.content ?? '').trim(),
        answer: (item.answer ?? '').trim(),
      }))
      .filter((item) => item.content && item.answer)

    return {
      total: Number.parseInt(data.result?.total ?? '0', 10) || 0,
      pagenum: Number.parseInt(data.result?.pagenum ?? String(this.fixedPageNum), 10) || this.fixedPageNum,
      pagesize: Number.parseInt(data.result?.pagesize ?? String(this.fixedPageSize), 10) || this.fixedPageSize,
      classid: Number.parseInt(data.result?.classid ?? String(classId), 10) || classId,
      list,
    }
  }

  handle(): RouterMiddleware<'/riddle/fetch'> {
    return async (ctx) => {
      try {
        const times = this.parsePositiveInt(
          ctx.request.url.searchParams.get('times') ?? ctx.request.url.searchParams.get('count'),
          this.defaultTimes,
        )

        const checkpoint = await this.readCheckpoint()
        const oldLastFetchPage = checkpoint.riddle?.lastFetchPage ?? 0

        const localRiddles = await this.readLocalRiddles()
        const seenAnswer = new Set(localRiddles.map((item) => item.answer).filter(Boolean))
        const batchSeenAnswer = new Set<string>()
        const mergedList: RiddleItem[] = []

        let total = 0
        let fetchedCount = 0
        let addedCount = 0
        let uniqueFetchedCount = 0

        for (let i = 0; i < times; i++) {
          const classId = this.pickRandomClassId()
          const pageData = await this.fetchRandomOnce(classId)
          total = Math.max(total, pageData.total)
          fetchedCount += pageData.list.length

          for (const item of pageData.list) {
            mergedList.push(item)

            if (!batchSeenAnswer.has(item.answer)) {
              batchSeenAnswer.add(item.answer)
              uniqueFetchedCount += 1
            }

            if (seenAnswer.has(item.answer)) continue

            seenAnswer.add(item.answer)
            localRiddles.push(item)
            addedCount += 1
          }
        }

        await this.saveLocalRiddles(localRiddles)

        const newLastFetchPage = oldLastFetchPage + times

        checkpoint.riddle = {
          lastFetchPage: newLastFetchPage,
          updatedAt: new Date().toISOString(),
        }

        await this.saveCheckpoint(checkpoint)

        ctx.response.body = Common.buildJson({
          total,
          pagenum: this.fixedPageNum,
          pagesize: this.fixedPageSize,
          times,
          fetchedCount,
          uniqueFetchedCount,
          addedCount,
          localTotal: localRiddles.length,
          outputPath: this.outputPath.pathname,
          checkpoint: {
            key: 'riddle',
            lastFetchPage: newLastFetchPage,
          },
          list: mergedList,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = Common.buildJson(null, 500, `抓取失败: ${message}`)
      }
    }
  }
}

export const serviceFetchRiddle = new ServiceFetchRiddle()

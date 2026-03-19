/*
 * @Description: 抓取聚合段子数据并写入本地 JSON 文件
 * @Version: 1.0
 * @Author: wenbin
 * @Date: 2026-03-18 11:33:20
 * @LastEditors: wenbin
 * @LastEditTime: 2026-03-18 15:01:42
 * @FilePath: /hengran-global-api/src/modules/duanzi/fetchJokes.module.ts
 * Copyright (C) 2026 wenbin. All rights reserved.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { Common } from '../../common.ts'
import { config } from '../../config.ts'

import type { RouterMiddleware } from '@oak/oak'

interface JokeItem {
  id: string | null
  rawContent: string
  pic: string
}

interface JokeWithPic {
  id: string | null
  content: string
  pic: string
}

interface FetchPageResult {
  total: number
  jokes: JokeItem[]
}

interface FetchOptions {
  pageSize?: number
  requestDelayMs?: number
  requestTimeoutMs?: number
  maxRetries?: number
  times?: number
  outputPath?: URL
  outputPicPath?: URL
}

interface JisuApiResponse {
  status: number
  msg: string
  result?: {
    total?: number
    list?: Array<{
      url?: string
      content?: string
      pic?: string
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

class ServiceFetchJokes {
  private readonly baseUrl = `${config.fetchDataSourceApi}/xiaohua/all`
  private readonly defaultPageSize = 20
  private readonly defaultRequestDelayMs = 500
  private readonly defaultRequestTimeoutMs = 12000
  private readonly defaultMaxRetries = 3
  private readonly defaultStartPage = 5
  private readonly defaultTimes = 1
  private readonly outputPath = new URL('./duanzi.json', import.meta.url)
  private readonly outputPicPath = new URL('./jokes_with_pic.json', import.meta.url)
  private readonly checkpointPath = new URL('../../catch/fetch.json', import.meta.url)

  private getApiKey() {
    return config.jisuApiKey
  }

  private cleanContent(content: string) {
    if (!content) return ''

    const normalized = content.replace(/\r\n/g, '\n').trim()
    const adIndex = normalized.indexOf('热门笑话')
    if (adIndex === -1) return normalized

    return normalized.slice(0, adIndex).trim()
  }

  private extractIdFromUrl(url: string) {
    const match = url.match(/detail-(\d+)\.html/i)
    return match?.[1] ?? null
  }

  private async fetchPage(pageNum: number, options: Required<FetchOptions>): Promise<FetchPageResult | null> {
    const apiKey = this.getApiKey()
    const url = new URL(this.baseUrl)
    url.searchParams.set('pagenum', String(pageNum))
    url.searchParams.set('pagesize', String(options.pageSize))
    url.searchParams.set('sort', 'addtime')
    url.searchParams.set('appkey', apiKey)

    for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)

      try {
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            'User-Agent': Common.chromeUA,
          },
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = (await response.json()) as JisuApiResponse
        if (data.status !== 0) {
          throw new Error(`API ${data.status}: ${data.msg || 'unknown error'}`)
        }

        const list = data.result?.list ?? []
        const jokes = list.map((item) => ({
          id: this.extractIdFromUrl(item.url ?? ''),
          rawContent: item.content ?? '',
          pic: item.pic ?? '',
        }))

        console.log(`第 ${pageNum} 页获取成功，共 ${jokes.length} 条`)
        return {
          total: data.result?.total ?? 0,
          jokes,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`第 ${pageNum} 页请求失败（第 ${attempt} 次）: ${message}`)

        if (attempt < options.maxRetries) {
          await sleep(options.requestDelayMs)
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    return null
  }

  private normalizeOptions(options: FetchOptions = {}): Required<FetchOptions> {
    return {
      pageSize: options.pageSize ?? this.defaultPageSize,
      requestDelayMs: options.requestDelayMs ?? this.defaultRequestDelayMs,
      requestTimeoutMs: options.requestTimeoutMs ?? this.defaultRequestTimeoutMs,
      maxRetries: options.maxRetries ?? this.defaultMaxRetries,
      times: options.times ?? this.defaultTimes,
      outputPath: options.outputPath ?? this.outputPath,
      outputPicPath: options.outputPicPath ?? this.outputPicPath,
    }
  }

  private async tryReadJson<T>(filePath: URL, fallback: T): Promise<T> {
    try {
      const content = await readFile(filePath, 'utf8')
      return JSON.parse(content) as T
    } catch {
      return fallback
    }
  }

  private async readCheckpoint() {
    const state = await this.tryReadJson<UnifiedFetchCheckpoint>(this.checkpointPath, {})
    const checkpoint = state.duanzi
    if (!checkpoint || typeof checkpoint.lastFetchPage !== 'number' || checkpoint.lastFetchPage <= 0) {
      return null
    }
    return checkpoint
  }

  private async saveCheckpoint(lastFetchPage: number) {
    const state = await this.tryReadJson<UnifiedFetchCheckpoint>(this.checkpointPath, {})

    const checkpoint: FetchCheckpoint = {
      lastFetchPage,
      updatedAt: new Date().toISOString(),
    }

    state.duanzi = checkpoint

    await writeFile(this.checkpointPath, JSON.stringify(state), 'utf8')
  }

  async fetchAndSave(options: FetchOptions = {}) {
    const merged = this.normalizeOptions(options)

    const checkpoint = await this.readCheckpoint()
    const startPage = checkpoint ? checkpoint.lastFetchPage + 1 : this.defaultStartPage
    const effectiveStartPage = startPage

    const allJokes = await this.tryReadJson<string[]>(merged.outputPath, [])
    const jokesWithPic = await this.tryReadJson<JokeWithPic[]>(merged.outputPicPath, [])

    const seen = new Set<string>()
    const seenPic = new Set<string>()

    for (const joke of allJokes) {
      if (typeof joke === 'string' && joke) {
        seen.add(joke)
      }
    }

    for (const item of jokesWithPic) {
      if (!item?.content || !item?.pic) continue
      seenPic.add(`${item.content}|${item.pic}`)
    }

    const beforeTextCount = allJokes.length
    const beforePicCount = jokesWithPic.length

    const firstPage = await this.fetchPage(effectiveStartPage, merged)
    if (!firstPage) {
      throw new Error(`无法获取起始页（第 ${effectiveStartPage} 页）数据，任务终止`)
    }

    const total = firstPage.total
    const totalPages = Math.max(1, Math.ceil(total / merged.pageSize))
    if (effectiveStartPage > totalPages) {
      return {
        total,
        totalPages,
        startPage,
        effectiveStartPage,
        endPage: checkpoint?.lastFetchPage ?? 0,
        fetchedPages: 0,
        uniqueCount: allJokes.length,
        outputPath: merged.outputPath.pathname,
        withPicCount: jokesWithPic.length,
        outputPicPath: merged.outputPicPath.pathname,
        skippedByCheckpoint: true,
        checkpoint: checkpoint?.lastFetchPage ?? 0,
      }
    }

    const endPage = Math.min(totalPages, effectiveStartPage + merged.times - 1)

    console.log(`总笑话数: ${total}, 总页数: ${totalPages}`)
    console.log(`抓取范围: 第 ${effectiveStartPage} 页 - 第 ${endPage} 页`)

    const appendJokes = (items: JokeItem[]) => {
      for (const item of items) {
        const cleaned = this.cleanContent(item.rawContent)
        if (!cleaned || seen.has(cleaned)) continue

        seen.add(cleaned)
        allJokes.push(cleaned)

        if (item.pic) {
          const picKey = `${cleaned}|${item.pic}`
          if (!seenPic.has(picKey)) {
            seenPic.add(picKey)
            jokesWithPic.push({
              id: item.id,
              content: cleaned,
              pic: item.pic,
            })
          }
        }
      }
    }

    appendJokes(firstPage.jokes)

    for (let page = effectiveStartPage + 1; page <= endPage; page++) {
      await sleep(merged.requestDelayMs)
      const pageData = await this.fetchPage(page, merged)
      if (pageData) {
        appendJokes(pageData.jokes)
      }

      if (page % 10 === 0 || page === endPage) {
        console.log(`已处理第 ${page} 页 / 结束页 ${endPage}`)
      }
    }

    await writeFile(merged.outputPath, JSON.stringify(allJokes), 'utf8')
    await writeFile(merged.outputPicPath, JSON.stringify(jokesWithPic), 'utf8')
    await this.saveCheckpoint(endPage)

    return {
      total,
      totalPages,
      startPage,
      effectiveStartPage,
      endPage,
      fetchedPages: endPage - effectiveStartPage + 1,
      times: merged.times,
      addedCount: allJokes.length - beforeTextCount,
      uniqueCount: allJokes.length,
      outputPath: merged.outputPath.pathname,
      addedPicCount: jokesWithPic.length - beforePicCount,
      withPicCount: jokesWithPic.length,
      outputPicPath: merged.outputPicPath.pathname,
      checkpoint: endPage,
    }
  }

  private parsePositiveInt(value: string | null, fallback: number) {
    if (!value) return fallback
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  handle(): RouterMiddleware<'/duanzi/fetch'> {
    return async (ctx) => {
      try {
        const times = this.parsePositiveInt(
          ctx.request.url.searchParams.get('times') ?? ctx.request.url.searchParams.get('count'),
          this.defaultTimes,
        )

        const result = await this.fetchAndSave({
          times,
        })

        ctx.response.body = Common.buildJson({
          message: '抓取完成，已写入 duanzi.json，并记录抓取进度',
          ...result,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = Common.buildJson(null, 500, `抓取失败: ${message}`)
      }
    }
  }
}

export const serviceFetchJokes = new ServiceFetchJokes()

import { Common } from '../common.ts'

import type { RouterMiddleware } from '@oak/oak'

class ServiceExRate {
  #cache = new Map<string, SingleRateItem>()

  handle(): RouterMiddleware<'/exchange_rate'> {
    return async (ctx) => {
      const currencyParam = ctx.request.url.searchParams.get('currency') || 'USD'
      const currencies = this.#parseCurrencies(currencyParam)

      if (currencies.length === 0) {
        ctx.response.status = 400
        ctx.response.body = Common.buildJson(null, 400, '参数 currency 无效，请使用例如 USD,EUR,GBP,HKD')
        return
      }

      const data = await this.#fetch(currencies)

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = `${Common.localeDate()} 的多货币兑 CNY 汇率\n\n${data.rates
            .map((e) => `${e.currency} => ${e.rate}`)
            .join('\n')}`
          break

        case 'markdown':
          ctx.response.body = `# 多货币兑 CNY 汇率\n\n> 更新时间: ${data.updated}\n\n| 货币 | 汇率 |\n|------|------|\n${data.rates
            .map((e) => `| **${e.currency}** | ${e.rate.toFixed(4)} |`)
            .join('\n')}\n\n*下次更新: ${data.next_updated}*`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson(data)
          break
      }
    }
  }

  #parseCurrencies(input: string) {
    return Array.from(
      new Set(
        input
          .split(/[,，\s]+/)
          .map((item) => item.trim().toUpperCase())
          .filter((item) => /^[A-Z]{3}$/.test(item)),
      ),
    )
  }

  async #fetch(currencies: string[]) {
    const rates: RateLine[] = []
    let latestUpdatedAt = 0
    let latestNextUpdatedAt = 0

    for (const currency of currencies) {
      const single = await this.#fetchSingle(currency)
      rates.push({
        currency: single.currency,
        rate: single.rate,
      })

      if (single.updated_at > latestUpdatedAt) {
        latestUpdatedAt = single.updated_at
      }

      if (single.next_updated_at > latestNextUpdatedAt) {
        latestNextUpdatedAt = single.next_updated_at
      }
    }

    return {
      base_code: 'CNY',
      updated: Common.localeTime(latestUpdatedAt || Date.now()),
      updated_at: latestUpdatedAt || Date.now(),
      next_updated: Common.localeTime(latestNextUpdatedAt || Date.now()),
      next_updated_at: latestNextUpdatedAt || Date.now(),
      rates,
    }
  }

  async #fetchSingle(currency: string) {
    const dayKey = `${Common.localeDate()}-${currency}`
    const cache = this.#cache.get(dayKey)

    if (cache) {
      return cache
    }

    const api = 'https://open.er-api.com/v6/latest'
    const data = (await (await fetch(`${api}/${currency}`)).json()) as RateResponse
    const { time_last_update_unix, time_next_update_unix, base_code, rates } = data

    const cnyRate = rates?.CNY

    if (typeof cnyRate !== 'number') {
      throw new Error(`未找到 ${currency} 对 CNY 的汇率`)
    }

    const rateItem: SingleRateItem = {
      currency: base_code,
      rate: cnyRate,
      base_code,
      updated: Common.localeTime(time_last_update_unix * 1000),
      updated_at: time_last_update_unix * 1000,
      next_updated: Common.localeTime(time_next_update_unix * 1000),
      next_updated_at: time_next_update_unix * 1000,
    }

    this.#cache.set(dayKey, rateItem)

    return rateItem
  }
}

export const serviceExRate = new ServiceExRate()

interface RateItem {
  base_code: string
  updated: string
  updated_at: number
  next_updated: string
  next_updated_at: number
  rates: {
    currency: string
    rate: number
  }[]
}

interface RateLine {
  currency: string
  rate: number
}

interface SingleRateItem {
  currency: string
  rate: number
  base_code: string
  updated: string
  updated_at: number
  next_updated: string
  next_updated_at: number
}

interface RateResponse {
  result: string
  provider: string
  documentation: string
  terms_of_use: string
  time_last_update_unix: number
  time_last_update_utc: string
  time_next_update_unix: number
  time_next_update_utc: string
  time_eol_unix: number
  base_code: string
  rates: {
    [key: string]: number
  }
}

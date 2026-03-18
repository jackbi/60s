/*
 * @Description:
 * @Version: 1.0
 * @Author: wenbin
 * @Date: 2026-03-18 14:46:15
 * @LastEditors: wenbin
 * @LastEditTime: 2026-03-18 15:38:03
 * @FilePath: /hengran-global-api/src/modules/riddle/riddle.module.ts
 * Copyright (C) 2026 wenbin. All rights reserved.
 */
import { Common } from '../../common.ts'
import riddleData from './riddle.json' with { type: 'json' }

import type { RouterMiddleware } from '@oak/oak'

interface RiddleItem {
  content: string
  answer: string
}

class ServiceRiddle {
  handle(): RouterMiddleware<'/riddle'> {
    return async (ctx) => {
      const indexParam = await Common.getParam('index', ctx.request)

      let result: RiddleItem
      let resultIndex: number

      if (indexParam) {
        const index = Number.parseInt(indexParam, 10)
        if (Number.isNaN(index) || index < 0 || index >= riddleData.length) {
          ctx.response.status = 404
          ctx.response.body = Common.buildJson(null, 404, `未找到 index 为 ${indexParam} 的谜语`)
          return
        }

        result = riddleData[index]
        resultIndex = index
      } else {
        result = Common.randomItem(riddleData)
        resultIndex = riddleData.findIndex((item) => item.content === result.content && item.answer === result.answer)
      }

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = `${result.content}\n答案：${result.answer}`
          break

        case 'markdown':
          ctx.response.body = `# 🧩 谜语\n\n${result.content}\n\n**答案：** ${result.answer}\n\n---\n\n*第 ${resultIndex + 1} 条，共 ${riddleData.length} 条*`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson({
            index: resultIndex,
            total: riddleData.length,
            ...result,
          })
          break
      }
    }
  }
}

export const serviceRiddle = new ServiceRiddle()

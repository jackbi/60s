/*
 * @Description:
 * @Version: 1.0
 * @Author: wenbin
 * @Date: 2026-03-18 09:07:56
 * @LastEditors: wenbin
 * @LastEditTime: 2026-03-18 11:31:47
 * @FilePath: /hengran-global-api/src/config.ts
 * Copyright (C) 2026 wenbin. All rights reserved.
 */
export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: process.env.PORT ? +process.env.PORT : 4399,
  group: '',
  author: 'jackbi',
  github: 'https://github.com/jackbi/60s',
  debug: !!process.env.DEBUG,
  overseas_first: !!process.env.OVERSEAS_FIRST,
  encodingParamName: process.env.ENCODING_PARAM_NAME || 'encoding',
  jisuApiKey: process.env.JISU_API_KEY || '',
}

export const COMMON_MSG = `获取成功`

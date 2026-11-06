# 模拟交易运行日志

> 由 `contracts/scripts/simulate.ts` 自动生成，随机种子 20261030，可直接复现。

## 运行参数

- 模拟用户：**20** 个（使用本地节点预置的解锁账户）
- 随机轮次：**100** 轮
- 交易所：**MiniDEX-A / MiniDEX-B**（同一交易对 TKA/TKB、TKA/WETH）
- 套利触发阈值：价差 > **150 bps**

## 操作统计

| 指标 | 数量 |
| --- | --- |
| 交易（swap） | 71 |
| 添加流动性 | 19 |
| 撤销流动性（销毁 NFT） | 6 |
| 余额不足等原因跳过 | 4 |
| 原子套利次数 | 1 |
| 套利总利润 | 1.07 TKB |

## 最终池子状态

| 交易所 | 交易对 | reserve0 | reserve1 | 总份额 | 交易次数 | 价格 |
| --- | --- | --- | --- | --- | --- | --- |
| DEX-A | TKA/TKB | 108259.69 | 97420.5716 | 102686.88 | 26 | 0.8999 |
| DEX-A | TKA/WETH | 52338.85 | 51.6618 | 1644.29 | 14 | 0.0010 |
| DEX-B | TKA/TKB | 96664.08 | 87173.7381 | 91785.46 | 36 | 0.9018 |
| DEX-B | TKA/WETH | 50051.88 | 49.9528 | 1581.14 | 10 | 0.0010 |

最终 TKA/TKB 价格：DEX-A **0.8999** TKB / DEX-B **0.9018** TKB，价差 **22 bps**

## 套利明细

| 轮次 | 套利者 | 路径 | 投入 (TKB) | 利润 (TKB) | 收益率 | 套利前价格 (A / B) | 套利后价格 (A / B) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 0x9965…A4dc | DEX-B 买入 TKA → DEX-A 卖出 TKA | 214.44 | 1.07 | 50 bps | 0.9029 / 0.8888 | 0.8989 / 0.8932 |

## 随机操作流水（节选）

| 轮次 | 用户 | 操作 | 详情 | 价差 (bps) |
| --- | --- | --- | --- | --- |
| 1 | 0xbDA5…197E | addLiquidity | DEX-A 添加 127.00 TKA + 114.42 TKB | 128 |
| 2 | 0x2361…1E8f | swap | DEX-B TKA/TKB 用 40.00 TKA 换出 35.46 | 137 |
| 3 | 0xf39F…2266 | swap | DEX-A TKA/TKB 用 104.00 TKB 换出 114.97 | 158 |
| 4 | 0x90F7…b906 | swap | DEX-A TKA/TKB 用 113.00 TKA 换出 101.16 | 42 |
| 5 | 0xcd3B…ce71 | swap | DEX-B TKA/TKB 用 32.00 TKA 换出 28.49 | 48 |
| 6 | 0xcd3B…ce71 | swap | DEX-B TKA/WETH 用 121.00 TKA 换出 0.12 | 48 |
| 7 | 0x7099…79C8 | swap | DEX-A TKA/WETH 用 0.08 WETH 换出 79.41 | 48 |
| 8 | 0x71bE…5788 | swap | DEX-B TKA/TKB 用 48.00 TKB 换出 53.58 | 37 |
| 9 | 0x15d3…6A65 | swap | DEX-A TKA/TKB 用 62.00 TKA 换出 55.41 | 26 |
| 10 | 0x1CBd…C9Ec | swap | DEX-B TKA/TKB 用 23.00 TKA 换出 20.49 | 31 |
| 11 | 0x2361…1E8f | swap | DEX-B TKA/TKB 用 26.00 TKA 换出 23.15 | 36 |
| 12 | 0xbDA5…197E | addLiquidity | DEX-A 添加 134.00 TKA + 120.06 TKB | 36 |
| 13 | 0xFABB…694a | swap | DEX-A TKA/TKB 用 48.00 TKA 换出 42.86 | 27 |
| 14 | 0x3C44…93BC | swap | DEX-A TKA/TKB 用 84.00 TKB 换出 93.48 | 44 |
| 15 | 0x14dC…9955 | swap | DEX-A TKA/TKB 用 65.00 TKA 换出 58.08 | 32 |
| 16 | 0x2361…1E8f | addLiquidity | DEX-A 添加 175.00 TKA + 156.73 TKB | 32 |
| 17 | 0xFABB…694a | swap | DEX-B TKA/TKB 用 115.00 TKB 换出 128.26 | 6 |
| 18 | 0x976E…0aa9 | swap | DEX-B TKA/TKB 用 76.00 TKB 换出 84.58 | 12 |
| 19 | 0x976E…0aa9 | removeLiquidity | DEX-B 销毁 NFT #9 撤出流动性 | 12 |
| 20 | 0x976E…0aa9 | swap | DEX-A TKA/WETH 用 193.00 TKA 换出 0.19 | 12 |
| 86 | 0x8626…1199 | swap | DEX-B TKA/TKB 用 103.00 TKA 换出 93.05 | 69 |
| 87 | 0xFABB…694a | removeLiquidity | DEX-A 销毁 NFT #29 撤出流动性 | 69 |
| 88 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 48.00 TKA 换出 43.30 | 59 |
| 89 | 0x3C44…93BC | addLiquidity | DEX-B 添加 139.00 TKA + 125.69 TKB | 59 |
| 90 | 0x2361…1E8f | swap | DEX-A TKA/TKB 用 29.00 TKB 换出 32.15 | 53 |
| 91 | 0xBcd4…4096 | swap | DEX-B TKA/TKB 用 46.00 TKA 换出 41.45 | 44 |
| 92 | 0xBcd4…4096 | swap | DEX-A TKA/TKB 用 6.00 TKB 换出 6.65 | 43 |
| 93 | 0xBcd4…4096 | swap | DEX-A TKA/TKB 用 30.00 TKB 换出 33.24 | 36 |
| 94 | 0x7099…79C8 | swap | DEX-B TKA/TKB 用 15.00 TKB 换出 16.55 | 40 |
| 95 | 0xdF3e…7097 | addLiquidity | DEX-A 添加 164.00 TKA + 147.62 TKB | 40 |
| 96 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 13.00 TKA 换出 11.71 | 37 |
| 97 | 0xa0Ee…9720 | swap | DEX-A TKA/WETH 用 0.17 WETH 换出 171.64 | 37 |
| 98 | 0x3C44…93BC | swap | DEX-A TKA/TKB 用 14.00 TKA 换出 12.56 | 40 |
| 99 | 0xf39F…2266 | swap | DEX-A TKA/WETH 用 97.00 TKA 换出 0.10 | 40 |
| 100 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 88.00 TKA 换出 79.19 | 22 |

完整流水共 100 条，可在运行时通过控制台查看。
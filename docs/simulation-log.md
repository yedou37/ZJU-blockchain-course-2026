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
| 交易（swap） | 69 |
| 添加流动性 | 20 |
| 撤销流动性（销毁 NFT） | 7 |
| 余额不足等原因跳过 | 4 |
| 原子套利次数 | 5 |
| 套利总利润 | 535.37 TKB |

## 最终池子状态

| 交易所 | 交易对 | reserve0 | reserve1 | 总份额 | 交易次数 | 价格 |
| --- | --- | --- | --- | --- | --- | --- |
| DEX-A | TKA/TKB | 108248.49 | 97784.2981 | 102873.49 | 27 | 0.9033 |
| DEX-A | TKA/WETH | 2015.97 | 1.9843 | 63.25 | 11 | 0.0010 |
| DEX-B | TKA/TKB | 96625.24 | 87350.8805 | 91860.72 | 33 | 0.9040 |
| DEX-B | TKA/WETH | 49982.01 | 50.0221 | 1581.14 | 8 | 0.0010 |

最终 TKA/TKB 价格：DEX-A **0.9033** TKB / DEX-B **0.9040** TKB，价差 **8 bps**

## 套利明细

| 轮次 | 套利者 | 路径 | 投入 (TKB) | 利润 (TKB) | 收益率 | 套利前价格 (A / B) | 套利后价格 (A / B) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0xBcd4…4096 | DEX-B 买入 TKA → DEX-A 卖出 TKA | 1000.00 | 212.93 | 2129 bps | 1.0000 / 0.8000 | 0.9764 / 0.8197 |
| 2 | 0x1CBd…C9Ec | DEX-B 买入 TKA → DEX-A 卖出 TKA | 1000.00 | 154.94 | 1549 bps | 0.9751 / 0.8197 | 0.9528 / 0.8396 |
| 3 | 0xFABB…694a | DEX-B 买入 TKA → DEX-A 卖出 TKA | 1000.00 | 102.41 | 1024 bps | 0.9528 / 0.8396 | 0.9319 / 0.8598 |
| 4 | 0xdF3e…7097 | DEX-B 买入 TKA → DEX-A 卖出 TKA | 1066.15 | 56.74 | 532 bps | 0.9331 / 0.8598 | 0.9120 / 0.8816 |
| 5 | 0x14dC…9955 | DEX-B 买入 TKA → DEX-A 卖出 TKA | 608.00 | 8.35 | 137 bps | 0.9120 / 0.8823 | 0.9005 / 0.8949 |

## 随机操作流水（节选）

| 轮次 | 用户 | 操作 | 详情 | 价差 (bps) |
| --- | --- | --- | --- | --- |
| 1 | 0xbDA5…197E | addLiquidity | DEX-A 添加 127.00 TKA + 127.00 TKB | 2500 |
| 2 | 0xdF3e…7097 | swap | DEX-A TKA/TKB 用 68.00 TKA 换出 66.15 | 1895 |
| 3 | 0xbDA5…197E | addLiquidity | DEX-A 添加 89.00 TKA + 84.80 TKB | 1348 |
| 4 | 0xa0Ee…9720 | swap | DEX-A TKA/TKB 用 65.00 TKB 换出 69.50 | 852 |
| 5 | 0x976E…0aa9 | swap | DEX-B TKA/TKB 用 36.00 TKB 换出 40.70 | 336 |
| 6 | 0x7099…79C8 | swap | DEX-A TKA/WETH 用 0.08 WETH 换出 79.64 | 62 |
| 7 | 0x71bE…5788 | swap | DEX-B TKA/TKB 用 48.00 TKB 换出 53.45 | 51 |
| 8 | 0x15d3…6A65 | swap | DEX-A TKA/TKB 用 62.00 TKA 换出 55.63 | 40 |
| 9 | 0x1CBd…C9Ec | swap | DEX-B TKA/TKB 用 23.00 TKA 换出 20.54 | 45 |
| 10 | 0x2361…1E8f | swap | DEX-B TKA/TKB 用 26.00 TKA 换出 23.21 | 50 |
| 11 | 0xbDA5…197E | addLiquidity | DEX-A 添加 134.00 TKA + 120.52 TKB | 50 |
| 12 | 0xFABB…694a | swap | DEX-A TKA/TKB 用 48.00 TKA 换出 43.02 | 41 |
| 13 | 0x3C44…93BC | swap | DEX-A TKA/TKB 用 84.00 TKB 换出 93.12 | 58 |
| 14 | 0x14dC…9955 | swap | DEX-A TKA/TKB 用 65.00 TKA 换出 58.30 | 46 |
| 15 | 0x2361…1E8f | addLiquidity | DEX-A 添加 175.00 TKA + 157.34 TKB | 46 |
| 16 | 0xFABB…694a | swap | DEX-B TKA/TKB 用 115.00 TKB 换出 127.94 | 20 |
| 17 | 0x976E…0aa9 | swap | DEX-B TKA/TKB 用 76.00 TKB 换出 84.37 | 2 |
| 18 | 0x976E…0aa9 | removeLiquidity | DEX-B 销毁 NFT #9 撤出流动性 | 2 |
| 19 | 0x976E…0aa9 | swap | DEX-A TKA/WETH 用 193.00 TKA 换出 0.19 | 2 |
| 20 | 0x8626…1199 | swap | DEX-B TKA/TKB 用 113.00 TKB 换出 125.17 | 24 |
| 86 | 0xFABB…694a | removeLiquidity | DEX-A 销毁 NFT #29 撤出流动性 | 55 |
| 87 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 48.00 TKA 换出 43.40 | 45 |
| 88 | 0x3C44…93BC | addLiquidity | DEX-B 添加 139.00 TKA + 126.00 TKB | 45 |
| 89 | 0x2361…1E8f | swap | DEX-A TKA/TKB 用 29.00 TKB 换出 32.03 | 39 |
| 90 | 0xBcd4…4096 | swap | DEX-B TKA/TKB 用 46.00 TKA 换出 41.55 | 30 |
| 91 | 0xBcd4…4096 | swap | DEX-A TKA/TKB 用 6.00 TKB 换出 6.62 | 29 |
| 92 | 0xBcd4…4096 | swap | DEX-A TKA/TKB 用 30.00 TKB 换出 33.11 | 22 |
| 93 | 0x7099…79C8 | swap | DEX-B TKA/TKB 用 15.00 TKB 换出 16.51 | 26 |
| 94 | 0xdF3e…7097 | addLiquidity | DEX-A 添加 164.00 TKA + 148.18 TKB | 26 |
| 95 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 13.00 TKA 换出 11.74 | 23 |
| 96 | 0xa0Ee…9720 | swap | DEX-A TKA/WETH 用 0.17 WETH 换出 172.13 | 23 |
| 97 | 0x3C44…93BC | swap | DEX-A TKA/TKB 用 14.00 TKA 换出 12.61 | 26 |
| 98 | 0xf39F…2266 | swap | DEX-A TKA/WETH 用 97.00 TKA 换出 0.10 | 26 |
| 99 | 0xdF3e…7097 | swap | DEX-B TKA/TKB 用 88.00 TKA 换出 79.39 | 8 |
| 100 | 0xf39F…2266 | removeLiquidity | DEX-A 销毁 NFT #2 撤出流动性 | 8 |

完整流水共 100 条，可在运行时通过控制台查看。
# MiniDEX：基于 AMM 的去中心化交易所与原子套利

> 浙江大学区块链课程 第二次作业
>
> 一个 Uniswap V2 风格的 AMM 去中心化交易所 DApp：支持 ERC20 代币水龙头、恒定乘积做市、ERC721 流动性凭证、20 个模拟用户随机交易，并额外实现了**双交易所价差 + 一笔交易内完成的原子套利**（Bonus）。

## 功能一览

| 作业要求 | 实现情况 | 对应文件 |
| --- | --- | --- |
| 至少两个 ERC20，多用户可领取测试币，也可领取测试 ETH | 3 个测试代币 TKA/TKB/TKC（`claim()` 水龙头，1 小时冷却）+ `Faucet` 发放 1 ETH/次 | `MockERC20.sol`、`Faucet.sol` |
| 前端创建 AMM 交易池，恒定乘积定价（含手续费），可交易 / 添加 / 撤销流动性 | `createPool` / `addLiquidity` / `removeLiquidity` / `swapExactIn`，手续费 0.3% | `MiniDEX.sol` |
| 流动性凭证是 ERC721 NFT（含池信息、份额、时间），可查看流动性来源与自己的 NFT，销毁 NFT 取回代币与手续费分红 | `MiniDEX` 继承 `ERC721`，每次加流动性 mint 一枚 Position NFT；`tokenURI` 返回链上元数据；手续费累积在储备中，按份额分红 | `MiniDEX.sol` |
| ≥20 个模拟用户随机交易 / 加撤流动性，稳定运行一段时间 | 20 个账户、100 轮随机操作（命令行脚本）+ 页面内「快速模拟」 | `scripts/simulate.ts`、`pages/Simulation.tsx` |
| **Bonus ①（2 分）** 部署多个交易所，同一代币对形成价差 | 部署 `MiniDEX-A` / `MiniDEX-B`，同一 TKA/TKB 池初始价格 1.0 vs 0.8 | `scripts/deploy.ts` |
| **Bonus ②（3 分）** 原子套利：一笔交易内低买高卖，失败 revert，展示前后价格 / 数量 / 盈利 | `Arbitrage.execute()`：拉币 → 低价池买入 → 高价池卖出 → 校验利润，不足则整笔 revert | `Arbitrage.sol`、`pages/Arbitrage.tsx` |

运行 `npm run verify` 可以在链上逐条自检这些要求，当前结果：**15/15 项通过**。

## 技术栈

- 合约：Solidity 0.8.20 + Hardhat 3 + ethers v6 + TypeScript，OpenZeppelin 5.4（ERC20 / ERC721 / ReentrancyGuard / SafeERC20）
- 前端：React 19 + Vite + TypeScript + ethers v6（直连本地节点，无需安装 MetaMask）
- 图表：手写 SVG 组件（折线图 / 前后对比柱状图 / 价差刻度条），不引入图表库
- 测试：Mocha + Chai（合约 14 个用例）、Vitest（前端）
- 演示：Playwright 自动截图 + 录屏，ffmpeg 转 mp4

## 目录结构

```
contracts/
├── contracts/
│   ├── MockERC20.sol      # 测试代币 + claim() 水龙头
│   ├── MockWETH.sol       # ETH 包装成 ERC20，用于 TKA/WETH 交易对
│   ├── Faucet.sol         # 测试 ETH 水龙头
│   ├── MiniDEX.sol        # AMM 核心：建池 / 流动性 / swap / ERC721 凭证
│   └── Arbitrage.sol      # 跨交易所原子套利
├── scripts/
│   ├── deploy.ts          # 一键部署（2 个交易所 + 套利合约 + 初始流动性）
│   ├── prepare-users.ts   # 给 19 个测试账户领币并授权（供页面模拟使用）
│   ├── simulate.ts        # 20 用户 × 100 轮随机模拟 + 套利，输出报告
│   └── verify.ts          # 按作业要求逐条自检链上状态
└── test/                  # MiniDEX / Arbitrage / MockERC20 单元测试
frontend/
└── src/
    ├── lib/chain.ts       # provider、合约实例、格式化工具
    ├── lib/deployments.json  # 部署脚本自动生成（地址 + ABI）
    ├── components/UI.tsx  # 卡片 / 按钮 / 指标 / 徽标
    ├── components/Charts.tsx  # 折线图 / 柱状对比 / 价差刻度
    └── pages/             # 总览 / 水龙头 / 交易池 / 兑换 / 流动性 / 模拟 / 套利
docs/
├── screenshots/           # 运行截图（README 引用）
├── video/demo.mp4         # 自动录制的演示视频
├── video/narration.md     # 视频口播稿
└── simulation-log.md      # 100 轮模拟运行日志
tools/                     # Playwright 截图与录屏脚本
```

## 如何运行

环境要求：Node.js ≥ 22（推荐 22.x 或 24.x）、npm。

### 1. 启动本地链并部署合约

```bash
cd contracts
npm ci
npm run node          # 终端 A：启动本地 Hardhat 节点（20 个账户，各 10000 ETH）
```

另开一个终端：

```bash
cd contracts
npm run deploy        # 部署代币 / WETH / Faucet / 两个 MiniDEX / Arbitrage，并建池注资
```

部署完成后会打印所有合约地址，并自动写入 `frontend/src/lib/deployments.json`，前端**不需要手动填地址**。

可选（推荐，页面里的「快速模拟」需要）：

```bash
npm run prepare:users # 让 19 个测试账户领币、包装 WETH 并授权
npm run simulate      # 20 用户 × 100 轮随机交易 + 套利，生成 docs/simulation-log.md
npm run verify        # 按作业要求逐条自检，输出 15 项检查清单
```

### 2. 启动前端

```bash
cd frontend
npm ci
npm start             # 打开 http://localhost:3000
```

页面右上角的下拉框可以直接切换 20 个测试账户（相当于 20 个用户），无需安装 MetaMask。

### 3. 跑测试

```bash
cd contracts && npm test     # 合约：14 个用例
cd frontend && npm test      # 前端：格式化工具与组件
```

### 4. 重新生成截图与演示视频（可选）

```bash
cd tools
npm install
npx playwright install chromium
npm run record        # 输出 docs/screenshots/*.png 与 docs/video/demo.mp4
```

> 提示：`npm run record` 需要本地链**刚部署且还没被模拟脚本改过**（水龙头有冷却、初始价差要保留），并保持 `npm start` 正在运行。

## 功能实现分析

### 1. ERC20 测试代币与多用户水龙头

- `MockERC20` 在构造时给部署者预铸 1,000,000 枚，用于初始化流动性；任何地址都可以调用 `claim()` 领取 1000 枚，同一地址 1 小时内只能领一次（`lastClaimAt` + `faucetCooldownLeft` 给前端做倒计时）。
- `Faucet` 部署时注入 100 ETH，`claimETH()` 每次发 1 ETH，同样带冷却，满足「用户也可以领取测试所需的以太币」。
- ETH 交易对通过 `MockWETH`（`deposit` / `withdraw`）实现：AMM 内部只处理 ERC20，前端提供「1 ETH → WETH」按钮，避免在合约里写两套 native/ERC20 分支。

### 2. AMM 交易池与恒定乘积定价

- `createPool(tokenA, tokenB)` 会把地址排序成 `token0 < token1`，用 `keccak256(token0, token1)` 做唯一键，保证同一交易对只有一个池子。
- 兑换遵循 Uniswap V2 公式，手续费 0.3%（`FEE_BPS = 30`）：

  ```
  amountInWithFee = amountIn × (10000 − 30)
  amountOut = reserveOut × amountInWithFee / (reserveIn × 10000 + amountInWithFee)
  ```

  手续费留在储备里，因此 `k = x·y` 只会单调增大，这部分增量就是 LP 的收益。
- 首次添加流动性 `shares = sqrt(amount0 × amount1)`；之后按现有储备比例配比，`shares = min(amount0 × T / reserve0, amount1 × T / reserve1)`，避免稀释已有 LP。
- 兑换、加撤流动性都带 `minAmountOut` / `amountMin` 滑点保护，并有 `nonReentrant` 防重入。

### 3. ERC721 流动性凭证与手续费分红

- `MiniDEX` 自身继承 `ERC721`（`MiniDEX-LP`）。每添加一次流动性就 `_mint` 一枚 NFT，`positions[tokenId]` 记录 `poolId`、`shares`、建仓时的两种代币数量与 `createdAt`。
- 前端「我的流动性凭证」展示每枚 NFT 的池子、份额、创建时间、**当前可赎回数量**（`getPositionValue` = `shares × reserve / totalShares`），以及**手续费收益**（当前可赎回 − 建仓数量）。
- 撤销流动性时先校验调用者是 NFT 持有者（或获批者），再按份额比例把两种代币转回，然后 `_burn` 销毁 NFT。由于手续费一直累积在 `reserve` 中，赎回数量天然大于建仓数量，这就是「手续费分红」。
- `tokenURI` 直接返回 `data:application/json` 的链上元数据（池子编号、份额、代币符号、创建时间），所以在区块浏览器/钱包里也能看到这枚 NFT 的信息。
- 「流动性来源」表格通过 `getAllPositions()` 一次性读取所有未销毁的凭证，可以看到每个池子的流动性分别由哪些地址提供。

### 4. 20 个模拟用户随机交易

`scripts/simulate.ts`：

1. 使用本地节点预置的 20 个解锁账户（各 10000 ETH），逐个领取 TKA/TKB/TKC 与 1 ETH，并授权两个交易所与套利合约；
2. 其中 10 个账户作为流动性提供者，向 TKA/TKB、TKA/WETH 池注入流动性（各自铸造 ERC721）；
3. 之后进行 100 轮随机操作：70% 兑换（随机交易所 / 随机池子 / 随机方向 / 随机数量）、18% 添加流动性、12% 撤销流动性；
4. 每轮结束检查两个交易所 TKA/TKB 的价差，超过 150 bps 就用采样搜索出的最优金额触发套利；
5. 输出 `docs/simulation-log.md`（操作统计、最终池子状态、套利明细、操作流水）。

一次运行的实测结果：**69 次兑换、20 次添加流动性、7 次销毁 NFT 撤池、5 次套利，套利总利润 535.37 TKB**，价差从 2500 bps 收敛到 8 bps。完整数据见 [docs/simulation-log.md](docs/simulation-log.md)。

页面的「模拟交易」标签页还提供了浏览器内的快速模拟（随机选账户、随机池子下单），并实时绘制两个交易所的价格曲线与操作日志。

### 5. Bonus ①：两个交易所与价差

部署脚本部署了 `MiniDEX-A` 与 `MiniDEX-B` 两个独立实例，都创建了 `TKA/TKB` 与 `TKA/WETH` 池，但初始比例不同：

- `MiniDEX-A`：100,000 TKA / 100,000 TKB → 1 TKA = 1.0 TKB
- `MiniDEX-B`：100,000 TKA / 80,000 TKB → 1 TKA = 0.8 TKB

两个池子因此长期存在约 25% 的价差，前端「套利」页会实时显示两个池子的储备、价格、价差（bps）以及一条带「手续费成本线」的价差刻度条。

### 6. Bonus ②：原子套利合约

`Arbitrage.execute(buyDEX, buyPoolId, sellDEX, sellPoolId, tokenIn, amountIn, minProfit)`：

1. `preview()` 先模拟整条路径（低价池买入 → 高价池卖出），若预估无利可图直接 revert，省 gas；
2. `transferFrom` 从调用者拉入 `tokenIn`；
3. 在低价池 `swapExactIn` 买入 `tokenOut`，再在高价池 `swapExactIn` 卖回 `tokenIn`；
4. 校验 `amountOut >= amountIn + minProfit`，否则整笔交易 revert —— 两笔 swap 一起回滚，不会出现「买到了但卖不掉」的中间状态；
5. 成功后把本息转回调用者，并 emit `ArbitrageExecuted`（投入、回款、利润）与 4 条 `PriceSnapshot`（两个池子套利前后的价格）。

前端「套利」页会：

- 对比两个交易所的价格并给出套利方向；
- 「搜索最优投入」在链上采样 40 个金额，取利润最大的一个；
- 「一键套利」执行后展示**套利前后的价格柱状对比、投入数量、回款数量、净利润与交易哈希**；
- 价差不足时按钮禁用并提示「套利会 revert」。

### 7. 前端交互

- 顶部可以切换 20 个测试账户，并显示本地链区块高度、ETH 余额，数据每 4 秒自动刷新。
- 七个标签页：总览（行情 / 资产 / 链上动态）、水龙头、交易池、兑换、流动性、模拟交易、套利。
- 所有图表都是手写 SVG：折线图带面积渐变、网格与坐标轴；套利结果用前后对比柱状图；价差用带阈值的刻度条。
- 每个操作都会回显状态（成功 / 失败原因），失败时直接展示合约 revert 原因。

## 项目运行截图

**1. 总览：行情、我的资产、链上活动与池子概览**

![总览](docs/screenshots/01-overview.png)

**2. 水龙头：一键领取测试代币与测试 ETH**

![水龙头](docs/screenshots/02-faucet.png)

**3. 领取成功，余额与冷却时间实时刷新**

![领取成功](docs/screenshots/03-faucet-claimed.png)

**4. 交易池：两个交易所、多个交易对的储备与价格**

![交易池](docs/screenshots/04-pools.png)

**5. 前端创建新的交易池（TKB/TKC）**

![创建交易池](docs/screenshots/05-pools-created.png)

**6. 添加流动性：按池子比例自动配比**

![添加流动性](docs/screenshots/06-liquidity-form.png)

**7. 铸造 ERC721 流动性凭证，展示份额、时间与手续费收益**

![流动性凭证](docs/screenshots/07-liquidity-nft.png)

**8. 兑换：报价、价格冲击与滑点保护**

![兑换报价](docs/screenshots/08-trade-quote.png)

**9. 兑换完成：储备与价格随之变化**

![兑换完成](docs/screenshots/09-trade-done.png)

**10. 模拟交易：20 用户随机下单，价格曲线与操作日志**

![模拟交易](docs/screenshots/10-simulation.png)

**11. 套利：两个交易所的价差监控**

![价差监控](docs/screenshots/11-arbitrage-gap.png)

**12. 采样搜索最优投入金额**

![最优投入](docs/screenshots/12-arbitrage-optimal.png)

**13. 原子套利完成：前后价格对比与净利润**

![套利结果](docs/screenshots/13-arbitrage-result.png)

**14. 销毁 NFT 赎回本金与手续费分红**

![赎回流动性](docs/screenshots/14-liquidity-redeem.png)

## 演示视频

- 视频文件：[docs/video/demo.mp4](docs/video/demo.mp4)（约 55 秒，自动录制）
- 口播稿：[docs/video/narration.md](docs/video/narration.md)

视频流程：领取测试币 → 创建交易池 → 添加流动性并拿到 NFT → 兑换 → 20 用户模拟 → 价差监控 → 一键套利 → 销毁 NFT 赎回 → 回到总览。

## 自检结果（`npm run verify`）

```
✅ 至少两个 ERC20 代币              TKA / TKB / TKC（共 3 个）
✅ 代币可领取（水龙头）             每个代币都有 claim() 与冷却查询
✅ 可以领取测试 ETH                Faucet 余额 80.0 ETH
✅ 前端可创建 / 查看 AMM 交易池      2 个交易所，共 4 个池子
✅ 恒定乘积 + 手续费               手续费 30 bps
✅ swap 报价可用                  100 token0 ≈ 89.98 token1
✅ 流动性凭证是 ERC721 NFT         DEX-A 当前有 29 枚未销毁的 LP NFT
✅ NFT 元数据包含池子信息           data:application/json;utf8,...
✅ NFT 可销毁赎回                 #1 可赎回 105224.86 / 95052.96
✅ 模拟用户随机交易                共 79 笔 swap，涉及 20 个交易地址
✅ 模拟用户添加 / 撤销流动性         17 个地址提供过流动性
✅ 至少 20 个模拟用户参与           交易地址 20 个 + 流动性地址 17 个
✅ 部署了多个交易所                MiniDEX-A / MiniDEX-B
✅ 套利合约存在并可调用             已执行 5 次套利，累计利润 535.37 TKB
✅ 两个交易所价格差可量化           DEX-A 0.9033 / DEX-B 0.9040，价差 8 bps
```

## 本地合约地址（`npm run deploy` 后）

| 合约 | 地址 |
| --- | --- |
| TKA | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| TKB | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| TKC | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| WETH | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| Faucet | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| MiniDEX-A | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| MiniDEX-B | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| Arbitrage | `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` |

> 地址由部署顺序决定，重新部署会得到同一组地址；实际地址以部署脚本输出与 `frontend/src/lib/deployments.json` 为准。

## 测试

```
contracts: 14 passing
  MockERC20 水龙头（领取 / 冷却）
  MiniDEX 建池、首次与后续加流动性、swap 手续费与 k 值、滑点 revert、
          销毁 NFT 赎回并获得分红、非持有者不能撤池、tokenURI 元数据
  Arbitrage 有利可图时盈利且价差收敛、利润要求过高 revert 且储备不变、
            反向套利 revert、同池套利 revert
```

## 说明与取舍

- ETH 交易对使用 `MockWETH` 包装实现，而不是在 AMM 里同时支持 native ETH，这样定价、流动性、套利逻辑只需要维护一套 ERC20 分支，代码更短也更好验证。
- 手续费固定 0.3%（Uniswap V2 的默认值），协议不抽成，全部留给 LP；分红通过储备增长体现，没有额外的「分红提取」函数。
- 所有交易都直接由本地节点代签（`accounts: "remote"`），因此演示时不需要安装 MetaMask；如果要接入真实钱包，只需把 `provider` 换成 `BrowserProvider`。

## 参考内容

- 课程参考 Demo：[LBruyne/blockchain-course-demos](https://github.com/LBruyne/blockchain-course-demos)
- Uniswap V2 白皮书与源码：<https://uniswap.org/whitepaper.pdf>
- 恒定乘积与 ETH/ERC20 兑换讲解：[WTF Academy · DEX](https://www.wtf.academy/en/docs/solidity-103/DEX/)
- ERC20 / ERC721 模板：[OpenZeppelin Wizard](https://wizard.openzeppelin.com/)
- Hardhat 3 文档：<https://hardhat.org/docs>
- ethers v6 文档：<https://docs.ethers.org/v6/>

# MiniDEX 前端

使用 React 19、TypeScript 和 Vite 实现 MiniDEX 的全部页面：总览看板、水龙头、交易池、兑换、流动性凭证（NFT）、模拟交易与套利（Bonus）。页面通过 ethers v6 直连本地 Hardhat 节点，无需钱包插件。

## 安装与运行

建议使用 Node.js 24。使用 nvm 时，在 `frontend/` 目录执行：

```bash
nvm install
nvm use
```

也可以自行安装满足 `package.json` 中 `engines` 要求的 Node.js 版本。

首次安装依赖并启动：

```bash
npm ci
npm start
```

访问终端显示的地址（默认 [http://localhost:3000](http://localhost:3000)，端口占用时自动选择其他端口）。`npm run dev` 与 `npm start` 等效。

## 检查与构建

```bash
npm run typecheck
npm test
npm run build
```

`npm test` 使用 Vitest 执行一次测试；`npm run test:watch` 持续监听修改。测试配置在 `vite.config.ts`，测试示例在 `src/App.test.tsx`。

生产文件输出到 `build/`。执行 `npm run preview`，在 [http://localhost:4173](http://localhost:4173) 本地预览生产构建。

HTML 入口位于 `frontend/index.html`；图片、图标等静态资源放在 `public/`，代码和样式放在 `src/`。

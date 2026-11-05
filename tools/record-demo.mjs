import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";

/**
 * 自动演示：跑一遍完整业务流程，同时截图并录制带中文讲解字幕的演示视频。
 * 字幕只出现在视频里；截图会在按下快门的那一瞬清空字幕，保证 README 截图干净。
 * 使用前先启动：contracts/ 里 npm run node && npm run deploy && npm run prepare:users
 * 运行：cd tools && npm run record
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(root, "docs", "screenshots");
const videoDir = path.join(root, "docs", "video");
fs.rmSync(shotDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const pause = (page, ms = 900) => page.waitForTimeout(ms);

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    recordVideo: { dir: path.join(videoDir, "raw"), size: { width: 1280, height: 820 } },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGE ERROR:", error.message));

  const shot = async (name) => {
    const file = path.join(shotDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("截图", path.basename(file));
  };
  const step = async (name, action) => {
    try {
      await action();
    } catch (error) {
      console.log(`步骤失败 [${name}]:`, error.message.split("\n")[0]);
    }
  };
  const tab = async (label) => {
    await page.getByText(label, { exact: true }).first().click();
    await pause(page, 1200);
  };

  // 字幕：视频里持续显示；截图瞬间清空，保证 README 截图不含字幕
  let currentCaption = "";
  const setCaption = async (text) => {
    currentCaption = text;
    await page.evaluate((t) => {
      const el = document.getElementById("rec-caption");
      if (el) el.textContent = t;
    }, text);
  };
  const shotClean = async (name) => {
    await page.evaluate(() => {
      const el = document.getElementById("rec-caption");
      if (el) el.textContent = "";
    });
    await pause(page, 180);
    await shot(name);
    await page.evaluate((t) => {
      const el = document.getElementById("rec-caption");
      if (el) el.textContent = t;
    }, currentCaption);
  };

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  // 注入字幕容器与样式
  await page.addStyleTag({
    content: `
      #rec-caption {
        position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%);
        max-width: 94%; box-sizing: border-box;
        background: rgba(13, 20, 38, 0.84); color: #fff;
        font: 600 19px/1.55 "Microsoft YaHei", "PingFang SC", sans-serif;
        padding: 11px 20px; border-radius: 12px; z-index: 99999;
        box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        text-align: center; pointer-events: none; letter-spacing: 0.2px;
      }`,
  });
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.id = "rec-caption";
    document.body.appendChild(el);
  });

  await setCaption(
    "MiniDEX：Uniswap V2 风格的 AMM 去中心化交易所。右上角可切换 20 个测试账户，相当于 20 个用户。"
  );
  await pause(page, 2600);

  // 1. 水龙头
  await step("faucet", async () => {
    await tab("水龙头");
    await setCaption(
      "第一步 · 水龙头：点「一键领取全部」，获取测试代币与测试 ETH（每个地址每小时可领一次）。"
    );
    await shotClean("02-faucet");
    await page.getByRole("button", { name: "一键领取全部" }).click();
    await pause(page, 4500);
    await shotClean("03-faucet-claimed");
  });

  // 2. 交易池
  await step("pools", async () => {
    await tab("交易池");
    await setCaption(
      "第二步 · 创建交易池：选 TKB / TKC，合约自动排序 token0、token1，同一交易对只有一个池子。"
    );
    await shotClean("04-pools");
    await page.getByLabel("代币 A").selectOption("TKB");
    await page.getByLabel("代币 B").selectOption("TKC");
    await pause(page, 400);
    await page.getByRole("button", { name: "创建交易池" }).click();
    await pause(page, 2600);
    await shotClean("05-pools-created");
  });

  // 3. 添加流动性 -> 铸造 NFT
  await step("liquidity", async () => {
    await tab("流动性");
    await setCaption(
      "第三步 · 添加流动性并铸造 ERC721 凭证：注入 1000 TKB + 1000 TKC，获得一枚含份额、时间与可赎回量的 NFT。"
    );
    await page.getByLabel("交易所 / 交易池").selectOption("0-3");
    await pause(page, 800);
    await page.getByLabel("TKB 数量").fill("1000");
    await page.getByLabel("TKC 数量").fill("1000");
    await pause(page, 900);
    await shotClean("06-liquidity-form");
    await page.getByRole("button", { name: "添加流动性并铸造 NFT" }).click();
    await pause(page, 3200);
    await shotClean("07-liquidity-nft");
  });

  // 4. 兑换
  await step("trade", async () => {
    await tab("兑换");
    await setCaption(
      "第四步 · 兑换：用 100 TKA 换 TKB，恒定乘积公式定价、扣 0.3% 手续费，并显示价格冲击与最少到手量。"
    );
    await page.getByLabel("支付数量（TKA）").fill("100");
    await pause(page, 1500);
    await shotClean("08-trade-quote");
    await page.getByRole("button", { name: "执行兑换" }).click();
    await pause(page, 3200);
    await shotClean("09-trade-done");
  });

  // 5. 套利（先用部署后的新鲜价差演示，保证一定可以套利）
  await step("arbitrage", async () => {
    await tab("套利");
    await setCaption(
      "第五步（Bonus）· 双交易所价差：A 为 1:1，B 为 1:0.8，同一 TKA/TKB 对价差约 2500 个基点。"
    );
    await shotClean("11-arbitrage-gap");
    await page.getByRole("button", { name: "搜索最优投入" }).click();
    await setCaption(
      "搜索最优投入：套利合约在链上采样 40 个金额，挑出利润最大的那个。"
    );
    await pause(page, 3000);
    await shotClean("12-arbitrage-optimal");
    await page.getByRole("button", { name: "一键套利" }).click();
    await setCaption(
      "一键套利：一笔交易内「低价买入 → 高价卖出」，无利润则整笔 revert；右侧展示前后价格与净利润。"
    );
    await page.waitForFunction(
      () => document.body.innerText.includes("套利成功") || document.body.innerText.includes("套利失败"),
      undefined,
      { timeout: 120000 }
    );
    await pause(page, 2400);
    await shotClean("13-arbitrage-result");
  });

  // 6. 模拟交易（20 个用户随机交易）
  await step("simulation", async () => {
    await tab("模拟交易");
    await setCaption(
      "第六步 · 20 个模拟用户随机交易：一键运行，实时绘制两个交易所 TKA/TKB 的价格曲线与操作日志。"
    );
    await page.getByLabel("轮次").fill("12");
    await page.getByRole("button", { name: "运行模拟" }).click();
    await page.waitForFunction(() => document.body.innerText.includes("模拟完成"), undefined, {
      timeout: 180000,
    });
    await pause(page, 1800);
    await shotClean("10-simulation");
  });

  // 7. 销毁 NFT 取回流动性
  await step("redeem", async () => {
    await tab("流动性");
    await setCaption(
      "第七步 · 销毁 NFT 赎回：按份额取回本金，以及这段时间累计在储备里的手续费分红。"
    );
    await page.getByRole("button", { name: "销毁并取回" }).first().click();
    await pause(page, 3200);
    await shotClean("14-liquidity-redeem");
  });

  // 8. 回到总览收尾
  await step("overview-outro", async () => {
    await tab("总览");
    await setCaption(
      "收尾 · 总览页汇总累计成交、流动性凭证数量、套利利润、两条价格曲线与最近的链上活动。"
    );
    await pause(page, 2200);
    await shotClean("01-overview");
  });

  const video = page.video();
  await context.close();
  await browser.close();

  const webm = await video.path();
  console.log("原始录屏:", webm);

  if (ffmpegPath) {
    const mp4 = path.join(videoDir, "demo.mp4");
    execFileSync(ffmpegPath, [
      "-y",
      "-i",
      webm,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "24",
      "-movflags",
      "+faststart",
      "-an",
      mp4,
    ]);
    console.log("已生成 mp4:", mp4);
    fs.rmSync(path.dirname(webm), { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

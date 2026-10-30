import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";

/**
 * 自动演示：跑一遍完整业务流程，同时截图并录制演示视频。
 * 使用前先启动：contracts/ 里 npm run node && npm run deploy（可选 npm run prepare:users）
 * 运行：cd tools && npm run record
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(root, "docs", "screenshots");
const videoDir = path.join(root, "docs", "video");
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

  let index = 1;
  const shot = async (name) => {
    const file = path.join(shotDir, `${String(index).padStart(2, "0")}-${name}.png`);
    index += 1;
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

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await pause(page, 2500);

  // 1. 水龙头
  await step("faucet", async () => {
    await shot("faucet");
    for (const symbol of ["TKA", "TKB", "TKC"]) {
      await page.getByRole("button", { name: `领取 ${symbol}` }).click();
      await pause(page, 1600);
    }
    await page.getByRole("button", { name: "领取 1 ETH" }).click();
    await pause(page, 2200);
    await shot("faucet-claimed");
  });

  // 2. 交易池
  await step("pools", async () => {
    await tab("交易池");
    await shot("pools");
    await page.getByLabel("代币 A").selectOption("TKB");
    await page.getByLabel("代币 B").selectOption("TKC");
    await pause(page, 400);
    await page.getByRole("button", { name: "创建交易池" }).click();
    await pause(page, 2600);
    await shot("pools-created");
  });

  // 3. 添加流动性 -> 铸造 NFT
  await step("liquidity", async () => {
    await tab("流动性");
    await page.getByLabel("交易所 / 交易池").selectOption("0-3");
    await pause(page, 800);
    await page.getByLabel("TKB 数量").fill("1000");
    await page.getByLabel("TKC 数量").fill("1000");
    await pause(page, 900);
    await shot("liquidity-form");
    await page.getByRole("button", { name: "添加流动性并铸造 NFT" }).click();
    await pause(page, 3200);
    await shot("liquidity-nft");
  });

  // 4. 兑换
  await step("trade", async () => {
    await tab("兑换");
    await page.getByLabel("支付数量（TKA）").fill("100");
    await pause(page, 1400);
    await shot("trade-quote");
    await page.getByRole("button", { name: "执行兑换" }).click();
    await pause(page, 3200);
    await shot("trade-done");
  });

  // 5. 模拟交易
  await step("simulation", async () => {
    await tab("模拟交易");
    await page.getByLabel("轮次").fill("12");
    await page.getByRole("button", { name: "运行模拟" }).click();
    await page.waitForFunction(
      () => document.body.innerText.includes("模拟完成"),
      undefined,
      { timeout: 180000 }
    );
    await pause(page, 1500);
    await shot("simulation");
  });

  // 6. 套利
  await step("arbitrage", async () => {
    await tab("套利");
    await shot("arbitrage-gap");
    await page.getByRole("button", { name: "搜索最优投入" }).click();
    await pause(page, 3000);
    await shot("arbitrage-optimal");
    await page.getByRole("button", { name: "一键套利" }).click();
    await page.waitForFunction(
      () => document.body.innerText.includes("套利成功") || document.body.innerText.includes("套利失败"),
      undefined,
      { timeout: 120000 }
    );
    await pause(page, 2000);
    await shot("arbitrage-result");
  });

  // 7. 销毁 NFT 取回流动性
  await step("redeem", async () => {
    await tab("流动性");
    await page.getByRole("button", { name: "销毁并取回" }).first().click();
    await pause(page, 3200);
    await shot("liquidity-redeem");
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

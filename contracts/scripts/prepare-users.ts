import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

/**
 * 为「页面里的快速模拟」准备测试账户：
 * 让节点上第 2~20 个账户领取测试币 / ETH、包装 WETH，并授权两个交易所与套利合约。
 * 第 1 个账户（部署者）保持未领取状态，方便在演示视频里展示水龙头。
 */

async function main() {
  const deploymentPath = path.resolve(process.cwd(), "deployments/local.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("找不到 deployments/local.json，请先运行 npm run deploy");
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const { ethers } = await hre.network.create();
  const signers = await ethers.getSigners();
  const users = signers.slice(1, 20);

  const tokens = [];
  for (const token of deployment.tokens) {
    tokens.push(await ethers.getContractAt("MockERC20", token.address));
  }
  const weth = await ethers.getContractAt("MockWETH", deployment.weth.address);
  const faucet = await ethers.getContractAt("Faucet", deployment.faucet);
  const dexAddresses = deployment.dexes.map((dex: any) => dex.address);
  const spender = [...dexAddresses, deployment.arbitrage];

  for (const user of users) {
    const address = await user.getAddress();
    for (const token of tokens) {
      try {
        await (await token.connect(user).claim()).wait();
      } catch {
        /* 冷却中 */
      }
      for (const target of spender) {
        await (await token.connect(user).approve(target, ethers.MaxUint256)).wait();
      }
    }
    try {
      await (await faucet.connect(user).claimETH()).wait();
    } catch {
      /* 冷却中 */
    }
    await (await weth.connect(user).deposit({ value: ethers.parseEther("2") })).wait();
    for (const target of spender) {
      await (await weth.connect(user).approve(target, ethers.MaxUint256)).wait();
    }
    console.log(`已准备 ${address}`);
  }

  console.log(`\n完成：${users.length} 个模拟账户已领币并完成授权`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

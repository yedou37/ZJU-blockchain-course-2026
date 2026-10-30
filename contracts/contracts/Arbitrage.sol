// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMiniDEX {
    function getReserves(uint256 poolId)
        external
        view
        returns (address token0, address token1, uint256 reserve0, uint256 reserve1, uint256 totalShares);

    function getAmountOut(uint256 poolId, address tokenIn, uint256 amountIn) external view returns (uint256);

    function swapExactIn(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external returns (uint256);
}

/// @title Arbitrage
/// @notice 跨交易所原子套利：在低价池买入，立刻在高价池卖出，整个过程在一笔交易内完成。
///         只要最终回款不足以覆盖本金 + 最小利润，整笔交易 revert，两笔 swap 一起回滚。
contract Arbitrage is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Preview {
        address tokenOut;
        uint256 midAmount;
        uint256 finalAmount;
        uint256 profit;
        uint256 priceBuyBefore;
        uint256 priceSellBefore;
    }

    /// @notice 套利成功的完整记录（价格变化另见 PriceSnapshot 事件）
    event ArbitrageExecuted(
        address indexed trader,
        address indexed buyDEX,
        uint256 buyPoolId,
        address indexed sellDEX,
        uint256 sellPoolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 profit
    );

    /// @notice 套利前后的现货价格快照：1 个 tokenIn 值多少个 tokenOut（18 位小数）
    event PriceSnapshot(address indexed dex, uint256 poolId, address tokenIn, uint256 price, uint256 timestamp);

    /// @notice 预估一次套利的结果（不修改状态）
    function preview(
        address buyDEX,
        uint256 buyPoolId,
        address sellDEX,
        uint256 sellPoolId,
        address tokenIn,
        uint256 amountIn
    ) public view returns (Preview memory result) {
        (address token0, address token1, , , ) = IMiniDEX(buyDEX).getReserves(buyPoolId);
        require(tokenIn == token0 || tokenIn == token1, "Arbitrage: token not in buy pool");

        result.tokenOut = tokenIn == token0 ? token1 : token0;
        result.midAmount = IMiniDEX(buyDEX).getAmountOut(buyPoolId, tokenIn, amountIn);
        result.finalAmount = IMiniDEX(sellDEX).getAmountOut(sellPoolId, result.tokenOut, result.midAmount);
        result.profit = result.finalAmount > amountIn ? result.finalAmount - amountIn : 0;
        result.priceBuyBefore = price(buyDEX, buyPoolId, tokenIn);
        result.priceSellBefore = price(sellDEX, sellPoolId, tokenIn);
    }

    /// @notice 执行原子套利
    /// @param buyDEX 低价交易所地址
    /// @param buyPoolId 低价池编号
    /// @param sellDEX 高价交易所地址
    /// @param sellPoolId 高价池编号
    /// @param tokenIn 套利者投入的代币（在低价池买入 tokenOut，再在高价池卖回 tokenIn）
    /// @param amountIn 投入数量
    /// @param minProfit 最少要赚到的利润，达不到就 revert
    function execute(
        address buyDEX,
        uint256 buyPoolId,
        address sellDEX,
        uint256 sellPoolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minProfit
    ) external nonReentrant returns (uint256 profit) {
        require(amountIn > 0, "Arbitrage: zero amount in");
        require(buyDEX != sellDEX || buyPoolId != sellPoolId, "Arbitrage: identical pool");

        Preview memory plan = preview(buyDEX, buyPoolId, sellDEX, sellPoolId, tokenIn, amountIn);
        // 先整体预估一次，必须真正有利润且达到要求，否则直接拒绝，避免白付 gas
        require(
            plan.finalAmount > amountIn && plan.finalAmount - amountIn >= minProfit,
            "Arbitrage: not profitable"
        );

        _snapshot(buyDEX, buyPoolId, tokenIn);
        _snapshot(sellDEX, sellPoolId, tokenIn);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 第 1 步：在低价池买入 tokenOut
        IERC20(tokenIn).forceApprove(buyDEX, amountIn);
        uint256 midAmount = IMiniDEX(buyDEX).swapExactIn(buyPoolId, tokenIn, amountIn, 0, address(this));

        // 第 2 步：在高价池卖出 tokenOut，换回 tokenIn
        IERC20(plan.tokenOut).forceApprove(sellDEX, midAmount);
        uint256 amountOut = IMiniDEX(sellDEX).swapExactIn(sellPoolId, plan.tokenOut, midAmount, 0, address(this));

        // 第 3 步：整体校验，达不到目标利润就 revert，两笔 swap 一起回滚
        require(amountOut >= amountIn + minProfit, "Arbitrage: profit below minimum");
        profit = amountOut - amountIn;

        IERC20(tokenIn).forceApprove(buyDEX, 0);
        IERC20(plan.tokenOut).forceApprove(sellDEX, 0);
        IERC20(tokenIn).safeTransfer(msg.sender, amountOut);

        _snapshot(buyDEX, buyPoolId, tokenIn);
        _snapshot(sellDEX, sellPoolId, tokenIn);

        emit ArbitrageExecuted(
            msg.sender,
            buyDEX,
            buyPoolId,
            sellDEX,
            sellPoolId,
            tokenIn,
            plan.tokenOut,
            amountIn,
            amountOut,
            profit
        );
    }

    /// @notice 「1 个 tokenIn 值多少个另一种代币」的现货价格，18 位小数
    function price(address dex, uint256 poolId, address tokenIn) public view returns (uint256) {
        (address token0, address token1, uint256 reserve0, uint256 reserve1, ) = IMiniDEX(dex).getReserves(poolId);
        require(tokenIn == token0 || tokenIn == token1, "Arbitrage: token not in pool");
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        require(reserveIn > 0, "Arbitrage: empty reserve");
        return (reserveOut * 1e18) / reserveIn;
    }

    function _snapshot(address dex, uint256 poolId, address tokenIn) private {
        emit PriceSnapshot(dex, poolId, tokenIn, price(dex, poolId, tokenIn), block.timestamp);
    }
}

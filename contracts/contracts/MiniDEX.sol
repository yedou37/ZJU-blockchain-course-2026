// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title MiniDEX
/// @notice 基于恒定乘积公式（x * y = k）的自动做市商交易所，参考 Uniswap V2 实现。
///         一个合约实例 = 一个交易所，内部可以创建多个交易池。
///         流动性凭证用 ERC721 NFT 表示：每添加一次流动性铸造一枚，销毁即可赎回本金与手续费分红。
contract MiniDEX is ERC721, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    /// @notice 手续费，30 基点 = 0.3%
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS = 10_000;

    struct Pool {
        uint256 poolId;
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalShares;
        uint256 feeBps;
        uint256 createdAt;
        uint256 swapCount;
    }

    struct Position {
        uint256 poolId;
        uint256 shares;
        uint256 amount0AtMint;
        uint256 amount1AtMint;
        uint256 createdAt;
    }

    /// @notice 交易池数量，poolId 从 1 开始
    uint256 public poolCount;
    /// @notice 已铸造的流动性 NFT 数量，tokenId 从 1 开始
    uint256 public positionCount;

    mapping(uint256 => Pool) public pools;
    /// @notice keccak256(token0, token1) => poolId，0 表示该交易对还没有池子
    mapping(bytes32 => uint256) public poolIdOfPair;
    mapping(uint256 => Position) public positions;

    event PoolCreated(uint256 indexed poolId, address indexed token0, address indexed token1, uint256 createdAt);
    event LiquidityAdded(
        uint256 indexed poolId,
        uint256 indexed positionId,
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event LiquidityRemoved(
        uint256 indexed poolId,
        uint256 indexed positionId,
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event Swap(
        uint256 indexed poolId,
        address indexed trader,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 reserve0,
        uint256 reserve1
    );

    constructor(string memory exchangeName) ERC721(exchangeName, "MiniDEX-LP") {}

    // ---------------------------------------------------------------------
    // 交易池
    // ---------------------------------------------------------------------

    /// @notice 创建交易池，同一交易对只能建一个池；代币地址自动排序成 token0 < token1
    function createPool(address tokenA, address tokenB) external returns (uint256 poolId) {
        require(tokenA != address(0) && tokenB != address(0), "MiniDEX: zero token address");
        require(tokenA != tokenB, "MiniDEX: identical tokens");
        require(tokenA.code.length > 0 && tokenB.code.length > 0, "MiniDEX: token has no code");

        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 key = keccak256(abi.encodePacked(token0, token1));
        require(poolIdOfPair[key] == 0, "MiniDEX: pool already exists");

        poolId = ++poolCount;
        pools[poolId] = Pool({
            poolId: poolId,
            token0: token0,
            token1: token1,
            reserve0: 0,
            reserve1: 0,
            totalShares: 0,
            feeBps: FEE_BPS,
            createdAt: block.timestamp,
            swapCount: 0
        });
        poolIdOfPair[key] = poolId;

        emit PoolCreated(poolId, token0, token1, block.timestamp);
    }

    // ---------------------------------------------------------------------
    // 流动性
    // ---------------------------------------------------------------------

    /// @notice 添加流动性，并铸造一枚代表该份额的 ERC721 NFT
    function addLiquidity(
        uint256 poolId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant returns (uint256 positionId, uint256 amount0, uint256 amount1, uint256 shares) {
        Pool storage pool = pools[poolId];
        require(pool.poolId != 0, "MiniDEX: pool not found");
        require(amount0Desired > 0 && amount1Desired > 0, "MiniDEX: zero amount");

        if (pool.totalShares == 0) {
            // 首次注入：份额 = sqrt(amount0 * amount1)
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            shares = _sqrt(amount0 * amount1);
            require(shares > 0, "MiniDEX: insufficient initial liquidity");
        } else {
            // 后续注入：按当前储备比例配比，取两种代币中较少的那一份
            uint256 amount1Optimal = (amount0Desired * pool.reserve1) / pool.reserve0;
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "MiniDEX: insufficient token1 amount");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * pool.reserve0) / pool.reserve1;
                require(amount0Optimal >= amount0Min, "MiniDEX: insufficient token0 amount");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            require(amount0 >= amount0Min, "MiniDEX: insufficient token0 amount");
            shares = _min(
                (amount0 * pool.totalShares) / pool.reserve0,
                (amount1 * pool.totalShares) / pool.reserve1
            );
            require(shares > 0, "MiniDEX: insufficient liquidity minted");
        }

        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), amount1);

        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalShares += shares;

        positionId = ++positionCount;
        positions[positionId] = Position({
            poolId: poolId,
            shares: shares,
            amount0AtMint: amount0,
            amount1AtMint: amount1,
            createdAt: block.timestamp
        });
        _mint(msg.sender, positionId);

        emit LiquidityAdded(poolId, positionId, msg.sender, amount0, amount1, shares);
    }

    /// @notice 销毁流动性 NFT，按份额取回两种代币（手续费累积在储备里，因此自动获得分红）
    function removeLiquidity(
        uint256 positionId,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        address owner = _requireOwned(positionId);
        require(
            owner == msg.sender || isApprovedForAll(owner, msg.sender) || getApproved(positionId) == msg.sender,
            "MiniDEX: not position owner"
        );

        Position memory position = positions[positionId];
        Pool storage pool = pools[position.poolId];
        require(pool.totalShares > 0, "MiniDEX: empty pool");

        amount0 = (position.shares * pool.reserve0) / pool.totalShares;
        amount1 = (position.shares * pool.reserve1) / pool.totalShares;
        require(amount0 >= amount0Min, "MiniDEX: insufficient token0 out");
        require(amount1 >= amount1Min, "MiniDEX: insufficient token1 out");

        pool.totalShares -= position.shares;
        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;

        delete positions[positionId];
        _burn(positionId);

        IERC20(pool.token0).safeTransfer(msg.sender, amount0);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(pool.poolId, positionId, msg.sender, amount0, amount1, position.shares);
    }

    // ---------------------------------------------------------------------
    // 交易
    // ---------------------------------------------------------------------

    /// @notice 用固定数量的 tokenIn 换取 tokenOut，收取 0.3% 手续费
    function swapExactIn(
        uint256 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external nonReentrant returns (uint256 amountOut) {
        require(to != address(0), "MiniDEX: zero recipient");
        require(amountIn > 0, "MiniDEX: zero amount in");

        Pool storage pool = pools[poolId];
        require(pool.poolId != 0, "MiniDEX: pool not found");
        require(tokenIn == pool.token0 || tokenIn == pool.token1, "MiniDEX: invalid token in");

        amountOut = _getAmountOut(pool, tokenIn, amountIn);
        require(amountOut > 0, "MiniDEX: zero amount out");
        require(amountOut >= minAmountOut, "MiniDEX: slippage exceeded");

        address tokenOut = tokenIn == pool.token0 ? pool.token1 : pool.token0;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn == pool.token0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= amountOut;
        }
        pool.swapCount += 1;
        IERC20(tokenOut).safeTransfer(to, amountOut);

        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut, pool.reserve0, pool.reserve1);
    }

    /// @notice 预估 swap 输出（已扣 0.3% 手续费）
    function getAmountOut(uint256 poolId, address tokenIn, uint256 amountIn) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        require(pool.poolId != 0, "MiniDEX: pool not found");
        require(tokenIn == pool.token0 || tokenIn == pool.token1, "MiniDEX: invalid token in");
        return _getAmountOut(pool, tokenIn, amountIn);
    }

    // ---------------------------------------------------------------------
    // 只读辅助
    // ---------------------------------------------------------------------

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    function getPools() external view returns (Pool[] memory list) {
        list = new Pool[](poolCount);
        for (uint256 i = 1; i <= poolCount; i++) {
            list[i - 1] = pools[i];
        }
    }

    /// @notice 池子储备，供套利合约等外部合约读取
    function getReserves(uint256 poolId)
        external
        view
        returns (address token0, address token1, uint256 reserve0, uint256 reserve1, uint256 totalShares)
    {
        Pool storage pool = pools[poolId];
        require(pool.poolId != 0, "MiniDEX: pool not found");
        return (pool.token0, pool.token1, pool.reserve0, pool.reserve1, pool.totalShares);
    }

    /// @notice 现货价格：1 个 token0 值多少个 token1（18 位小数）
    function getSpotPrice(uint256 poolId) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        require(pool.poolId != 0 && pool.reserve0 > 0, "MiniDEX: empty pool");
        return (pool.reserve1 * 1e18) / pool.reserve0;
    }

    /// @notice 查询某个地址持有的所有流动性 NFT
    function tokenIdsOf(address owner) external view returns (uint256[] memory ids) {
        uint256 total = positionCount;
        uint256 count = 0;
        for (uint256 i = 1; i <= total; i++) {
            if (_ownerOf(i) == owner) {
                count++;
            }
        }
        ids = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= total; i++) {
            if (_ownerOf(i) == owner) {
                ids[index++] = i;
            }
        }
    }

    /// @notice 某枚 NFT 现在销毁能赎回多少代币（含手续费分红）
    function getPositionValue(uint256 positionId) external view returns (uint256 amount0, uint256 amount1) {
        return _positionValue(positions[positionId]);
    }

    struct PositionView {
        uint256 tokenId;
        address owner;
        uint256 poolId;
        uint256 shares;
        uint256 amount0;
        uint256 amount1;
        uint256 amount0AtMint;
        uint256 amount1AtMint;
        uint256 createdAt;
    }

    /// @notice 一次性返回所有未销毁的流动性凭证，方便前端展示「流动性来源」与手续费收益
    function getAllPositions() external view returns (PositionView[] memory list) {
        list = new PositionView[](positionCount);
        for (uint256 i = 1; i <= positionCount; i++) {
            address owner = _ownerOf(i);
            if (owner == address(0)) {
                continue;
            }
            Position memory position = positions[i];
            (uint256 amount0, uint256 amount1) = _positionValue(position);
            list[i - 1] = PositionView({
                tokenId: i,
                owner: owner,
                poolId: position.poolId,
                shares: position.shares,
                amount0: amount0,
                amount1: amount1,
                amount0AtMint: position.amount0AtMint,
                amount1AtMint: position.amount1AtMint,
                createdAt: position.createdAt
            });
        }
    }

    function _positionValue(Position memory position) private view returns (uint256 amount0, uint256 amount1) {
        Pool storage pool = pools[position.poolId];
        if (position.shares == 0 || pool.totalShares == 0) {
            return (0, 0);
        }
        amount0 = (position.shares * pool.reserve0) / pool.totalShares;
        amount1 = (position.shares * pool.reserve1) / pool.totalShares;
    }

    /// @notice NFT 链上元数据：直接返回 data URI，包含池子信息、份额与创建时间
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Position memory position = positions[tokenId];
        Pool memory pool = pools[position.poolId];

        string memory json = string.concat(
            '{"name":"MiniDEX LP #',
            tokenId.toString(),
            '","description":"Liquidity position in pool #',
            position.poolId.toString(),
            ' of ',
            name(),
            '","attributes":[{"trait_type":"poolId","value":',
            position.poolId.toString(),
            '},{"trait_type":"shares","value":"',
            position.shares.toString(),
            '"},{"trait_type":"token0","value":"',
            IERC20Metadata(pool.token0).symbol(),
            '"},{"trait_type":"token1","value":"',
            IERC20Metadata(pool.token1).symbol(),
            '"},{"trait_type":"createdAt","value":',
            position.createdAt.toString(),
            "}]}"
        );
        return string.concat("data:application/json;utf8,", json);
    }

    // ---------------------------------------------------------------------
    // 内部工具
    // ---------------------------------------------------------------------

    function _getAmountOut(Pool storage pool, address tokenIn, uint256 amountIn)
        private
        view
        returns (uint256 amountOut)
    {
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == pool.token0
            ? (pool.reserve0, pool.reserve1)
            : (pool.reserve1, pool.reserve0);
        require(reserveIn > 0 && reserveOut > 0, "MiniDEX: empty reserve");

        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * BPS + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

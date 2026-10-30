// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice 作业用测试代币：部署时给部署者预铸初始供应量，任何地址都可以通过 claim() 水龙头领取测试币。
contract MockERC20 is ERC20 {
    /// @notice 每次领取的数量（1000 枚，按 18 位小数）
    uint256 public constant FAUCET_AMOUNT = 1_000 * 1e18;
    /// @notice 同一个地址两次领取之间的冷却时间
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    uint8 private immutable _decimals;

    /// @notice 记录每个地址上次领取的时间戳
    mapping(address => uint256) public lastClaimAt;

    event FaucetClaimed(address indexed user, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        if (initialSupply > 0) {
            _mint(msg.sender, initialSupply);
        }
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice 领取测试代币，每个地址每小时可以领取一次
    function claim() external returns (uint256) {
        require(
            block.timestamp >= lastClaimAt[msg.sender] + FAUCET_COOLDOWN,
            "MockERC20: faucet is cooling down"
        );
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
        return FAUCET_AMOUNT;
    }

    /// @notice 距离下次可领取还剩多少秒（0 表示现在就可以领）
    function faucetCooldownLeft(address user) external view returns (uint256) {
        uint256 readyAt = lastClaimAt[user] + FAUCET_COOLDOWN;
        if (block.timestamp >= readyAt) {
            return 0;
        }
        return readyAt - block.timestamp;
    }
}

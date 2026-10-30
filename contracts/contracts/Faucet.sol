// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Faucet
/// @notice 测试用 ETH 水龙头：部署时注入一笔 ETH，任何地址每小时可以领取 1 ETH。
contract Faucet {
    uint256 public constant CLAIM_AMOUNT = 1 ether;
    uint256 public constant CLAIM_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastClaimAt;

    event ETHClaimed(address indexed user, uint256 amount);

    constructor() payable {}

    receive() external payable {}

    /// @notice 领取 1 ETH
    function claimETH() external returns (uint256) {
        require(
            block.timestamp >= lastClaimAt[msg.sender] + CLAIM_COOLDOWN,
            "Faucet: faucet is cooling down"
        );
        require(address(this).balance >= CLAIM_AMOUNT, "Faucet: empty");

        lastClaimAt[msg.sender] = block.timestamp;
        (bool ok, ) = payable(msg.sender).call{value: CLAIM_AMOUNT}("");
        require(ok, "Faucet: ETH transfer failed");

        emit ETHClaimed(msg.sender, CLAIM_AMOUNT);
        return CLAIM_AMOUNT;
    }

    function cooldownLeft(address user) external view returns (uint256) {
        uint256 readyAt = lastClaimAt[user] + CLAIM_COOLDOWN;
        if (block.timestamp >= readyAt) {
            return 0;
        }
        return readyAt - block.timestamp;
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}

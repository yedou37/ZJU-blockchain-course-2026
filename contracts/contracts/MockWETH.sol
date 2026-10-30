// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWETH
/// @notice 简化的 WETH：把原生 ETH 包装成 ERC20，让 AMM 可以用统一的 ERC20 接口处理 ETH 交易对。
contract MockWETH is ERC20 {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    constructor() ERC20("Wrapped Ether", "WETH") {}

    receive() external payable {
        deposit();
    }

    /// @notice ETH -> WETH
    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice WETH -> ETH
    function withdraw(uint256 wad) public {
        _burn(msg.sender, wad);
        (bool ok, ) = payable(msg.sender).call{value: wad}("");
        require(ok, "MockWETH: ETH transfer failed");
        emit Withdrawal(msg.sender, wad);
    }
}

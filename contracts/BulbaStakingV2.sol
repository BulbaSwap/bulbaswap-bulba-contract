// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./BulbaStaking.sol";

contract BulbaStakingV2 is BulbaStaking {
    uint256 public version;
    function setVersion(uint256 _version) public {
        version = _version;
    }
}

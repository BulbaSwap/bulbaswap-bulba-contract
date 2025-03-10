// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract MockTokenStaking is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    IERC20 public stakingToken;

    // Staking periods in seconds
    uint256 public constant THIRTY_DAYS = 30 days;
    uint256 public constant SIXTY_DAYS = 60 days;
    uint256 public constant NINETY_DAYS = 90 days;

    struct StakeInfo {
        uint256 amount;
        uint256 startTime;
        bool isActive;
    }

    // Mapping from address to lock period to stake info
    mapping(address user => mapping(uint256 lockPeriod => StakeInfo stakeInfo)) public stakes;

    // Define a controller role can transfer
    address public controller;
    
    event Staked(address indexed user, uint256 amount, uint256 lockPeriod);
    event Unstaked(address indexed user, uint256 amount, uint256 lockPeriod);
    event Initialized(address stakingToken);

    // Modifier to restrict access to the controller
    modifier onlyController() {
        require(msg.sender == controller, "Caller is not the controller");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _stakingToken) public initializer {
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __Pausable_init();
        
        stakingToken = IERC20(_stakingToken);
        emit Initialized(_stakingToken);
    }

    function stake(uint256 amount, uint256 lockPeriod) external nonReentrant whenNotPaused {
        require(amount > 0, "Cannot stake 0 tokens");
        require(
            lockPeriod == THIRTY_DAYS || 
            lockPeriod == SIXTY_DAYS || 
            lockPeriod == NINETY_DAYS,
            "Invalid lock period"
        );
        uint256 amountPre = stakes[msg.sender][lockPeriod].amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);
        
        stakes[msg.sender][lockPeriod] = StakeInfo({
            amount: amount + amountPre,
            startTime: block.timestamp,
            isActive: true
        });

        emit Staked(msg.sender, amount, lockPeriod);
    }

    function unstake(uint256 lockPeriod) external nonReentrant whenNotPaused {
        require(
            lockPeriod == THIRTY_DAYS || 
            lockPeriod == SIXTY_DAYS || 
            lockPeriod == NINETY_DAYS,
            "Invalid lock period"
        );
        
        StakeInfo memory stakeInfo = stakes[msg.sender][lockPeriod];
        require(stakeInfo.isActive, "No active stake for this period");
        require(
            block.timestamp >= stakeInfo.startTime + lockPeriod,
            "Lock period not ended"
        );

        uint256 stakeAmount = stakeInfo.amount;

        require(
            stakingToken.balanceOf(address(this)) >= stakeAmount,
            "Insufficient contract balance"
        );
        delete stakes[msg.sender][lockPeriod];
        stakingToken.transfer(msg.sender, stakeAmount);

        emit Unstaked(msg.sender, stakeInfo.amount,  lockPeriod);
    }

    function getStakeInfo(address user, uint256 lockPeriod) external view returns (
        uint256 amount,
        uint256 startTime,
        bool isActive,
        uint256 timeUntilUnlock
    ) {
        require(
            lockPeriod == THIRTY_DAYS || 
            lockPeriod == SIXTY_DAYS || 
            lockPeriod == NINETY_DAYS,
            "Invalid lock period"
        );

        StakeInfo storage stakeInfo = stakes[user][lockPeriod];
        amount = stakeInfo.amount;
        startTime = stakeInfo.startTime;
        isActive = stakeInfo.isActive;

        if (!isActive || block.timestamp >= startTime + lockPeriod) {
            timeUntilUnlock = 0;
        } else {
            timeUntilUnlock = (startTime + lockPeriod) - block.timestamp;
        }
    }

    function getAllStakes(address user) external view returns (
        uint256[3] memory amounts,
        uint256[3] memory startTimes,
        bool[3] memory isActives,
        uint256[3] memory timeUntilUnlocks
    ) {
        uint256[3] memory periods = [THIRTY_DAYS, SIXTY_DAYS, NINETY_DAYS];
        
        for (uint256 i = 0; i < 3; i++) {
            StakeInfo storage stakeInfo = stakes[user][periods[i]];
            amounts[i] = stakeInfo.amount;
            startTimes[i] = stakeInfo.startTime;
            isActives[i] = stakeInfo.isActive;

            if (!isActives[i] || block.timestamp >= startTimes[i] + periods[i]) {
                timeUntilUnlocks[i] = 0;
            } else {
                timeUntilUnlocks[i] = (startTimes[i] + periods[i]) - block.timestamp;
            }
        }
    }

    // Emergency function to withdraw tokens (only owner)
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        require(amount <= stakingToken.balanceOf(address(this)), "Insufficient balance");
        stakingToken.transfer(owner(), amount);
    }

    // Function to set the controller
    function setController(address _controller) external onlyOwner {
        controller = _controller;
    }

    // Function for the controller to transfer tokens
    function transferTokens(address to, uint256 amount) external onlyController {
        require(amount <= stakingToken.balanceOf(address(this)), "Insufficient balance");
        stakingToken.transfer(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Gap for future upgrades
    uint256[50] private __gap;
} 
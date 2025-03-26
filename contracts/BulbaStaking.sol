// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title BulbaStaking
 */
contract BulbaStaking is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    IERC20 public stakingToken; // The ERC20 token used for staking

    // Staking periods in seconds
    uint256 public constant THIRTY_DAYS = 30 days;
    uint256 public constant SIXTY_DAYS = 60 days;
    uint256 public constant NINETY_DAYS = 90 days;

    struct StakeInfo {
        uint256 amount; // Amount of tokens staked
        uint256 startTime; // Timestamp when the stake was made
        bool isActive; // Whether the stake is active
    }

    // Define a struct to track vesting schedules
    struct VestingSchedule {
        uint256 originalTotalAmount; // Original total amount to be vested
        uint256 remainingAmount; // Remaining amount to be vested
        uint256 startTime; // Start time of the vesting schedule
    }

    address public backendSigner; // Address of the backend signer for secure claims

    uint256 public totalClaimableAmount; // Total amount of tokens that can be claimed
    uint256 public totalVestingAmount; // Total amount of tokens that can be vested
    uint256 public totalStakedAmount; // Total amount of tokens staked

    // Mapping from address to lock period to stake info
    mapping(address user => mapping(uint256 lockPeriod => StakeInfo stakeInfo))
        public stakes;

    mapping(address user => uint256 nonce) public nonces; // Nonce for each user to prevent replay attacks

    // Mapping to track vesting schedules for each user
    mapping(address user => VestingSchedule vestingSchedule)
        public vestingSchedules;

    /**
     * @dev Emitted when a user stakes tokens.
     * @param user The address of the user who staked tokens.
     * @param amount The amount of tokens staked.
     * @param lockPeriod The lock period for the stake.
     */
    event Staked(address indexed user, uint256 amount, uint256 lockPeriod);

    /**
     * @dev Emitted when a user unstakes tokens.
     * @param user The address of the user who unstaked tokens.
     * @param amount The amount of tokens unstaked.
     * @param lockPeriod The lock period for the stake.
     */
    event Unstaked(address indexed user, uint256 amount, uint256 lockPeriod);

    /**
     * @dev Emitted when the contract is initialized.
     * @param stakingToken The address of the staking token.
     */
    event Initialized(address stakingToken);

    /**
     * @dev Emitted when a user claims tokens.
     * @param user The address of the user who claimed tokens.
     * @param amount The total amount of tokens claimed.
     * @param nonce The nonce used for the claim.
     * @param remainingAmount The remaining vested amount.
     */
    event Claimed(
        address indexed user,
        uint256 amount,
        uint256 nonce,
        uint256 remainingAmount
    );

    /**
     * @dev Emitted when a user claims vested tokens.
     * @param user The address of the user who claimed vested tokens.
     * @param amount The amount of vested tokens claimed.
     */
    event VestedTokensClaimed(address indexed user, uint256 amount);

    /**
     * @dev Emitted when tokens are transferred into the contract.
     * @param from The address transferring the tokens.
     * @param amount The amount of tokens transferred.
     */
    event TokensTransferredIn(address indexed from, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the staking contract with the given token, backend signer, and owner.
     * @param _stakingToken The address of the ERC20 token to be used for staking.
     * @param _backendSigner The address of the backend signer.
     * @param _owner The address of the owner.
     */
    function initialize(
        address _stakingToken,
        address _backendSigner,
        address _owner
    ) public initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __Pausable_init();

        stakingToken = IERC20(_stakingToken);
        backendSigner = _backendSigner;
        emit Initialized(_stakingToken);
    }

    /**
     * @dev Allows users to stake tokens for a specified lock period.
     * @param amount The amount of tokens to stake.
     * @param lockPeriod The lock period for the stake.
     */
    function stake(
        uint256 amount,
        uint256 lockPeriod
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Cannot stake 0 tokens");
        require(
            lockPeriod == THIRTY_DAYS ||
                lockPeriod == SIXTY_DAYS ||
                lockPeriod == NINETY_DAYS,
            "Invalid lock period"
        );
        totalStakedAmount += amount;
        uint256 amountPre = stakes[msg.sender][lockPeriod].amount;
        stakingToken.transferFrom(msg.sender, address(this), amount);

        stakes[msg.sender][lockPeriod] = StakeInfo({
            amount: amount + amountPre,
            startTime: block.timestamp,
            isActive: true
        });

        emit Staked(msg.sender, amount, lockPeriod);
    }

    /**
     * @dev Allows users to unstake their tokens after the lock period has ended.
     * @param lockPeriod The lock period of the stake to unstake.
     */
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
        totalStakedAmount -= stakeAmount;
        stakingToken.transfer(msg.sender, stakeAmount);

        emit Unstaked(msg.sender, stakeInfo.amount, lockPeriod);
    }

    /**
     * @dev Allows users to claim tokens using a signed message from the backend signer.
     * @param amount The amount of tokens to claim.
     * @param nonce The nonce for the claim to prevent replay attacks.
     * @param signature The signature from the backend signer.
     */
    function claim(
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(
            totalClaimableAmount >= amount,
            "Claimable amount insufficient"
        );
        require(nonce == nonces[msg.sender], "Invalid nonce");
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                msg.sender,
                amount,
                nonce,
                address(this),
                block.chainid
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address signer = ethSignedMessageHash.recover(signature);
        require(signer == backendSigner, "Invalid signature");
        require(
            amount <= stakingToken.balanceOf(address(this)),
            "Insufficient balance"
        );
        {
            uint256 vestedAmountPre = getVestedAmount(msg.sender);
            if (vestedAmountPre > 0) {
                _claimVestedTokens(vestedAmountPre);
            }
        }
        // Calculate the immediate and vested amounts
        uint256 immediateAmount = (amount * 20) / 100;
        uint256 vestedAmount = amount - immediateAmount;

        // Update the claimable amount and vesting amount
        totalClaimableAmount -= amount;
        totalVestingAmount += vestedAmount;

        // Update the vesting schedule for the user
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.remainingAmount += vestedAmount;
        schedule.originalTotalAmount = schedule.remainingAmount;
        schedule.startTime = block.timestamp;

        nonces[msg.sender] += 1;
        // Transfer the immediate amount to the user
        stakingToken.transfer(msg.sender, immediateAmount);

        emit Claimed(msg.sender, amount, nonce, schedule.remainingAmount);
    }

    /**
     * @dev Allows users to claim their vested tokens.
     */
    function claimVestedTokens() external nonReentrant whenNotPaused {
        uint256 vestedAmount = getVestedAmount(msg.sender);
        require(vestedAmount > 0, "No vested tokens available");
        _claimVestedTokens(vestedAmount);
    }

    /**
     * @dev Allows users to transfer staking tokens directly into the contract.
     * @param amount The amount of tokens to transfer.
     */
    function transferStakingTokenIn(
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Cannot transfer 0 tokens");

        totalClaimableAmount += amount;
        bool success = stakingToken.transferFrom(
            msg.sender,
            address(this),
            amount
        );
        require(success, "Token transfer failed");

        emit TokensTransferredIn(msg.sender, amount);
    }

    /**
     * @dev Pauses the contract, preventing staking and unstaking.
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses the contract, allowing staking and unstaking.
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Allows the owner to withdraw tokens from the contract in an emergency.
     * @param amount The amount of tokens to withdraw.
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        require(
            amount <= stakingToken.balanceOf(address(this)),
            "Insufficient balance"
        );
        stakingToken.transfer(owner(), amount);
    }

    /**
     * @dev Sets the backend signer address.
     * @param _backendSigner The address of the new backend signer.
     */
    function setBackendSigner(address _backendSigner) external onlyOwner {
        backendSigner = _backendSigner;
    }

    /**
     * @dev Returns the stake information for a user and lock period.
     * @param user The address of the user.
     * @param lockPeriod The lock period of the stake.
     * @return amount The amount staked.
     * @return startTime The start time of the stake.
     * @return isActive Whether the stake is active.
     * @return timeUntilUnlock The time remaining until the stake can be unlocked.
     */
    function getStakeInfo(
        address user,
        uint256 lockPeriod
    )
        external
        view
        returns (
            uint256 amount,
            uint256 startTime,
            bool isActive,
            uint256 timeUntilUnlock
        )
    {
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

    /**
     * @dev Returns all stakes for a user.
     * @param user The address of the user.
     * @return amounts The amounts staked for each lock period.
     * @return startTimes The start times for each lock period.
     * @return isActives Whether each stake is active.
     * @return timeUntilUnlocks The time remaining until each stake can be unlocked.
     */
    function getAllStakes(
        address user
    )
        external
        view
        returns (
            uint256[3] memory amounts,
            uint256[3] memory startTimes,
            bool[3] memory isActives,
            uint256[3] memory timeUntilUnlocks
        )
    {
        uint256[3] memory periods = [THIRTY_DAYS, SIXTY_DAYS, NINETY_DAYS];

        for (uint256 i = 0; i < 3; i++) {
            StakeInfo storage stakeInfo = stakes[user][periods[i]];
            amounts[i] = stakeInfo.amount;
            startTimes[i] = stakeInfo.startTime;
            isActives[i] = stakeInfo.isActive;

            if (
                !isActives[i] || block.timestamp >= startTimes[i] + periods[i]
            ) {
                timeUntilUnlocks[i] = 0;
            } else {
                timeUntilUnlocks[i] =
                    (startTimes[i] + periods[i]) -
                    block.timestamp;
            }
        }
    }

    /**
     * @dev Returns the vested amount for a user.
     * @param user The address of the user.
     * @return The amount of vested tokens available for the user.
     */
    function getVestedAmount(address user) public view returns (uint256) {
        VestingSchedule storage schedule = vestingSchedules[user];
        if (schedule.remainingAmount == 0) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - schedule.startTime;
        if (elapsedTime >= NINETY_DAYS) {
            return schedule.remainingAmount;
        }
        uint256 totalVested = (schedule.originalTotalAmount * elapsedTime) /
            NINETY_DAYS;
        uint256 alreadyReleased = schedule.originalTotalAmount -
            schedule.remainingAmount;

        return totalVested - alreadyReleased;
    }

    /**
     * @dev Internal function to claim vested tokens.
     * @param vestedAmount The amount of vested tokens to claim.
     */
    function _claimVestedTokens(uint256 vestedAmount) internal {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        schedule.remainingAmount -= vestedAmount;
        totalVestingAmount -= vestedAmount;

        stakingToken.transfer(msg.sender, vestedAmount);
        // Emit the event
        emit VestedTokensClaimed(msg.sender, vestedAmount);
    }

    // Gap for future upgrades
    uint256[50] private __gap;
}

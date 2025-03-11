// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "hardhat/console.sol";
contract MockTokenStaking is
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

    address public backendSigner; // Address of the backend signer for secure claims

    // Mapping from address to lock period to stake info
    mapping(address user => mapping(uint256 lockPeriod => StakeInfo stakeInfo))
        public stakes;

    mapping(address user => uint256 nonce) public nonces; // Nonce for each user to prevent replay attacks

    event Staked(address indexed user, uint256 amount, uint256 lockPeriod);
    event Unstaked(address indexed user, uint256 amount, uint256 lockPeriod);
    event Initialized(address stakingToken);

    // Modifier to restrict access to the backend signer
    modifier onlyBackendSigner() {
        require(
            msg.sender == backendSigner,
            "Caller is not the backend signer"
        );
        _;
    }

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
        stakingToken.transfer(msg.sender, stakeAmount);

        emit Unstaked(msg.sender, stakeInfo.amount, lockPeriod);
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
     * @dev Allows users to claim tokens using a signed message from the backend signer.
     * @param amount The amount of tokens to claim.
     * @param nonce The nonce for the claim to prevent replay attacks.
     * @param signature The signature from the backend signer.
     */
    function claim(
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
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
        nonces[msg.sender] += 1;
        stakingToken.transfer(msg.sender, amount);
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

    // Gap for future upgrades
    uint256[50] private __gap;
}

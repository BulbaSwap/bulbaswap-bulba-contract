import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { MockToken, BulbaStaking } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("BulbaStaking (Proxy)", function () {
  let mockToken: MockToken;
  let stakingProxy: BulbaStaking;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;

  const INITIAL_SUPPLY = ethers.parseEther("1000000");
  const STAKE_AMOUNT = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    // Deploy MockToken
    const MockTokenFactory = await ethers.getContractFactory("MockToken");
    mockToken = await MockTokenFactory.deploy("Mock Token", "MTK", INITIAL_SUPPLY);

    // Deploy Staking contract through proxy
    const BulbaStakingFactory = await ethers.getContractFactory("BulbaStaking");
    stakingProxy = await upgrades.deployProxy(BulbaStakingFactory, [await mockToken.getAddress(), owner.address, owner.address]) as BulbaStaking;
    await stakingProxy.waitForDeployment();

    // Transfer tokens and approve
    await mockToken.transfer(addr1.address, ethers.parseEther("10000"));
    await mockToken.transfer(addr2.address, ethers.parseEther("10000"));
    await mockToken.approve(await stakingProxy.getAddress(), INITIAL_SUPPLY);
    await mockToken.connect(addr1).approve(await stakingProxy.getAddress(), ethers.parseEther("10000"));
    await mockToken.connect(addr2).approve(await stakingProxy.getAddress(), ethers.parseEther("10000"));
  });

  describe("Proxy Setup", function () {
    it("Should initialize with correct values", async function () {
      expect(await stakingProxy.stakingToken()).to.equal(await mockToken.getAddress());
      expect(await stakingProxy.owner()).to.equal(owner.address);
    });

    it("Should not allow reinitialization", async function () {
      await expect(
        stakingProxy.initialize(await mockToken.getAddress(), owner.address, owner.address)
      ).to.be.reverted;
    });
  });

  describe("Staking Through Proxy", function () {
    it("Should allow staking with different lock periods", async function () {
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.SIXTY_DAYS());
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.NINETY_DAYS());

      const allStakes = await stakingProxy.getAllStakes(addr1.address);
      expect(allStakes.amounts[0]).to.equal(STAKE_AMOUNT);
      expect(allStakes.amounts[1]).to.equal(STAKE_AMOUNT);
      expect(allStakes.amounts[2]).to.equal(STAKE_AMOUNT);
      expect(allStakes.isActives[0]).to.be.true;
      expect(allStakes.isActives[1]).to.be.true;
      expect(allStakes.isActives[2]).to.be.true;
    });
  });

  describe("Unstaking Through Proxy", function () {
    it("Should allow unstaking after lock period", async function () {
      const lockPeriod = await stakingProxy.THIRTY_DAYS();
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      const initialBalance = await mockToken.balanceOf(addr1.address);

      await time.increase(30 * 24 * 60 * 60); // Advance 31 days

      await stakingProxy.connect(addr1).unstake(lockPeriod);

      const finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance - initialBalance).to.equal(STAKE_AMOUNT);
    });

    it("Should not allow unstaking before lock period", async function () {
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());

      await time.increase(25 * 24 * 60 * 60); // Advance 25 days

      await expect(
        stakingProxy.connect(addr1).unstake(await stakingProxy.THIRTY_DAYS())
      ).to.be.revertedWith("Lock period not ended");
    });
  });

  describe("Upgrades", function () {
    it("Should be able to upgrade implementation", async function () {
      const BulbaStakingV2 = await ethers.getContractFactory("BulbaStaking");
      await upgrades.upgradeProxy(await stakingProxy.getAddress(), BulbaStakingV2);

      // Verify functionality still works after upgrade
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      const allStakes = await stakingProxy.getAllStakes(addr1.address);
      expect(allStakes.amounts[0]).to.equal(STAKE_AMOUNT);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw", async function () {
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());

      const initialBalance = await mockToken.balanceOf(owner.address);
      await stakingProxy.emergencyWithdraw(STAKE_AMOUNT);
      const finalBalance = await mockToken.balanceOf(owner.address);

      expect(finalBalance - initialBalance).to.equal(STAKE_AMOUNT);
    });

    it("Should not allow non-owner to emergency withdraw", async function () {
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());

      await expect(
        stakingProxy.connect(addr1).emergencyWithdraw(STAKE_AMOUNT)
      ).to.be.reverted;
    });
  });

  describe("Claim Functionality", function () {
    it("Should allow users to claim tokens with a valid signature and vest the remaining amount", async function () {
      const claimAmount = ethers.parseEther("500");
      const nonce = await stakingProxy.nonces(addr1.address);

      // Construct the message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount, nonce, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      // Simulate staking to have balance in contract
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      const preBalance = await mockToken.balanceOf(addr1.address);

      // Claim tokens
      await stakingProxy.connect(addr1).claim(claimAmount, nonce, signature);

      // Verify immediate balance
      const immediateAmount = claimAmount * 20n / 100n;
      const finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(preBalance + immediateAmount);

      // Verify vesting schedule
      const vestingSchedule = await stakingProxy.vestingSchedules(addr1.address);
      const vestedAmount = claimAmount - immediateAmount;
      expect(vestingSchedule.remainingAmount).to.equal(vestedAmount);

      // Verify nonce increment
      const newNonce = await stakingProxy.nonces(addr1.address);
      expect(newNonce).to.equal(nonce + 1n);
    });

    it("Should allow users to claim vested tokens after the vesting period", async function () {
      const claimAmount = ethers.parseEther("500");
      const nonce = await stakingProxy.nonces(addr1.address);

      // Construct the message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount, nonce, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      // Simulate staking to have balance in contract
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      await stakingProxy.connect(addr1).claim(claimAmount, nonce, signature);

      // Advance time to allow vesting
      await time.increase(90 * 24 * 60 * 60); // Advance 90 days

      // Claim vested tokens
      const preBalance = await mockToken.balanceOf(addr1.address);
      await stakingProxy.connect(addr1).claimVestedTokens();
      const finalBalance = await mockToken.balanceOf(addr1.address);

      // Verify that the full vested amount is claimed
      const vestedAmount = claimAmount * 80n / 100n;
      expect(finalBalance).to.equal(preBalance + vestedAmount);
    });

    it("Should not allow claiming with an invalid signature", async function () {
      const claimAmount = ethers.parseEther("500");
      const nonce = await stakingProxy.nonces(addr1.address);

      // Construct the message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount, nonce, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );
      const invalidSignature = await addr1.signMessage(ethers.getBytes(messageHash));

      await expect(
        stakingProxy.connect(addr1).claim(claimAmount, nonce, invalidSignature)
      ).to.be.revertedWith("Invalid signature");
    });

    it("Should not allow claiming with an invalid nonce", async function () {
      const claimAmount = ethers.parseEther("500");
      const invalidNonce = 999; // Arbitrary invalid nonce
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount, invalidNonce, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      await expect(
        stakingProxy.connect(addr1).claim(claimAmount, invalidNonce, signature)
      ).to.be.revertedWith("Invalid nonce");
    });

    it("Should correctly update vesting schedule and balances when claim is called multiple times", async function () {
      const claimAmount1 = ethers.parseEther("500");
      const claimAmount2 = ethers.parseEther("300");
      const nonce1 = await stakingProxy.nonces(addr1.address);

      // Construct the message hash for the first claim
      const messageHash1 = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount1, nonce1, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature1 = await owner.signMessage(ethers.getBytes(messageHash1));

      // Simulate staking to have balance in contract
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      const preBalance = await mockToken.balanceOf(addr1.address);

      // First claim
      await stakingProxy.connect(addr1).claim(claimAmount1, nonce1, signature1);

      // Verify immediate balance after first claim
      const immediateAmount1 = claimAmount1 * 20n / 100n;
      let finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(preBalance + immediateAmount1);

      // Verify vesting schedule after first claim
      let vestingSchedule = await stakingProxy.vestingSchedules(addr1.address);
      const vestedAmount1 = claimAmount1 - immediateAmount1;
      expect(vestingSchedule.remainingAmount).to.equal(vestedAmount1);

      // Second claim
      const nonce2 = await stakingProxy.nonces(addr1.address);
      const messageHash2 = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount2, nonce2, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature2 = await owner.signMessage(ethers.getBytes(messageHash2));
      // Query the current block time
      let currentBlock = await ethers.provider.getBlock("latest");
      let currentTime = currentBlock?.timestamp ?? 0;
      const claimStartTime = vestingSchedule.startTime;
      // Stop block.time at this time
      const elapsedTime = BigInt(currentTime) - BigInt(claimStartTime) + BigInt(1);
      const claimVesAmount1 = (claimAmount1 - immediateAmount1) * BigInt(elapsedTime) / BigInt(await stakingProxy.NINETY_DAYS());
      await stakingProxy.connect(addr1).claim(claimAmount2, nonce2, signature2);

      // Verify immediate balance after second claim
      const immediateAmount2 = claimAmount2 * 20n / 100n;
      finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(preBalance + claimVesAmount1 + immediateAmount1 + immediateAmount2);

      // Verify vesting schedule after second claim
      const vestedAmount2 = claimAmount2 - immediateAmount2;
      vestingSchedule = await stakingProxy.vestingSchedules(addr1.address);
      expect(vestingSchedule.remainingAmount).to.equal(vestedAmount1 + vestedAmount2 - claimVesAmount1);
    });

    it("Should correctly handle multiple calls to claimVestedTokens", async function () {
      const claimAmount = ethers.parseEther("500");
      const nonce = await stakingProxy.nonces(addr1.address);

      // Construct the message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount, nonce, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      // Simulate staking to have balance in contract
      // await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.NINETY_DAYS());
      await mockToken.mint(await stakingProxy.getAddress(), STAKE_AMOUNT);
      let preBalance = await mockToken.balanceOf(addr1.address);
      await stakingProxy.connect(addr1).claim(claimAmount, nonce, signature);
      let immediateAmount = claimAmount * 20n / 100n;
      expect(await mockToken.balanceOf(addr1.address)).to.equal(preBalance + immediateAmount);

      // Advance time to allow partial vesting
      await time.increase(45 * 24 * 60 * 60); // Advance 45 days

      const vestingSchedule = await stakingProxy.vestingSchedules(addr1.address);
      const claimStartTime = vestingSchedule.startTime;
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = currentBlock?.timestamp ?? 0;
      // Stop block.time at this time
      const elapsedTime = BigInt(currentTime) - BigInt(claimStartTime) + BigInt(1);
      const totalVestedAmount = (claimAmount - immediateAmount) * BigInt(elapsedTime) / BigInt(await stakingProxy.NINETY_DAYS());
      // First claim of vested tokens
      preBalance = await mockToken.balanceOf(addr1.address);
      await stakingProxy.connect(addr1).claimVestedTokens();
      let finalBalance = await mockToken.balanceOf(addr1.address);
      // Verify that half of the vested amount is claimed
      expect(finalBalance).to.equal(preBalance + totalVestedAmount);

      // Advance time to allow full vesting
      await time.increase(45 * 24 * 60 * 60); // Advance another 45 days

      // Second claim of vested tokens
      preBalance = await mockToken.balanceOf(addr1.address);
      const remainingAmount = await stakingProxy.getVestedAmount(addr1.address);
      await stakingProxy.connect(addr1).claimVestedTokens();
      finalBalance = await mockToken.balanceOf(addr1.address);

      // Verify that the remaining vested amount is claimed
      expect(finalBalance).to.equal(preBalance + remainingAmount);
      expect(finalBalance).to.equal(ethers.parseEther("10000") + claimAmount);
    });

    it("Should correctly update vesting schedule and balances when claim and claimVestedTokens are called multiple times", async function () {
      const claimAmount1 = ethers.parseEther("500");
      const claimAmount2 = ethers.parseEther("300");
      const nonce1 = await stakingProxy.nonces(addr1.address);

      // Construct the message hash for the first claim
      const messageHash1 = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount1, nonce1, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature1 = await owner.signMessage(ethers.getBytes(messageHash1));

      // Simulate staking to have balance in contract
      await mockToken.mint(await stakingProxy.getAddress(), claimAmount1 + claimAmount2);
      const preBalance = await mockToken.balanceOf(addr1.address);

      // First claim
      await stakingProxy.connect(addr1).claim(claimAmount1, nonce1, signature1);
      // Check balance after first claim
      const balanceAfterClaim = await mockToken.balanceOf(addr1.address);
      const immediateAmount = claimAmount1 * 20n / 100n;
      expect(balanceAfterClaim).to.equal(preBalance + immediateAmount);

      // Advance time to allow partial vesting
      await time.increase(45 * 24 * 60 * 60); // Advance 45 days

      // Claim vested tokens
      await stakingProxy.connect(addr1).claimVestedTokens();
      // Second claim
      const nonce2 = await stakingProxy.nonces(addr1.address);
      const messageHash2 = ethers.solidityPackedKeccak256(
        ["address", "uint256", "uint256", "address", "uint256"],
        [addr1.address, claimAmount2, nonce2, await stakingProxy.getAddress(), (await ethers.provider.getNetwork()).chainId]
      );

      const signature2 = await owner.signMessage(ethers.getBytes(messageHash2));
      await stakingProxy.connect(addr1).claim(claimAmount2, nonce2, signature2);

      // Advance time to allow partial vesting
      await time.increase(45 * 24 * 60 * 60); // Advance another 45 days

      // Claim remaining vested tokens
      await stakingProxy.connect(addr1).claimVestedTokens();

      // Advance time to allow total vesting
      await time.increase(45 * 24 * 60 * 60); // Advance another 45 days

      // Claim remaining vested tokens
      await stakingProxy.connect(addr1).claimVestedTokens();

      // Verify final balance
      const finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(ethers.parseEther("10000") + claimAmount2 + claimAmount1);
    });
  });

  describe("Pausing Functionality", function () {
    it("Should allow the owner to pause and unpause the contract", async function () {
      await stakingProxy.connect(owner).pause();
      expect(await stakingProxy.paused()).to.be.true;

      await stakingProxy.connect(owner).unpause();
      expect(await stakingProxy.paused()).to.be.false;
    });

    it("Should not allow staking when paused", async function () {
      await stakingProxy.connect(owner).pause();

      await expect(
        stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS())
      ).to.be.revertedWithCustomError(stakingProxy, "EnforcedPause");
    });

    it("Should not allow unstaking when paused", async function () {
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, await stakingProxy.THIRTY_DAYS());
      await time.increase(31 * 24 * 60 * 60); // Advance 31 days

      await stakingProxy.connect(owner).pause();

      await expect(
        stakingProxy.connect(addr1).unstake(await stakingProxy.THIRTY_DAYS())
      ).to.be.revertedWithCustomError(stakingProxy, "EnforcedPause");
    });
  });

  describe("Staking Time Update", function () {
    it("Should update the start time to the latest time when staking again", async function () {
      const lockPeriod = await stakingProxy.THIRTY_DAYS();
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      // Capture the initial start time
      const initialStakeInfo = await stakingProxy.getStakeInfo(addr1.address, lockPeriod);
      const initialStartTime = initialStakeInfo.startTime;

      // Advance time and stake again
      await time.increase(5 * 24 * 60 * 60); // Advance 5 days

      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      // Capture the new start time
      const newStakeInfo = await stakingProxy.getStakeInfo(addr1.address, lockPeriod);
      const newStartTime = newStakeInfo.startTime;

      // Verify that the new start time is greater than the initial start time
      expect(newStartTime).to.be.greaterThan(initialStartTime);
    });
  });

  describe("Restaking Increases Amount", function () {
    it("Should increase the total staked amount when staking again", async function () {
      const lockPeriod = await stakingProxy.THIRTY_DAYS();
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      // Capture the initial staked amount
      const initialStakeInfo = await stakingProxy.getStakeInfo(addr1.address, lockPeriod);
      const initialAmount = initialStakeInfo.amount;

      // Stake again
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      // Capture the new staked amount
      const newStakeInfo = await stakingProxy.getStakeInfo(addr1.address, lockPeriod);
      const newAmount = newStakeInfo.amount;

      // Verify that the new amount is the sum of the initial amount and the staked amount
      expect(newAmount).to.equal(initialAmount + STAKE_AMOUNT);
    });
  });

  describe("Unstake Clears Stake Info", function () {
    it("Should clear the user's stake information after unstaking", async function () {
      const lockPeriod = await stakingProxy.THIRTY_DAYS();
      await stakingProxy.connect(addr1).stake(STAKE_AMOUNT, lockPeriod);

      // Advance time to allow unstaking
      await time.increase(31 * 24 * 60 * 60); // Advance 31 days

      // Unstake
      await stakingProxy.connect(addr1).unstake(lockPeriod);

      // Verify that the user's stake information is cleared
      const stakeInfo = await stakingProxy.getStakeInfo(addr1.address, lockPeriod);
      expect(stakeInfo.amount).to.equal(0);
      expect(stakeInfo.isActive).to.be.false;
    });
  });
}); 
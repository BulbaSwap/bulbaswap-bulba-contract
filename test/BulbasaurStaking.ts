import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { MockToken, BulbasaurStaking } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("BulbasaurStaking (Proxy)", function () {
  let mockToken: MockToken;
  let stakingProxy: BulbasaurStaking;
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
    const BulbasaurStakingFactory = await ethers.getContractFactory("BulbasaurStaking");
    stakingProxy = await upgrades.deployProxy(BulbasaurStakingFactory, [await mockToken.getAddress(), owner.address, owner.address]) as BulbasaurStaking;
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
      const BulbasaurStakingV2 = await ethers.getContractFactory("BulbasaurStaking");
      await upgrades.upgradeProxy(await stakingProxy.getAddress(), BulbasaurStakingV2);

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
    it("Should allow users to claim tokens with a valid signature", async function () {
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

      // Verify balance
      const finalBalance = await mockToken.balanceOf(addr1.address);
      expect(finalBalance).to.equal(preBalance + claimAmount);

      // Verify nonce increment
      const newNonce = await stakingProxy.nonces(addr1.address);
      expect(newNonce).to.equal(nonce + BigInt(1));
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
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MockToken", function () {
  let mockToken: MockToken;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;
  const TOKEN_NAME = "Mock Token";
  const TOKEN_SYMBOL = "MTK";
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1 million tokens

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    
    const MockToken = await ethers.getContractFactory("MockToken");
    mockToken = await MockToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY);
  });

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await mockToken.name()).to.equal(TOKEN_NAME);
      expect(await mockToken.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should assign the total supply of tokens to the owner", async function () {
      const ownerBalance = await mockToken.balanceOf(owner.address);
      expect(await mockToken.totalSupply()).to.equal(ownerBalance);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY);
    });
  });

  describe("Transactions", function () {
    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseEther("100");
      
      // Transfer from owner to addr1
      await mockToken.transfer(addr1.address, transferAmount);
      expect(await mockToken.balanceOf(addr1.address)).to.equal(transferAmount);

      // Transfer from addr1 to addr2
      await mockToken.connect(addr1).transfer(addr2.address, transferAmount);
      expect(await mockToken.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await mockToken.balanceOf(addr1.address)).to.equal(0);
    });

    it("Should fail if sender doesn't have enough tokens", async function () {
      const initialOwnerBalance = await mockToken.balanceOf(owner.address);
      await expect(
        mockToken.connect(addr1).transfer(owner.address, 1)
      ).to.be.revertedWithCustomError(mockToken, "ERC20InsufficientBalance");
      expect(await mockToken.balanceOf(owner.address)).to.equal(initialOwnerBalance);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      const initialSupply = await mockToken.totalSupply();
      
      await mockToken.mint(addr1.address, mintAmount);
      
      expect(await mockToken.balanceOf(addr1.address)).to.equal(mintAmount);
      expect(await mockToken.totalSupply()).to.equal(initialSupply + mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        mockToken.connect(addr1).mint(addr1.address, mintAmount)
      ).to.be.revertedWithCustomError(mockToken, "OwnableUnauthorizedAccount");
    });
  });
}); 
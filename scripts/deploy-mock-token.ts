import { ethers } from "hardhat";

async function main() {
  const TOKEN_NAME = "Bulba Token";
  const TOKEN_SYMBOL = "Bulba";
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1B tokens

  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY);

  await mockToken.waitForDeployment();
  const address = await mockToken.getAddress();

  console.log(`MockToken deployed to: ${address}`);
  console.log(`Token Name: ${TOKEN_NAME}`);
  console.log(`Token Symbol: ${TOKEN_SYMBOL}`);
  console.log(`Initial Supply: ${INITIAL_SUPPLY.toString()} (${ethers.formatEther(INITIAL_SUPPLY)} ${TOKEN_SYMBOL})`);

  // Verify the contract on Etherscan if not on a local network
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n && network.chainId !== 1337n) { // Skip verification on local networks
    console.log("Waiting for block confirmations...");
    await mockToken.deploymentTransaction()?.wait(5);

    const { run } = require("hardhat");
    await run("verify:verify", {
      address: address,
      constructorArguments: [TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY],
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

// Task to deploy MockToken with custom parameters
task("deploy-mock-token", "Deploys the MockToken contract")
  .addParam("name", "Token name", "Mock Token", undefined, true) // Optional parameter with default value
  .addParam("symbol", "Token symbol", "MTK", undefined, true) // Optional parameter with default value
  .addParam("supply", "Initial supply (in ether units)", "1000000", undefined, true) // Optional parameter with default value
  .setAction(async (taskArgs, hre) => {
    const { name, symbol, supply } = taskArgs;
    
    console.log("Deploying MockToken with parameters:");
    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Initial Supply: ${supply} tokens`);

    const MockToken = await hre.ethers.getContractFactory("MockToken");
    const mockToken = await MockToken.deploy(
      name,
      symbol,
      hre.ethers.parseEther(supply)
    );

    await mockToken.waitForDeployment();
    const address = await mockToken.getAddress();

    console.log(`MockToken deployed to: ${address}`);
    
    // Verify the contract on Etherscan if not on a local network
    const network = await hre.ethers.provider.getNetwork();
    if (network.chainId !== 31337n && network.chainId !== 1337n) {
      console.log("Waiting for block confirmations...");
      await mockToken.deploymentTransaction()?.wait(5);
      
      await hre.run("verify:verify", {
        address: address,
        constructorArguments: [name, symbol, hre.ethers.parseEther(supply)],
      });
    }
  });

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
    },
    // Add other network configurations here
  },
  // Add Etherscan API key for contract verification
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};

export default config;

import { ethers } from "hardhat";
import { TransparentUpgradeableProxy__factory, ProxyAdmin__factory } from "@openzeppelin/contracts";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy MockToken first
  const MockToken = await ethers.getContractFactory("MockToken");
  const mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
  await mockToken.waitForDeployment();
  console.log("MockToken deployed to:", await mockToken.getAddress());

  // Deploy implementation contract
  const BulbaStaking = await ethers.getContractFactory("BulbaStaking");
  const stakingImplementation = await BulbaStaking.deploy();
  await stakingImplementation.waitForDeployment();
  console.log("Staking Implementation deployed to:", await stakingImplementation.getAddress());

  // Deploy ProxyAdmin
  const ProxyAdmin = new ProxyAdmin__factory(deployer);
  const proxyAdmin = await ProxyAdmin.deploy();
  await proxyAdmin.waitForDeployment();
  console.log("ProxyAdmin deployed to:", await proxyAdmin.getAddress());

  // Prepare initialization data
  const initData = BulbaStaking.interface.encodeFunctionData("initialize", [
    await mockToken.getAddress()
  ]);

  // Deploy TransparentUpgradeableProxy
  const TransparentUpgradeableProxy = new TransparentUpgradeableProxy__factory(deployer);
  const proxy = await TransparentUpgradeableProxy.deploy(
    await stakingImplementation.getAddress(),
    await proxyAdmin.getAddress(),
    initData
  );
  await proxy.waitForDeployment();
  console.log("Proxy deployed to:", await proxy.getAddress());

  // Get proxy contract instance
  const stakingContract = BulbaStaking.attach(await proxy.getAddress());
  console.log("Staking contract (proxy) is ready at:", await stakingContract.getAddress());

  // Verify contracts on Etherscan
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 31337n && network.chainId !== 1337n) {
    console.log("Waiting for block confirmations...");
    await stakingImplementation.deploymentTransaction()?.wait(5);
    await proxyAdmin.deploymentTransaction()?.wait(5);
    await proxy.deploymentTransaction()?.wait(5);
    
    const { run } = require("hardhat");
    
    // Verify implementation
    await run("verify:verify", {
      address: await stakingImplementation.getAddress(),
      constructorArguments: []
    });

    // Verify ProxyAdmin
    await run("verify:verify", {
      address: await proxyAdmin.getAddress(),
      constructorArguments: []
    });

    // Verify Proxy
    await run("verify:verify", {
      address: await proxy.getAddress(),
      constructorArguments: [
        await stakingImplementation.getAddress(),
        await proxyAdmin.getAddress(),
        initData
      ]
    });
  }

  console.log("\nDeployment Summary:");
  console.log("-------------------");
  console.log("MockToken:", await mockToken.getAddress());
  console.log("Implementation:", await stakingImplementation.getAddress());
  console.log("ProxyAdmin:", await proxyAdmin.getAddress());
  console.log("Proxy:", await proxy.getAddress());
  console.log("\nTo interact with the contract, use the proxy address with the BulbaStaking ABI");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 
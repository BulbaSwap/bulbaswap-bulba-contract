import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-ignition";
import "@nomicfoundation/hardhat-ignition-ethers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
          viaIR: true,
        },
      },
    ],
  },
  paths: {
    tests: "./test",
    sources: "./contracts",
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
    },
    morph: {
      url: "https://rpc.morphl2.io",
      accounts: [
        process.env.PRIVATE_KEY || "",
        process.env.GLOBAL_SIGNER_PRIVATE_KEY || "",
      ].filter((key) => key !== ""),
      timeout: 60000,
      gasPrice: "auto",
    },
    morphHolesky: {
      url: "https://rpc-holesky.morphl2.io",
      accounts: [
        process.env.PRIVATE_KEY || "",
        process.env.GLOBAL_SIGNER_PRIVATE_KEY || "",
      ].filter((key) => key !== ""),
      timeout: 60000,
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      morph: "no-api-key-required",
      morphHolesky: "no-api-key-required",
    },
    customChains: [
      {
        network: "morph",
        chainId: 2818,
        urls: {
          apiURL: "https://explorer-api.morphl2.io/api",
          browserURL: "https://explorer.morphl2.io",
        },
      },
      {
        network: "morphHolesky",
        chainId: 2810,
        urls: {
          apiURL: "https://explorer-api-holesky.morphl2.io/api",
          browserURL: "https://explorer-holesky.morphl2.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 100000,
  },
  gasReporter: {
    enabled: true,
  },
};

export default config;

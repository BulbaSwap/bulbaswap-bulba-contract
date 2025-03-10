# Bulbaswap Bulbasaur Contract

This repository contains the smart contracts for the Bulbaswap ecosystem.

## Prerequisites

- Node.js (v16 or later)
- npm or yarn
- Hardhat

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/BulbaSwap/bulbaswap-bulbasaur-contract.git
   cd bulbaswap-bulbasaur-contract
   ```

2. Install the dependencies:
   ```bash
   npm install
   ```

## Compiling Contracts

To compile the smart contracts, run the following command:

```bash
npx hardhat compile
```

Ensure that your `hardhat.config.ts` is set up correctly with the appropriate Solidity version and any necessary plugins.

## Deploying Contracts

To deploy the contracts, you can use the Hardhat scripts provided. For example, to deploy the `MockTokenStaking` contract, run:

```bash
npx hardhat run scripts/deploy-mock-token-staking.ts --network <network-name>
```

Replace `<network-name>` with the desired network, such as `localhost`, `holesky`, or `mainnet`. Ensure that your Hardhat configuration includes the necessary network settings and that you have the appropriate credentials (e.g., private keys, Infura/Alchemy API keys) set up in your environment variables.
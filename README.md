# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```

Try deploy on Morph
```shell
npx hardhat ignition deploy ignition/modules/ProxyModule.ts --network morphHolesky --deployment-id morph-holesky-<index> --verify
# y
npx hardhat verify <proxy admin address> --network morphHolesky <owner address>
```
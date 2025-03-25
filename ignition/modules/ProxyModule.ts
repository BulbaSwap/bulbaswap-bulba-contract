import { buildModule } from '@nomicfoundation/hardhat-ignition/modules'
import hre from 'hardhat'
import * as dotenv from 'dotenv'

dotenv.config()

// const TOTAL_SUPPLY = BigInt(hre.ethers.parseUnits("1000000000", "ether"));
const TokenAddress =
  process.env.BULBA_TOKEN ?? '0x4f41C241E8b47Aac5Fa246BF61D4a0789FA7C3e2'
console.log('TokenAddress: ', TokenAddress)

/**
 * This is the first module that will be run. It deploys the proxy and the
 * proxy admin, and returns them so that they can be used by other modules.
 */
const proxyModule = buildModule('ProxyModule', (m) => {
  // This address is the owner of the ProxyAdmin contract,
  // so it will be the only account that can upgrade the proxy when needed.
  const proxyAdminOwner = m.getAccount(0)

  // const totalSupply = m.getParameter("totalSupply", TOTAL_SUPPLY);
  // const token = m.contract("MockToken", ["BulbaToken", "Bulba", totalSupply]);
  const token = m.getParameter('token', TokenAddress)

  // This is our contract that will be proxied.
  // We will upgrade this contract with a new version later.
  const staking = m.contract('BulbaStaking')
  const initData = m.encodeFunctionCall(staking, 'initialize', [
    TokenAddress,
    proxyAdminOwner,
    proxyAdminOwner,
  ])

  // The TransparentUpgradeableProxy contract creates the ProxyAdmin within its constructor.
  // To read more about how this proxy is implemented, you can view the source code and comments here:
  // https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.1/contracts/proxy/transparent/TransparentUpgradeableProxy.sol
  const proxy = m.contract('TransparentUpgradeableProxy', [
    staking,
    proxyAdminOwner,
    initData,
  ])

  // We need to get the address of the ProxyAdmin contract that was created by the TransparentUpgradeableProxy
  // so that we can use it to upgrade the proxy later.
  const proxyAdminAddress = m.readEventArgument(
    proxy,
    'AdminChanged',
    'newAdmin'
  )

  // Here we use m.contractAt(...) to create a contract instance for the ProxyAdmin that we can interact with later to upgrade the proxy.
  const proxyAdmin = m.contractAt('ProxyAdmin', proxyAdminAddress)

  // Return the proxy and proxy admin so that they can be used by other modules.
  return { proxyAdmin, proxy, token }
})

/**
 * This is the second module that will be run, and it is also the only module exported from this file.
 * It creates a contract instance for the Demo contract using the proxy from the previous module.
 */
const stakingModule = buildModule('StakingModule', (m) => {
  // Get the proxy and proxy admin from the previous module.
  const { proxy, proxyAdmin, token } = m.useModule(proxyModule)

  const staking = m.contractAt('BulbaStaking', proxy)

  // Return the contract instance, along with the original proxy and proxyAdmin contracts
  // so that they can be used by other modules, or in tests and scripts.
  return { staking, proxy, proxyAdmin, token }
})

module.exports = stakingModule

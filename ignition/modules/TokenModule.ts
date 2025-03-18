import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import hre from "hardhat";

const TOTAL_SUPPLY = BigInt(hre.ethers.parseUnits("1000000000", "ether"));

const tokenModule = buildModule("TokenModule", (m) => {
    const token = m.contract("MockToken", ["BulbaToken", "Bulba", TOTAL_SUPPLY]);
    return { token };
});

export default tokenModule;
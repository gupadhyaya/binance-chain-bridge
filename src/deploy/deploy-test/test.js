const { Harmony } = require("@harmony-js/core");
const { ChainType } = require("@harmony-js/utils");

const {
  HOME_RPC_URL,
  HOME_TOKEN_ADDRESS,
  CHAIN_ID,
  HOME_PRIVATE_KEY,
  GAS_PRICE,
  GAS_LIMIT,
  HOME_BRIDGE_ADDRESS,
} = process.env;

const hmy = new Harmony(HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
});

const contractJson = require("./build/contracts/ERC20Mintable.json");
let contract = hmy.contracts.createContract(
  contractJson.abi,
  HOME_TOKEN_ADDRESS
);
contract.wallet.addByPrivateKey(HOME_PRIVATE_KEY);

let options = {
  gasPrice: GAS_PRICE,
  gasLimit: GAS_LIMIT,
};

(async function () {
  let res = await contract.methods.balanceOf(HOME_BRIDGE_ADDRESS).call(options);
  console.log(`balanceOf ${HOME_BRIDGE_ADDRESS} ` + res.toString());
  res = await contract.methods.mint(HOME_BRIDGE_ADDRESS, 500).send(options);
  res = await contract.methods.balanceOf(HOME_BRIDGE_ADDRESS).call(options);
  console.log(`balanceOf ${HOME_BRIDGE_ADDRESS} ` + res.toString());
  process.exit(0);
})();

const { Harmony } = require("@harmony-js/core");
const { ChainType } = require("@harmony-js/utils");
const hmy = new Harmony(process.env.HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(process.env.CHAIN_ID),
});

const contractJson = require("./build/contracts/Bridge.json");
let contract = hmy.contracts.createContract(contractJson.abi);
contract.wallet.addByPrivateKey(process.env.HOME_PRIVATE_KEY);

let options = {
  gasPrice: process.env.GAS_PRICE,
  gasLimit: process.env.GAS_LIMIT,
};

const addresses = Object.entries(process.env)
  .filter(([key]) => key.startsWith("VALIDATOR_ADDRESS"))
  .map(([, value]) => value);

const {
  THRESHOLD,
  HOME_TOKEN_ADDRESS,
  MIN_TX_LIMIT,
  MAX_TX_LIMIT,
  BLOCKS_RANGE_SIZE,
  CLOSE_EPOCH_FLAG,
} = process.env;

let deploy_options = {
  data: contractJson.bytecode,
  arguments: [
    THRESHOLD,
    addresses,
    HOME_TOKEN_ADDRESS,
    [MIN_TX_LIMIT, MAX_TX_LIMIT],
    BLOCKS_RANGE_SIZE,
    CLOSE_EPOCH_FLAG === "true",
  ],
};

contract.methods
  .contractConstructor(deploy_options)
  .send(options)
  .then((response) => {
    if (response.transaction.txStatus == "REJECTED") {
      console.log("Reject");
      process.exit(0);
    }
    console.log(
      "contract deployed at " + response.transaction.receipt.contractAddress
    );
    process.exit(0);
  });

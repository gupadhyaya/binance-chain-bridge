const { Harmony } = require("@harmony-js/core");
const { ChainType } = require("@harmony-js/utils");

const {
  HOME_RPC_URL,
  HOME_TOKEN_ADDRESS,
  CHAIN_ID,
  GAS_PRICE,
  GAS_LIMIT,
} = process.env;

const hmy = new Harmony(HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
});

let options = {
  gasPrice: GAS_PRICE,
  gasLimit: GAS_LIMIT,
};

const tokenAbi = [
  {
    "constant": true,
    "inputs": [
      {
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "name": "",
        "type": "uint256"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
];

let token = hmy.contracts.createContract(tokenAbi, HOME_TOKEN_ADDRESS);

async function main() {
  const address = process.argv[2];

  try {
    const balance = await token.methods.balanceOf(address).call(options);
    console.log(`${balance.toString()} tokens`);
  } catch (e) {
    console.log("0 tokens");
  }
  process.exit(0);
}

main();

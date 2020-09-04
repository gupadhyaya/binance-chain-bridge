const { Harmony } = require("@harmony-js/core");
const { ChainType } = require("@harmony-js/utils");

const {
  HOME_RPC_URL,
  HOME_BRIDGE_ADDRESS,
  HOME_PRIVATE_KEY,
  HOME_TOKEN_ADDRESS,
  CHAIN_ID,
} = process.env;

const hmy = new Harmony(HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
});
hmy.wallet.addByPrivateKey(HOME_PRIVATE_KEY);
let options = {
  gasPrice: process.env.GAS_PRICE,
  gasLimit: process.env.GAS_LIMIT,
};

const tokenAbi = [
  {
    constant: false,
    inputs: [
      {
        name: "recipient",
        type: "address",
      },
      {
        name: "amount",
        type: "uint256",
      },
    ],
    name: "transfer",
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      {
        name: "spender",
        type: "address",
      },
      {
        name: "value",
        type: "uint256",
      },
    ],
    name: "approve",
    outputs: [
      {
        name: "",
        type: "bool",
      },
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
];
const bridgeAbi = [
  {
    constant: false,
    inputs: [
      {
        name: "value",
        type: "uint96",
      },
    ],
    name: "exchange",
    outputs: [],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
];

const token = hmy.contracts.createContract(tokenAbi, HOME_TOKEN_ADDRESS);
const bridge = hmy.contracts.createContract(bridgeAbi, HOME_BRIDGE_ADDRESS);

const sender = token.wallet.signer.address;
// console.log(token.wallet.signer.address);
// console.log(token.methods);
// console.log(bridge.methods);
async function main() {
  const to = process.argv[2];

  const amount = process.argv[3];
  // const native = process.argv[4];

  if (to === "bridge" && amount !== "0") {
    console.log(
      `Transfer from ${sender} to ${HOME_BRIDGE_ADDRESS}, ${amount} tokens`
    );

    let response = await token.methods
      .approve(HOME_BRIDGE_ADDRESS, amount)
      .send(options);
    console.log(
      `txHash token approve: ${response.transaction.receipt.transactionHash}`
    );

    response = await bridge.methods.exchange(amount).send(options);
    console.log(
      `txHash bridge exchange: ${response.transaction.receipt.transactionHash}`
    );
  } else if (amount !== "0") {
    console.log(`Transfer from ${sender} to ${to}, ${amount} tokens`);

    const tx = await token.methods.transfer(to, amount).send(options);
    console.log(`txHash transfer: ${tx.transaction.receipt.transactionHash}`);
  }

  // if (native) {
  //   console.log(`Transfer from ${sender} to ${to}, ${native} coins`);

  //   const tx = await hmy.wallet.sendTransaction({
  //     to,
  //     value: ethers.utils.parseEther(native),
  //   });

  //   const receipt = await tx.wait();
  //   console.log(`txHash: ${receipt.transactionHash}`);
  // }
  process.exit(0);
}

main();

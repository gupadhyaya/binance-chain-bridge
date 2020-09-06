const ethers = require('ethers')
const { Harmony } = require("@harmony-js/core");
const { ChainType, numberToHex, hexToNumber } = require("@harmony-js/utils");

const {
  HOME_PRIVATE_KEY,
  HOME_RPC_URL,
  HOME_BRIDGE_ADDRESS,
  HOME_WS_URL,
  SIDE_RPC_URL,
  SIDE_SHARED_DB_ADDRESS,
  HOME_START_BLOCK,
  CHAIN_ID,
  GAS_LIMIT,
  GAS_PRICE
} = process.env;
const SIDE_MAX_FETCH_RANGE_SIZE = parseInt(
  process.env.SIDE_MAX_FETCH_RANGE_SIZE,
  10
);

const bridgeAbi = [
  {
    "constant": false,
    "inputs": [
      {
        "name": "message",
        "type": "bytes"
      },
      {
        "name": "signatures",
        "type": "bytes"
      }
    ],
    "name": "applyMessage",
    "outputs": [],
    "payable": false,
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [
      {
        "name": "_epoch",
        "type": "uint16"
      }
    ],
    "name": "getThreshold",
    "outputs": [
      {
        "name": "",
        "type": "uint16"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [
      {
        "name": "_epoch",
        "type": "uint16"
      }
    ],
    "name": "getValidators",
    "outputs": [
      {
        "name": "",
        "type": "address[]"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
]
const sharedDbAbi = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "name": "msgHash",
        "type": "bytes32"
      }
    ],
    "name": "NewMessage",
    "type": "event"
  },
  {
    "constant": true,
    "inputs": [
      {
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "signedMessages",
    "outputs": [
      {
        "name": "message",
        "type": "bytes"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [
      {
        "name": "msgHash",
        "type": "bytes32"
      },
      {
        "name": "validators",
        "type": "address[]"
      }
    ],
    "name": "getSignatures",
    "outputs": [
      {
        "name": "",
        "type": "bytes"
      }
    ],
    "payable": false,
    "stateMutability": "view",
    "type": "function"
  }
]

const hmy = new Harmony(HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
})
const hmy_ws = new Harmony(HOME_WS_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
})
hmy.wallet.addByPrivateKey(HOME_PRIVATE_KEY);

let options = {
  gasPrice: GAS_PRICE,
  gasLimit: GAS_LIMIT,
}

const bridgeContract = hmy.contracts.createContract(bridgeAbi, HOME_BRIDGE_ADDRESS);
let bridge = bridgeContract.methods;
const sharedDbContract = hmy.contracts.createContract(sharedDbAbi, SIDE_SHARED_DB_ADDRESS);
const sharedDbContractWS = hmy_ws.contracts.createContract(sharedDbAbi, SIDE_SHARED_DB_ADDRESS);
let sharedDb = sharedDbContract.methods;
let nonce
let blockNumber = parseInt(HOME_START_BLOCK)

async function delay(ms) {
  await new Promise((res) => setTimeout(res, ms))
}

async function handleNewMessage(event) {
  const { msgHash } = event.values
  const message = await sharedDb.signedMessages(msgHash).call(options);
  console.log(`message: ${message}`);
  const epoch = parseInt(message.slice(4, 8), 16)
  console.log(`epoch: ${epoch}`)
  const [threshold, validators] = await Promise.all([
    bridge.getThreshold(epoch).call(options),
    bridge.getValidators(epoch).call(options)
  ])
  console.log(`validators: ${validators}`);
  while (true) {
    const signatures = await sharedDb
      .getSignatures(msgHash, validators)
      .call(options);
    if (signatures.length === 2) {
      console.log("Skipping event");
      break;
    }
    console.log(signatures);
    if ((signatures.length - 2) / 130 >= threshold) {
      console.log("Sending applyMessage request");
      
      options = { ...options, waitConfirm: false }; //nonce: numberToHex(nonce)
      // console.log(options);
      const response = await bridge.applyMessage(message, signatures).send(options);
      console.log(response);
      // console.log(`Used gas: ${response.transaction.receipt.gasUsed.toNumber()}`);
      nonce += 1;
      break;
    }
  }
}

async function initialize() {
  nonce = (
    await hmy.blockchain.getTransactionCount({
      address: bridgeContract.wallet.signer.address,
    })
  ).result;
  console.log(`nonce: ${nonce}`);
  // blockNumber = hexToNumber((await hmy.blockchain.getBlockNumber()).result);
}

function parseLog(ev) {
  let fragment = sharedDbContract.abiModel.getEvent(ev.topics[0]);
  if (!fragment || fragment.anonymous) {
    return null;
  }
  let log = sharedDbContract.abiCoder.decodeLog(
    fragment.inputs,
    ev.data == "0x" ? "" : ev.data,
    ev.topics.slice(1)
  );
  return {
    name: fragment.name,
    values: log,
  };
}

async function loop() {
  const latestBlockNumber = hexToNumber((await hmy.blockchain.getBlockNumber()).result)
  if (latestBlockNumber < blockNumber) {
    console.log(`No block after ${latestBlockNumber}`)
    return
  }

  const endBlock = Math.min(latestBlockNumber, blockNumber + SIDE_MAX_FETCH_RANGE_SIZE - 1)

  console.log(`Watching events in blocks #${blockNumber}-${endBlock}`)

  let bridgeEvents = (await hmy.messenger.send("hmy_getLogs", [{
    address: SIDE_SHARED_DB_ADDRESS,
    fromBlock: numberToHex(blockNumber),
    toBlock: numberToHex(endBlock),
    topics: sharedDbContractWS.events.NewMessage().options.topics
  }])).result

  if (bridgeEvents == undefined) {
    bridgeEvents = [];
  }

  for (let i = 0; i < bridgeEvents.length; i += 1) {
    const event = parseLog(bridgeEvents[i])
    console.log('Consumed event', event)
    await handleNewMessage(event)
  }

  blockNumber = endBlock + 1
}

async function main() {
  await initialize()

  while (true) {
    await delay(2000)
    try {
      await loop() 
    } catch (error) {
      console.log('err: ' + error);
    }
  }
}

main()

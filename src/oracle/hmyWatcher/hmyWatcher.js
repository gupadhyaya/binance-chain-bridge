const BN = require('bignumber.js')
const axios = require('axios')

const logger = require('./logger')
const redis = require('./db')
const { connectRabbit, assertQueue } = require('./amqp')
const { publicKeyToAddress } = require('./crypto')
const { delay, retry } = require('./wait')

const { Harmony } = require("@harmony-js/core");
const { ChainType, numberToHex, hexToNumber } = require("@harmony-js/utils");
const { recoverPublicKey, keccak256 } = require("@harmony-js/crypto")

const {
  HOME_RPC_URL,
  HOME_WS_URL,
  HOME_BRIDGE_ADDRESS,
  RABBITMQ_URL,
  HOME_START_BLOCK,
  VALIDATOR_PRIVATE_KEY,
  CHAIN_ID,
  GAS_LIMIT,
  GAS_PRICE,
} = process.env;
const HOME_MAX_FETCH_RANGE_SIZE = parseInt(process.env.HOME_MAX_FETCH_RANGE_SIZE, 10)

const hmy = new Harmony(HOME_RPC_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
})
const hmy_ws = new Harmony(HOME_WS_URL, {
  chainType: ChainType.Harmony,
  chainId: parseInt(CHAIN_ID),
})
hmy.wallet.addByPrivateKey(VALIDATOR_PRIVATE_KEY);

let options = {
  gasPrice: GAS_PRICE,
  gasLimit: GAS_LIMIT,
}

const bridgeAbi = [
  {
    "constant": true,
    "inputs": [
      {
        "name": "_epoch",
        "type": "uint16"
      }
    ],
    "name": "getParties",
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
    "name": "getRangeSize",
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
    "name": "getY",
    "outputs": [
      {
        "name": "",
        "type": "uint256"
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
    "name": "getX",
    "outputs": [
      {
        "name": "",
        "type": "uint256"
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
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "name": "value",
        "type": "uint96"
      },
      {
        "indexed": false,
        "name": "nonce",
        "type": "uint32"
      }
    ],
    "name": "ExchangeRequest",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "epoch",
        "type": "uint16"
      }
    ],
    "name": "EpochEnd",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "epoch",
        "type": "uint16"
      }
    ],
    "name": "EpochClose",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "ForceSign",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "oldEpoch",
        "type": "uint16"
      },
      {
        "indexed": true,
        "name": "newEpoch",
        "type": "uint16"
      }
    ],
    "name": "NewEpoch",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "epoch",
        "type": "uint16"
      }
    ],
    "name": "NewEpochCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "oldEpoch",
        "type": "uint16"
      },
      {
        "indexed": true,
        "name": "newEpoch",
        "type": "uint16"
      }
    ],
    "name": "NewFundsTransfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "name": "epoch",
        "type": "uint16"
      },
      {
        "indexed": false,
        "name": "x",
        "type": "uint256"
      },
      {
        "indexed": false,
        "name": "y",
        "type": "uint256"
      }
    ],
    "name": "EpochStart",
    "type": "event"
  }
]

const bridgeContract = hmy.contracts.createContract(bridgeAbi, HOME_BRIDGE_ADDRESS);
const bridgeContractWS = hmy_ws.contracts.createContract(bridgeAbi, HOME_BRIDGE_ADDRESS);
const validatorAddress = bridgeContract.wallet.signer.address;
const bridge = bridgeContract.methods;

const foreignNonce = []
let channel
let exchangeQueue
let signQueue
let keygenQueue
let cancelKeygenQueue
let epochTimeIntervalsQueue
let chainId
let blockNumber
let epoch
let epochStart
let redisTx
let rangeSize
let lastTransactionBlockNumber
let isCurrentValidator
let activeEpoch

async function getBlockTimestamp(n) {
  return hexToNumber((await hmy.blockchain.getBlockByNumber({
    blockNumber: numberToHex(n)
  })).result.timestamp)
}

async function resetFutureMessages(queue) {
  logger.debug(`Resetting future messages in queue ${queue.name}`)
  const { messageCount } = await channel.checkQueue(queue.name)
  if (messageCount) {
    logger.info(`Filtering ${messageCount} reloaded messages from queue ${queue.name}`)
    const backup = await assertQueue(channel, `${queue.name}.backup`)
    while (true) {
      const message = await queue.get()
      if (message === false) {
        break
      }
      const data = JSON.parse(message.content)
      if (data.blockNumber < blockNumber) {
        logger.debug('Saving message %o', data)
        backup.send(data)
      } else {
        logger.debug('Dropping message %o', data)
      }
      channel.ack(message)
    }

    logger.debug('Dropped messages came from future')

    while (true) {
      const message = await backup.get()
      if (message === false) {
        break
      }
      const data = JSON.parse(message.content)
      logger.debug('Requeuing message %o', data)
      queue.send(data)
      channel.ack(message)
    }

    logger.debug('Redirected messages back to initial queue')
  }
}

async function sendKeygen(event) {
  const { newEpoch } = event.values
  const [threshold, parties] = await Promise.all([
    bridge.getThreshold(newEpoch).call(options),
    bridge.getParties(newEpoch).call(options)
  ])
  keygenQueue.send({
    epoch: newEpoch,
    blockNumber,
    threshold,
    parties
  })
  logger.debug('Sent keygen start event')
}

function sendKeygenCancellation(event) {
  const eventEpoch = event.values.epoch
  cancelKeygenQueue.send({
    epoch: eventEpoch,
    blockNumber
  })
  logger.debug('Sent keygen cancellation event')
}

async function sendSignFundsTransfer(event) {
  const { newEpoch, oldEpoch } = event.values
  const [
    x, y, threshold, parties
  ] = await Promise.all([
    bridge.getX(newEpoch).call(options).then((value) => new BN(value).toString(16)),
    bridge.getY(newEpoch).call(options).then((value) => new BN(value).toString(16)),
    bridge.getThreshold(oldEpoch).call(options),
    bridge.getParties(oldEpoch).call(options)
  ])
  const recipient = publicKeyToAddress({
    x,
    y
  })
  signQueue.send({
    epoch: oldEpoch,
    blockNumber,
    newEpoch,
    nonce: foreignNonce[oldEpoch],
    recipient,
    threshold,
    parties
  })
  logger.debug('Sent sign funds transfer event')
  foreignNonce[oldEpoch] += 1
  redisTx.incr(`foreignNonce${oldEpoch}`)
}

async function sendSign(event, transactionHash) {
  const tx = (await hmy.blockchain.getTransactionByHash({
    txnHash: transactionHash,
  })).result;
  const txn = hmy.transactions.newTx({
    nonce: tx.nonce,
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    to: tx.to,
    data: tx.data,
    chainId
  });
  const [msg, raw] = txn.getRLPUnsigned()
  const hash = keccak256(msg)
  const publicKey = recoverPublicKey(hash, {
    r: tx.r,
    s: tx.s,
    v: tx.v
  })
  const msgToQueue = {
    epoch,
    blockNumber,
    recipient: publicKeyToAddress({
      x: publicKey.substr(4, 64),
      y: publicKey.substr(68, 64)
    }),
    value: (new BN(event.values.value)).dividedBy(10 ** 18).toFixed(8, 3),
    nonce: event.values.nonce
  }

  exchangeQueue.send(msgToQueue)
  logger.debug('Sent new sign event: %o', msgToQueue)

  lastTransactionBlockNumber = blockNumber
  redisTx.set('lastTransactionBlockNumber', blockNumber)
  logger.debug(`Set lastTransactionBlockNumber to ${blockNumber}`)
}

async function sendStartSign() {
  const [threshold, parties] = await Promise.all([
    bridge.getThreshold(epoch).call(options),
    bridge.getParties(epoch).call(options)
  ])
  signQueue.send({
    epoch,
    blockNumber,
    nonce: foreignNonce[epoch],
    threshold,
    parties
  })
  foreignNonce[epoch] += 1
  redisTx.incr(`foreignNonce${epoch}`)
}

async function processEpochStart(event) {
  epoch = event.values.epoch
  epochStart = blockNumber
  logger.info(`Epoch ${epoch} started`)
  rangeSize = await bridge.getRangeSize(epoch).call(options)
  isCurrentValidator = (await bridge.getValidators(epoch).call(options)).includes(validatorAddress)
  if (isCurrentValidator) {
    logger.info(`${validatorAddress} is a current validator`)
  } else {
    logger.info(`${validatorAddress} is not a current validator`)
  }
  logger.info(`Updated range size to ${rangeSize}`)
  foreignNonce[epoch] = 0
}

async function sendEpochClose() {
  logger.debug(`Consumed epoch ${epoch} close event`)
  const [threshold, parties] = await Promise.all([
    bridge.getThreshold(epoch).call(options),
    bridge.getParties(epoch).call(options)
  ])
  signQueue.send({
    closeEpoch: epoch,
    blockNumber,
    nonce: foreignNonce[epoch],
    threshold,
    parties
  })
  foreignNonce[epoch] += 1
  redisTx.incr(`foreignNonce${epoch}`)
}

async function initialize() {
  channel = await connectRabbit(RABBITMQ_URL)
  exchangeQueue = await assertQueue(channel, 'exchangeQueue')
  signQueue = await assertQueue(channel, 'signQueue')
  keygenQueue = await assertQueue(channel, 'keygenQueue')
  cancelKeygenQueue = await assertQueue(channel, 'cancelKeygenQueue')
  epochTimeIntervalsQueue = await assertQueue(channel, 'epochTimeIntervalsQueue')

  activeEpoch = !!(await redis.get('activeEpoch'))

  chainId = (await provider.getNetwork()).chainId

  const events = (await hmy.messenger.send("hmy_getLogs", [{
    address: HOME_BRIDGE_ADDRESS,
    fromBlock: 1,
    toBlock: 'latest',
    topics: bridgeContractWS.events.EpochStart().options.topics//bridge.filters.EpochStart().topics
  }])).result.map((log) => parseLog(log))

  epoch = events.length ? events[events.length - 1].values.epoch : 0
  logger.info(`Current epoch ${epoch}`)
  epochStart = events.length ? events[events.length - 1].blockNumber : 1
  const saved = (parseInt(await redis.get('homeBlock'), 10) + 1) || parseInt(HOME_START_BLOCK, 10)
  if (epochStart > saved) {
    logger.info(`Data in db is outdated, starting from epoch ${epoch}, block #${epochStart}`)
    blockNumber = epochStart
    await redis.multi()
      .set('homeBlock', blockNumber - 1)
      .set(`foreignNonce${epoch}`, 0)
      .exec()
    foreignNonce[epoch] = 0
  } else {
    logger.info('Restoring epoch and block number from local db')
    blockNumber = saved
    foreignNonce[epoch] = parseInt(await redis.get(`foreignNonce${epoch}`), 10) || 0
  }
  rangeSize = await bridge.getRangeSize(epoch).call(options)
  logger.debug(`Range size ${rangeSize}`)
  logger.debug('Checking if current validator')
  isCurrentValidator = (await bridge.getValidators(epoch).call(options)).includes(validatorAddress)
  if (isCurrentValidator) {
    logger.info(`${validatorAddress} is a current validator`)
  } else {
    logger.info(`${validatorAddress} is not a current validator`)
  }

  await resetFutureMessages(keygenQueue)
  await resetFutureMessages(cancelKeygenQueue)
  await resetFutureMessages(exchangeQueue)
  await resetFutureMessages(signQueue)
  await resetFutureMessages(epochTimeIntervalsQueue)
  logger.debug('Sending start commands')
  await axios.get('http://keygen:8001/start')
  await axios.get('http://signer:8001/start')
}

function parseLog(ev) {
  let fragment = bridgeContract.abiModel.getEvent(ev.topics[0]);
  if (!fragment || fragment.anonymous) {
    return null;
  }
  let log = contract.abiCoder.decodeLog(
    fragment.inputs,
    ev.data,
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
    logger.debug(`No block after ${latestBlockNumber}`)
    await delay(2000)
    return
  }

  const endBlock = Math.min(latestBlockNumber, blockNumber + HOME_MAX_FETCH_RANGE_SIZE - 1)

  redisTx = redis.multi()

  logger.debug(`Watching events in blocks #${blockNumber}-${endBlock}`)

  const bridgeEvents = (await hmy.messenger.send("hmy_getLogs", [{
    address: HOME_BRIDGE_ADDRESS,
    fromBlock: blockNumber,
    toBlock: endBlock,
    topics: []
  }])).result

  for (let curBlockNumber = blockNumber, i = 0; curBlockNumber <= endBlock; curBlockNumber += 1) {
    const rangeOffset = (curBlockNumber + 1 - epochStart) % rangeSize
    const rangeStart = curBlockNumber - (rangeOffset || rangeSize)
    let epochTimeUpdated = false
    while (i < bridgeEvents.length && bridgeEvents[i].blockNumber === curBlockNumber) {
      const event = parseLog(bridgeEvents[i])
      logger.trace('Consumed event %o %o', event, bridgeEvents[i])
      switch (event.name) {
        case 'NewEpoch':
          if ((await bridge.getValidators(event.values.newEpoch).call(options)).includes(validatorAddress)) {
            await sendKeygen(event)
          }
          break
        case 'NewEpochCancelled':
          if ((await bridge.getValidators(event.values.epoch).call(options)).includes(validatorAddress)) {
            sendKeygenCancellation(event)
          }
          break
        case 'NewFundsTransfer':
          if (isCurrentValidator) {
            await sendSignFundsTransfer(event)
          }
          break
        case 'ExchangeRequest':
          if (isCurrentValidator) {
            await sendSign(event, bridgeEvents[i].transactionHash)
          }
          break
        case 'EpochStart':
          await processEpochStart(event)
          await redis.set('activeEpoch', true)
          activeEpoch = true
          epochTimeIntervalsQueue.send({
            blockNumber: curBlockNumber,
            startTime: await retry(() => getBlockTimestamp(curBlockNumber)) * 1000,
            epoch
          })
          epochTimeUpdated = true
          break
        case 'EpochEnd':
          logger.debug(`Consumed epoch ${epoch} end event`)
          await redis.set('activeEpoch', false)
          activeEpoch = false
          epochTimeIntervalsQueue.send({
            blockNumber: curBlockNumber,
            prolongedTime: await retry(() => getBlockTimestamp(curBlockNumber)) * 1000,
            epoch
          })
          break
        case 'EpochClose':
          if (isCurrentValidator) {
            await sendEpochClose()
          }
          break
        case 'ForceSign':
          if (isCurrentValidator && lastTransactionBlockNumber > rangeStart) {
            logger.debug('Consumed force sign event')
            lastTransactionBlockNumber = 0
            redisTx.set('lastTransactionBlockNumber', 0)
            await sendStartSign()
          }
          break
        default:
          logger.warn('Unknown event %o', event)
      }
      i += 1
    }

    if (curBlockNumber === endBlock && !epochTimeUpdated && epoch > 0 && activeEpoch) {
      epochTimeIntervalsQueue.send({
        blockNumber: curBlockNumber,
        prolongedTime: await retry(() => getBlockTimestamp(curBlockNumber)) * 1000,
        epoch
      })
    }

    if (rangeOffset === 0) {
      logger.info('Reached end of the current block range')

      if (isCurrentValidator && lastTransactionBlockNumber > curBlockNumber - rangeSize) {
        logger.info('Sending message to start signature generation for the ended range')
        await sendStartSign()
      }
    }
  }

  blockNumber = endBlock + 1
  // Exec redis tx
  await redisTx.set('homeBlock', endBlock).exec()
  await redis.save()
}

async function main() {
  await initialize()

  while (true) {
    await loop()
  }
}

main()

// (async function () {
//   // const latestBlockNumber = hexToNumber(
//   //   (await hmy.blockchain.getBlockNumber()).result
//   // );
//   // console.log(latestBlockNumber);
//   // console.log(await getBlockTimestamp(latestBlockNumber));

//   // console.log(bridge);
//   // let res = await bridge.getValidators(0).call(options);
//   // console.log(res);

//   // const hmy_ws = new Harmony("wss://ws.s0.b.hmny.io", {
//   //   chainType: ChainType.Harmony,
//   //   chainId: parseInt(CHAIN_ID),
//   // });
//   // hmy_ws.blockchain
//   //   .logs({
//   //     address: "0x7C72f67D7a062f3ddce0224C47b9b3f35A80135f",
//   //     fromBlock: "0x139E1E",
//   //     endBlock: "0x139E20"
//   //   })
//   //   .on("data", (event) => {
//   //     console.log(event);
//   //   });

//   // const logs = (await hmy.messenger.send("hmy_getLogs", [
//   //   {
//   //     fromBlock: "0x13BE7B",
//   //     // toBlock: "latest",
//   //     address: "0x7C72f67D7a062f3ddce0224C47b9b3f35A80135f",
//   //   },
//   // ])).result;
//   // console.log(logs);

//   // let fragment = contract.abiModel.getEvent(ev.topics[0]);
//   // if (!fragment || fragment.anonymous) {
//   //   return null;
//   // }
//   // let log = contract.abiCoder.decodeLog(
//   //   fragment.inputs,
//   //   ev.data,
//   //   ev.topics.slice(1)
//   // );
//   // let event = {
//   //   name: fragment.name,
//   //   values: log,
//   // };

//   // const hmy_ws = new Harmony("wss://ws.s0.b.hmny.io", {
//   //   chainType: ChainType.Harmony,
//   //   chainId: ChainID.HmyTestnet
//   // });
//   // const contract = hmy_ws.contracts.createContract(contractJson.abi, contractAddr, options);
//   // console.log(contract.events.IncrementedBy().options);

//   // const tx = (await hmy.blockchain.getTransactionByHash({
//   //   txnHash: '0xd5f05b34727c0383020b454522d896016b67af9f2dec01c9397423ad22c5659f',
//   // })).result;
//   // console.log(tx);
//   // const txn = hmy.transactions.newTx({
//   //   nonce: tx.nonce,
//   //   gasPrice: tx.gasPrice,
//   //   gasLimit: tx.gasLimit,
//   //   to: tx.to,
//   //   data: tx.data,
//   //   chainId
//   // });
//   // const [msg, raw] = txn.getRLPUnsigned()
//   // console.log(msg);
//   // const hash = ethers.utils.keccak256(msg)
//   // const publicKey = recoverPublicKey(hash, {
//   //   r: tx.r,
//   //   s: tx.s,
//   //   v: tx.v
//   // })
//   // console.log(publicKey);

// })();

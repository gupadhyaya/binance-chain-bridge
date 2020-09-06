const axios = require('axios')
const BN = require('bignumber.js')

const logger = require('./logger')
const { delay, retry } = require('./wait')
const { Messenger, HttpProvider } = require('@harmony-js/network')
const { ChainType, numberToHex, hexToNumber } = require('@harmony-js/utils')
const { TransactionFactory } = require('@harmony-js/transaction');
const { Wallet } = require('@harmony-js/account');
const { getAddress } = require('@harmony-js/crypto');

const { GAS_LIMIT_FACTOR, MAX_GAS_LIMIT } = process.env

async function sendRpcRequest(url, method, params) {
  logger.trace(`Request to ${url}, method ${method}, params %o`, params)
  const response = await retry(() => axios.post(url, {
    jsonrpc: '2.0',
    method,
    params,
    id: 1
  }))
  logger.trace('Response %o', response.data)
  return response.data
}

async function createSender(blockchain, url, chainId, privateKey) {
  const wallet = new Wallet(
    new Messenger(
      new HttpProvider(url),
      ChainType.Harmony,
      chainId
    )
  );
  wallet.addByPrivateKey(privateKey);
  
  return async function send(tx) {
    let txParams = {
      data: tx.data,
      to: tx.to,
      nonce: numberToHex(tx.nonce),
      chainId: `0x${new BN(chainId || 0).toString(16)}`,
      value: `0x${new BN(tx.value || 0).toString(16)}`,
      gasPrice: `0x${new BN(tx.gasPrice || 1000000000).toString(16)}`
    }
    try {
      logger.trace(`Preparing and sending transaction %o on ${url}`, txParams)
      // const estimate = await sendRpcRequest(url, 'hmy_estimateGas', [{
      //   from: wallet.address,
      //   to: txParams.to,
      //   data: txParams.data,
      //   gasPrice: txParams.gasPrice,
      //   value: txParams.value,
      //   gas: `0x${new BN(MAX_GAS_LIMIT).toString(16)}`
      // }])

      // if (estimate.error) {
      //   logger.debug('Gas estimate failed %o, skipping tx, reverting nonce', estimate.error)
      //   return true
      // }
      // const gasLimit = BN.min(
      //   new BN(estimate.result, 16).multipliedBy(GAS_LIMIT_FACTOR),
      //   MAX_GAS_LIMIT
      // )
      txParams.gasLimit = `0x${new BN(MAX_GAS_LIMIT).toString(16)}`
      // logger.trace(`Estimated gas to ${gasLimit}`)
      
      const factory = new TransactionFactory(wallet.messenger);
      txParams.to = getAddress(txParams.to).checksum;
      // txParams.nonce = (await blockchain.getTransactionCount({
      //   address: wallet.signer.address
      // })).result
      
      let tx = factory.newTx(txParams)
      
      let signedTx = await wallet.signTransaction(
        tx,
        undefined,
        undefined,
        false,
        "rlp",
        "latest"
      );

      const { result, error } = await sendRpcRequest(url, 'hmy_sendRawTransaction', [signedTx.rawTransaction])

      // handle nonce error
      // handle insufficient funds error
      if (error) {
        logger.debug("Sending signed tx %o failed, %o", tx, error);
        var count;
        for (count = 0; count < 10; count++) {
          let price = parseInt(hexToNumber(txParams.gasPrice));
          txParams.gasPrice = numberToHex(price + price);
          let newNounce = parseInt(hexToNumber(txParams.nonce));
          txParams.nonce = numberToHex(newNounce + 1);
          // console.log(txParams);
          tx = factory.newTx(txParams);
          // console.log("got new transaction");
          signedTx = await wallet.signTransaction(tx);
          // console.log("signed new transaction");
          const resp = await sendRpcRequest(url, "hmy_sendRawTransaction", [
            signedTx.rawTransaction,
          ]);
          // console.log(resp);
          if (resp.error) {
            logger.debug(
              "Sending signed tx %o failed again, %o",
              tx,
              resp.error
            );
            continue;
          }
          return {
            txHash: resp.result,
            gasLimit: txParams.gasLimit,
          };
        }
        console.log('didnt succeed after 10 atempts');
        return false;
      }

      return {
        txHash: result,
        gasLimit: txParams.gasLimit
      }
    } catch (e) {
      logger.warn('Something failed, %o', e)
      return false
    }
  }
}

async function waitForReceipt(blockchain, txHash) {
  while (true) {
    const receipt = (await blockchain.getTransactionByHash({
      txnHash: txHash,
    })).result;

    if (receipt) {
      return receipt
    }

    await delay(1000)
  }
}

module.exports = {
  createSender,
  waitForReceipt
}

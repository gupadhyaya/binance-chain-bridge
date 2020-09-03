const { TruffleProvider } = require('@harmony-js/core')

const { HOME_RPC_URL, HOME_PRIVATE_KEY } = process.env
const { HOME_MNEMONIC, CHAIN_ID, GAS_LIMIT, GAS_PRICE } = process.env
console.log(HOME_RPC_URL);
module.exports = {
  networks: {
    home: {
      provider: () => {
        const truffleProvider = new TruffleProvider(
          HOME_RPC_URL,
          { memonic: HOME_MNEMONIC },
          { shardID: 0, chainId: CHAIN_ID },
          { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE},
        );
        const newAcc = truffleProvider.addByPrivateKey(HOME_PRIVATE_KEY);
        truffleProvider.setSigner(newAcc);
        return truffleProvider;
      },
      network_id: CHAIN_ID
    },
  },
  compilers: {
    solc: {
      version: '0.5.9',
      settings: {
        optimizer: {
          enabled: true,
          runs: 3
        }
      }
    }
  }
}

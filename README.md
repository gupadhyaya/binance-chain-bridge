## Harmony to Binance Chain bridge

This repository contains a proof-of-concept for HRC20-to-BEP2 bridge. The project itself is forked from [eth-to-bnc-bridge](https://github.com/poanetwork/eth-to-bnc-bridge) and adopted to Harmony chain.

The original thread discussing the bridge proposal can be found: 
https://forum.poa.network/t/ethereum-to-binance-chain-bridge/2696

The bridge is able to transfer an HRC20 tokens on harmony chain to BEP2 to the Binance Chain and vice versa.

It includes the following components:
1. The bridge contract on harmony chain that is responsible to receive and release HRC20 tokens 
2. The orchestration contract on harmony chain that participate in MPC (multy-party computations) to generate a threshold signature.
3. The oracle that monitors the chains and the send transactions. One oracle represents one bridge validator (one private key).

The idea of the bridge is similar to [eth-to-bnc-bridge](https://github.com/poanetwork/eth-to-bnc-bridge) produced by [POA.Network](https://poa.network/):
- every oracle sends its confirmation as soon as a user sends the token relay request in one chain.
- when enough confirmations collected the requested amount of tokens is unlocked in another chain.

Collecting confirmations for the Binance Chain is made in form of mutlisig wallet - the validator's confirmation is participation in the transaction signature gneration with usage of Threshold Signature Scheme (TSS) implemented for ECDSA by [KZen Research team](https://github.com/KZen-networks/multi-party-ecdsa).

At this version the tool for TSS is used as is. It is assumed that later part of TSS orchestration will be moved to the orchestration contract. So far, the orchestration contract is used as a database to keep data required by TSS parties during the signature generation.

Read [an instruction how to run a demo](DEMO.md) for the bridge.

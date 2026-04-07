import { SorobanRpc, Networks } from '@stellar/stellar-sdk';
import config from '../config.js';

let _server = null;

export function getStellarServer() {
  if (!_server) {
    _server = new SorobanRpc.Server(config.stellar.rpcUrl, {
      allowHttp: config.stellar.rpcUrl.startsWith('http://'),
    });
  }
  return _server;
}

export function getNetworkPassphrase() {
  if (config.stellar.network === 'mainnet') {
    return Networks.PUBLIC;
  }
  return Networks.TESTNET;
}

export function getUSDCContractId() {
  return config.stellar.usdcContractId;
}

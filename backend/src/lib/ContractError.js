export class ContractError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

export function handleContractError(err, res, defaultMessage, defaultCode) {
  if (err instanceof ContractError) {
    let status = 400;
    if (err.code === 'TRANSACTION_TIMEOUT') {
      status = 504;
    }
    if (err.code === 'RPC_THROTTLED') {
      status = 503;
    }
    return res.status(status).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: defaultMessage, code: defaultCode });
}

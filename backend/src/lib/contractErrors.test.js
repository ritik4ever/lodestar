import { describe, expect, it } from 'vitest';

import {
  REGISTRY_ERROR_CODES,
  extractRegistryErrorCode,
  registryErrorFromCode,
  registryErrorFromHostError,
} from './contractErrors.js';

describe('registry contract error mapping', () => {
  it('documents every registry contract error code', () => {
    expect(Object.keys(REGISTRY_ERROR_CODES).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('maps numeric registry codes to API ContractError objects', () => {
    expect(registryErrorFromCode(3)).toMatchObject({
      name: 'ContractError',
      code: 'DUPLICATE_SERVICE',
      message: 'Active service with same provider and endpoint already exists',
      registryErrorCode: 3,
    });
  });

  it('extracts registry codes from structured RPC payloads', () => {
    expect(extractRegistryErrorCode({ errorResult: { contractCode: 7 } })).toBe(7);
    expect(extractRegistryErrorCode({ diagnosticEvents: [{ errorCode: 8 }] })).toBe(8);
  });

  it('extracts registry codes from Soroban contract error strings without matching messages', () => {
    expect(extractRegistryErrorCode('HostError: Error(Contract, #4)')).toBe(4);
    expect(extractRegistryErrorCode('transaction failed with ContractError(6)')).toBe(6);
  });

  it('ignores unknown numeric codes', () => {
    expect(extractRegistryErrorCode({ contractCode: 999 })).toBeNull();
    expect(registryErrorFromHostError({ contractCode: 999 })).toBeNull();
  });
});

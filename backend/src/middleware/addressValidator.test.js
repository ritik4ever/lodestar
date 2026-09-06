import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import logger from '../lib/logger.js';
import {
  isValidStellarAddress,
  validateAgentAddressParam,
} from './addressValidator.js';

const VALID_ADDRESS_1 = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA';
const VALID_ADDRESS_2 = 'GBZXN7PIRZGNMHGA72W2A5H7B2F6V465TX4J7Q6W2V65Z62V65Z62V65';
const VALID_ALL_A = 'G' + 'A'.repeat(55);
const VALID_ALL_Z = 'G' + 'Z'.repeat(55);
const VALID_ALL_2 = 'G' + '2'.repeat(55);
const VALID_ALL_7 = 'G' + '7'.repeat(55);

describe('addressValidator middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('isValidStellarAddress', () => {
    describe('success paths', () => {
      it('returns true for valid standard 56-char base32 Stellar addresses', () => {
        expect(isValidStellarAddress(VALID_ADDRESS_1)).toBe(true);
        expect(isValidStellarAddress(VALID_ADDRESS_2)).toBe(true);
      });

      it('returns true for boundary valid alphabet combinations', () => {
        expect(isValidStellarAddress(VALID_ALL_A)).toBe(true);
        expect(isValidStellarAddress(VALID_ALL_Z)).toBe(true);
        expect(isValidStellarAddress(VALID_ALL_2)).toBe(true);
        expect(isValidStellarAddress(VALID_ALL_7)).toBe(true);
      });
    });

    describe('failure paths and boundary inputs', () => {
      describe('length boundaries', () => {
        it('returns false for 55 characters (1 short of required length)', () => {
          const shortAddr = 'G' + 'A'.repeat(54);
          expect(shortAddr.length).toBe(55);
          expect(isValidStellarAddress(shortAddr)).toBe(false);
        });

        it('returns false for 57 characters (1 long beyond required length)', () => {
          const longAddr = 'G' + 'A'.repeat(56);
          expect(longAddr.length).toBe(57);
          expect(isValidStellarAddress(longAddr)).toBe(false);
        });

        it('returns false for single character "G"', () => {
          expect(isValidStellarAddress('G')).toBe(false);
        });

        it('returns false for empty string', () => {
          expect(isValidStellarAddress('')).toBe(false);
        });
      });

      describe('prefix validation', () => {
        it('returns false when starting with Secret key prefix "S"', () => {
          const secretKey = 'S' + 'A'.repeat(55);
          expect(isValidStellarAddress(secretKey)).toBe(false);
        });

        it('returns false when starting with Contract prefix "C"', () => {
          const contractId = 'C' + 'A'.repeat(55);
          expect(isValidStellarAddress(contractId)).toBe(false);
        });

        it('returns false when starting with Muxed account prefix "M"', () => {
          const muxedAccount = 'M' + 'A'.repeat(55);
          expect(isValidStellarAddress(muxedAccount)).toBe(false);
        });

        it('returns false when starting with lowercase "g"', () => {
          const lowerG = 'g' + 'A'.repeat(55);
          expect(isValidStellarAddress(lowerG)).toBe(false);
        });
      });

      describe('character set boundaries (Base32 vs non-Base32)', () => {
        it('returns false for invalid Base32 digits (0, 1, 8, 9)', () => {
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '0')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '1')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '8')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '9')).toBe(false);
        });

        it('returns false for lowercase characters', () => {
          expect(isValidStellarAddress(VALID_ADDRESS_1.toLowerCase())).toBe(false);
          expect(isValidStellarAddress('G' + 'a'.repeat(55))).toBe(false);
          expect(isValidStellarAddress('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVaAA')).toBe(false);
        });

        it('returns false for special characters and punctuation', () => {
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '!')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '-')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '_')).toBe(false);
          expect(isValidStellarAddress('G' + 'A'.repeat(54) + '.')).toBe(false);
        });

        it('returns false for whitespace or padded strings', () => {
          expect(isValidStellarAddress(` ${VALID_ADDRESS_1}`)).toBe(false);
          expect(isValidStellarAddress(`${VALID_ADDRESS_1} `)).toBe(false);
          expect(isValidStellarAddress(`\n${VALID_ADDRESS_1}`)).toBe(false);
          expect(isValidStellarAddress(`${VALID_ADDRESS_1}\n`)).toBe(false);
          expect(isValidStellarAddress('   ')).toBe(false);
        });
      });

      describe('non-string data types', () => {
        it('returns false for null and undefined', () => {
          expect(isValidStellarAddress(null)).toBe(false);
          expect(isValidStellarAddress(undefined)).toBe(false);
        });

        it('returns false for numeric values', () => {
          expect(isValidStellarAddress(1234567890)).toBe(false);
          expect(isValidStellarAddress(0)).toBe(false);
          expect(isValidStellarAddress(NaN)).toBe(false);
          expect(isValidStellarAddress(Infinity)).toBe(false);
        });

        it('returns false for objects and arrays', () => {
          expect(isValidStellarAddress({})).toBe(false);
          expect(isValidStellarAddress({ address: VALID_ADDRESS_1 })).toBe(false);
          expect(isValidStellarAddress([])).toBe(false);
          expect(isValidStellarAddress([VALID_ADDRESS_1])).toBe(false);
        });

        it('returns false for boolean, symbol, and function types', () => {
          expect(isValidStellarAddress(true)).toBe(false);
          expect(isValidStellarAddress(false)).toBe(false);
          expect(isValidStellarAddress(Symbol('G...'))).toBe(false);
          expect(isValidStellarAddress(() => VALID_ADDRESS_1)).toBe(false);
        });
      });
    });
  });

  describe('validateAgentAddressParam middleware function', () => {
    function createMockRes() {
      const res = {
        statusCode: 200,
        body: null,
      };
      res.status = vi.fn().mockImplementation((code) => {
        res.statusCode = code;
        return res;
      });
      res.json = vi.fn().mockImplementation((data) => {
        res.body = data;
        return res;
      });
      return res;
    }

    describe('success path', () => {
      it('calls next() when req.params.address is a valid Stellar address', () => {
        const req = { params: { address: VALID_ADDRESS_1 } };
        const res = createMockRes();
        const next = vi.fn();
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

        validateAgentAddressParam(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    describe('failure paths', () => {
      it('returns 400 and logs warning when address is invalid', () => {
        const req = { params: { address: 'invalid-address' } };
        const res = createMockRes();
        const next = vi.fn();
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

        validateAgentAddressParam(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid Stellar address format',
          code: 'INVALID_ADDRESS',
        });
        expect(next).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
          { address: 'invalid-address' },
          'Invalid agent address parameter',
        );
      });

      it('returns 400 when address has 55 chars', () => {
        const req = { params: { address: 'G' + 'A'.repeat(54) } };
        const res = createMockRes();
        const next = vi.fn();

        validateAgentAddressParam(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid Stellar address format',
          code: 'INVALID_ADDRESS',
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('returns 400 when address is missing or empty', () => {
        const req = { params: {} };
        const res = createMockRes();
        const next = vi.fn();

        validateAgentAddressParam(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid Stellar address format',
          code: 'INVALID_ADDRESS',
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('returns 400 when req.params is undefined', () => {
        const req = {};
        const res = createMockRes();
        const next = vi.fn();

        validateAgentAddressParam(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid Stellar address format',
          code: 'INVALID_ADDRESS',
        });
        expect(next).not.toHaveBeenCalled();
      });

      it('returns 400 when req is undefined', () => {
        const res = createMockRes();
        const next = vi.fn();

        validateAgentAddressParam(undefined, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid Stellar address format',
          code: 'INVALID_ADDRESS',
        });
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('error propagation', () => {
      it('propagates unexpected error to next(err) when an error is thrown', () => {
        const unexpectedError = new Error('Unexpected logger failure');
        const req = { params: { address: 'invalid-address' } };
        const res = createMockRes();
        const next = vi.fn();

        vi.spyOn(logger, 'warn').mockImplementation(() => {
          throw unexpectedError;
        });
        const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

        validateAgentAddressParam(req, res, next);

        expect(errorSpy).toHaveBeenCalledWith(
          { err: unexpectedError },
          'Address validation error',
        );
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(unexpectedError);
      });

      it('throws error directly if next is not a function and an unexpected error occurs', () => {
        const unexpectedError = new Error('Logger failure without next');
        const req = { params: { address: 'invalid-address' } };
        const res = createMockRes();

        vi.spyOn(logger, 'warn').mockImplementation(() => {
          throw unexpectedError;
        });
        vi.spyOn(logger, 'error').mockImplementation(() => {});

        expect(() => validateAgentAddressParam(req, res, null)).toThrow(unexpectedError);
      });
    });
  });

  describe('Express HTTP integration', () => {
    function createApp() {
      const app = express();
      app.use(express.json());

      app.get('/api/agents/:address', validateAgentAddressParam, (req, res) => {
        res.json({
          ok: true,
          address: req.params.address,
        });
      });

      // Error handler
      app.use((err, _req, res, _next) => {
        res.status(500).json({ error: err.message });
      });

      return app;
    }

    it('allows valid requests through to handler with 200 OK', async () => {
      const response = await request(createApp()).get(`/api/agents/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        address: VALID_ADDRESS_1,
      });
    });

    it('rejects invalid address with 400 Bad Request', async () => {
      const response = await request(createApp()).get('/api/agents/not-a-valid-address');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid Stellar address format',
        code: 'INVALID_ADDRESS',
      });
    });

    it('rejects contract address with 400 Bad Request', async () => {
      const contractId = 'C' + 'A'.repeat(55);
      const response = await request(createApp()).get(`/api/agents/${contractId}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid Stellar address format',
        code: 'INVALID_ADDRESS',
      });
    });

    it('rejects secret key with 400 Bad Request', async () => {
      const secretKey = 'S' + 'A'.repeat(55);
      const response = await request(createApp()).get(`/api/agents/${secretKey}`);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'Invalid Stellar address format',
        code: 'INVALID_ADDRESS',
      });
    });
  });
});

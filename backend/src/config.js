import 'dotenv/config';

const required = [
  'CONTRACT_ID',
  'SERVER_STELLAR_ADDRESS',
  'SERVER_STELLAR_SECRET',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'FACILITATOR_URL',
  'USDC_CONTRACT_ID',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    rpcUrl: process.env.STELLAR_RPC_URL,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
    usdcContractId: process.env.USDC_CONTRACT_ID,
  },

  contract: {
    id: process.env.CONTRACT_ID,
    agentsId: process.env.AGENTS_CONTRACT_ID ?? null,
  },

  server: {
    address: process.env.SERVER_STELLAR_ADDRESS,
    secret: process.env.SERVER_STELLAR_SECRET,
  },

  x402: {
    facilitatorUrl: process.env.FACILITATOR_URL,
    searchPrice: process.env.SEARCH_PRICE ?? '0.001',
    weatherPrice: process.env.WEATHER_PRICE ?? '0.001',
  },

  braveApiKey: process.env.BRAVE_API_KEY ?? '',

  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
});

export default config;

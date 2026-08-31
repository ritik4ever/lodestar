/** @type {import('next').NextConfig} */
const bundleBudget = require('./bundle-budget.json');

const nextConfig = {
  reactStrictMode: true,
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      const maxBudgetBytes = Math.max(...Object.values(bundleBudget.routes));
      const limit = Math.max(maxBudgetBytes * (1 + bundleBudget.marginPercent), 256 * 1024);

      config.performance = {
        ...config.performance,
        maxAssetSize: limit,
        maxEntrypointSize: limit,
      };
    }

    return config;
  },
};

module.exports = nextConfig;

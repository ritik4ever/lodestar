const withBundleAnalyzer = require('@next/bundle-analyzer')({
  // Generates .next/analyze/client.html and server.html when ANALYZE=true
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withBundleAnalyzer(nextConfig);

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/waitlist',
        destination: process.env.NEXT_PUBLIC_API_BASE
          ? `${process.env.NEXT_PUBLIC_API_BASE}/api/waitlist`
          : 'http://localhost:3001/api/waitlist'
      }
    ];
  }
};

module.exports = nextConfig;

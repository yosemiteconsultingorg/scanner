export default {
  // Ensure the app builds properly on Vercel
  output: 'standalone',
  
  // Use the correct Vercel edge runtime
  experimental: {
    appDir: true,
    serverComponentsExternalPackages: [],
  },
  
  // Adjust API route handling
  rewrites: async () => {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
    ];
  },

  // Configure allowed image domains for Next.js Image optimization
  images: {
    domains: ['*.blob.core.windows.net'],
  },
};

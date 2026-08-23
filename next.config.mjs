/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // REQUIREMENTS names the tab "Activity"; the route is /activities
      // (DESIGN §6). Keep deep links working (tester finding m-4).
      { source: "/activity", destination: "/activities", permanent: true },
    ];
  },
};

export default nextConfig;

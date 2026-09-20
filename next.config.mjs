/** @type {import('next').NextConfig} */
const nextConfig = {
  // docs/COACH.md is read from disk at generation time (lib/coachBrief.ts);
  // make sure it ships inside every API route bundle.
  outputFileTracingIncludes: {
    "/api/**/*": ["./docs/COACH.md"],
  },
  async redirects() {
    return [
      // REQUIREMENTS names the tab "Activity"; the route is /activities
      // (DESIGN §6). Keep deep links working (tester finding m-4).
      { source: "/activity", destination: "/activities", permanent: true },
    ];
  },
};

export default nextConfig;

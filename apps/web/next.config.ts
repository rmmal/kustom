import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not a build artefact.
  // @customs/lcu is deliberately absent: the web app must never import the League client bridge.
  transpilePackages: ['@customs/core', '@customs/db'],
  typedRoutes: true,
  // Next writes its own AGENTS.md/CLAUDE.md into apps/web otherwise. This repo's agent
  // instructions live in the root CLAUDE.md and docs/; we do not want a second, generated set.
  agentRules: false,
};

export default nextConfig;

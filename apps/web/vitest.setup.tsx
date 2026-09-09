import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Setup for the `dom` project only (`vitest.config.ts`): jest-dom's matchers and one unmount
 * between tests, so a component that subscribes to something cannot leak into the next file.
 *
 * The file is `.tsx` because React's JSX runtime has to be the one the components are compiled
 * against; nothing else belongs in here.
 */
afterEach(() => {
  cleanup();
});

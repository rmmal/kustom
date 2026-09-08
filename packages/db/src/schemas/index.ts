/**
 * Every boundary in this project is validated with zod, and the API, the companion and the
 * bot all import the schema from here so there is exactly one definition per payload.
 */

export * from './common.js';
export * from './companion.js';

// @jat12/shared barrel. Import from here (or the fine-grained subpaths in package.json exports).
export * from './constants.js';
export * from './norm.js';
export { default as STATUS } from './contracts/status.json' with { type: 'json' };

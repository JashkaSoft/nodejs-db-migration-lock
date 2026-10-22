const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.join(__dirname, '..'),
  roots: ['<rootDir>/tests/e2e'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
  ],
  moduleNameMapper: {
    '^@nodejs-db-migration-lock/core$': '<rootDir>/../core/src',
  },
  testTimeout: 30000,
  verbose: true,
};

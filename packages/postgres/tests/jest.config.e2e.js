module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
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
  testTimeout: 30000, // 30 seconds for E2E tests
  verbose: true,
  bail: true, // Stop on first failure
};


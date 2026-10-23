const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: path.join(__dirname, '..'),
  roots: ['<rootDir>/tests/unit'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@nodejs-db-migration-lock/core$': '<rootDir>/../core/src',
  },
};

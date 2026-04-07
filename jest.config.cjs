module.exports = {
  projects: [
    // Frontend (TypeScript, jsdom)
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': 'ts-jest' },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    // Backend (CJS, node)
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/backend/**/*.test.cjs'],
    },
  ],
};

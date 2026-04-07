module.exports = {
  projects: [
    // Frontend (TypeScript, jsdom)
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': 'ts-jest' },
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
      setupFiles: ['<rootDir>/src/test-setup.ts'],
    },
    // Backend (CJS, node)
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/backend/**/*.test.cjs'],
    },
  ],
};

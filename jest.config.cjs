module.exports = {
  projects: [
    // Frontend (TypeScript, jsdom)
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
      transform: { '^.+\\.tsx?$': 'ts-jest' },
      moduleNameMapper: {
        // `config/api` reads import.meta.env, which Jest cannot parse — swap in
        // a plain stub with the same exports. Must precede the '@/' rule so an
        // aliased import of the config resolves here too.
        '^.*/config/api$': '<rootDir>/src/config/api.jest.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
      },
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

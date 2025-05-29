module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"], 
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  // Revert to Jest's default transformIgnorePatterns.
  transformIgnorePatterns: [
    "/node_modules/",
    "\\.pnp\\.[^\\/]+$"
  ],
  // Default transform for ts-jest is usually sufficient for .ts/.tsx files.
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^file-type$': '<rootDir>/__mocks__/file-type.js',
    '^ansi-styles$': '<rootDir>/__mocks__/ansi-styles.js',
    '^chalk$': '<rootDir>/__mocks__/chalk.js',
    // Add other problematic ESM modules here if they arise
  },
};

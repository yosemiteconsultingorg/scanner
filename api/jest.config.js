module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  clearMocks: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  // Default transformIgnorePatterns, Jest will ignore node_modules for transformations.
  // We will rely on direct mocks for problematic ESM packages like file-type, ansi-styles, chalk.
  transformIgnorePatterns: [
    "/node_modules/",
    "\\.pnp\\.[^\\/]+$"
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest', // Only transform our TS/TSX files
  },
};

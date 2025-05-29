// api/__mocks__/chalk.js
// Basic mock for chalk. It often relies on ansi-styles.
// This mock returns a function that just returns the input string,
// effectively disabling coloring but preventing errors.
const chalk = (str) => str;
chalk.red = (str) => str;
chalk.yellow = (str) => str;
chalk.green = (str) => str;
chalk.blue = (str) => str;
chalk.bold = (str) => str;
chalk.italic = (str) => str;
// Add any other chalk properties/methods if they are directly used and cause errors.
// For example, if chalk.level is accessed:
chalk.level = 0; 

module.exports = chalk;

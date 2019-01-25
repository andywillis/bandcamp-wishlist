const init = require('./main');

const [,, ...args] = process.argv;

if (args.length) {
  init(args);
} else {
  init();
}

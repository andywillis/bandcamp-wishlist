const init = require('./main');

const [,, ...args] = process.argv;

(async () => {
  try {
    if (args.length) {
      await init(args);
    } else {
      await init();
    }  
  } catch (e) {
    console.log(e);
  }
})();

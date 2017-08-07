'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.report = exports.patch = undefined;

var _vow = require('vow');

var _vow2 = _interopRequireDefault(_vow);

var _wrapFn = require('wrap-fn');

var _wrapFn2 = _interopRequireDefault(_wrapFn);

var _debug = require('debug');

var _debug2 = _interopRequireDefault(_debug);

var _path = require('path');

var _fs = require('fs');

var _lodash = require('lodash.transform');

var _lodash2 = _interopRequireDefault(_lodash);

var _lodash3 = require('lodash.set');

var _lodash4 = _interopRequireDefault(_lodash3);

var _stripAnsi = require('strip-ansi');

var _stripAnsi2 = _interopRequireDefault(_stripAnsi);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// used for debug messages
const dbg = (0, _debug2.default)('metalsmith-debug-ui');

// stores cloned data & log until written to client
const data = {
  log: [],
  plugins: []

  // whether client html, styles & js has already been written to build dir
};let clientWritten = false;

// whether metalsmith instance has been patched
let isPatched = false;

// whether we output plugin performance to stdout
let perfOut = false;

// whether we're in an error state
let pluginError = false;

/**
 * ## log
 * this log fn is stashed on metalsmith instance to allow other plugins to
 * write to this debug ui.
 * @param ...args accepts parameters in the same way `debug.log` does
 */
function log(...args) {
  let clean = _util2.default.format.apply(_util2.default, args.map(_stripAnsi2.default));
  let entry = /^\s*([^\s]*)\s(.*)\s([^\s]*)$/.exec(clean);
  data.log.push({
    timestamp: new Date().toISOString().slice(11, -1),
    plugin: entry ? entry[1] : '',
    message: entry ? entry[2] : clean, // fallback failed regex
    elapsed: entry ? entry[3] : ''
  });
  // write to console as normal, breaks a lot of debug configuration but w/e
  process.stdout.write(_util2.default.format.apply(_util2.default, args) + '\n');
}

// hook `debug.log`
_debug2.default.log = log;

/**
 * ## patch
 * patches `metalsmith.build`, when `build` is called it will wrap all plugins
 * with reporter.
 * ```
 * let metalsmith = new Metalsmith(__dirname)
 * patch(metalsmith)
 * ```
 * @param {object} metalsmith instance
 */
function patch(metalsmith, options) {
  dbg('patched build fn');
  metalsmith._maskedBuild = metalsmith.build;
  metalsmith.build = build;
  metalsmith.log = log;
  isPatched = true;
  perfOut = options.perf;
  dbg('perfOut', perfOut);
  return metalsmith;
}

/**
 * ## report
 * to be called as a metalsmith plugin clones current state of files & metadata
 * @param {String} name
 * @returns {Promise}
 */
function report(name) {
  return (files, metalsmith) => {
    pushData(files, metalsmith, name);
    // if build is not patched we do this each time data is updated
    if (!isPatched) writeData(files, metalsmith);
    return writeClient(files, metalsmith); // promise
  };
}

/**
 * ## build
 * masks metalsmith's build fn. Once patched, calling build will wrap all
 * plugins with the debug-ui recorder, before calling the original build fn.
 *
 * @param ...args same args as metalsmith build
 */
function build(callback) {
  dbg('build called');
  const masked = [];
  this.plugins.forEach(fn => {
    masked.push((files, metalsmith) => {
      // if error state, no point running more plugins
      if (pluginError) return _vow2.default.resolve();
      return _vow2.default.resolve().then(() => {
        // return vow.Promise((resolve, reject) => {
        //   let wrapped = wrap(fn, (err) => {
        //     if (err) return reject()
        //     resolve()
        //   })
        //   wrapped(files, metalsmith)
        // })
        let defer = _vow2.default.defer();
        // wrap here to support sync, async, and promises.. like metalsmith
        // this also traps exceptions

        if (perfOut) console.time(require('crypto').createHash('md5').update(fn.toString()).digest('hex'));

        let wrapped = (0, _wrapFn2.default)(fn, err => {
          if (err) defer.reject(err);else defer.resolve();
          if (perfOut) {
            console.timeEnd(require('crypto').createHash('md5').update(fn.toString()).digest('hex'));
            var stack = new Error().stack.split('\n').filter(line => !line.match('metalsmith-debug-ui'));
            // console.log('stack', stack)
            var [_, _, name = null] = stack[1].match(/^(\s)*at.*\/(metalsmith-[^\/]*)/) || stack[2].match(/^(\s)*at.*\/(metalsmith-[^\/]*)/) || [];
            console.log(name);
          }
        });
        wrapped(files, metalsmith);
        return defer.promise();
      }).then(() => report(fn.name)(files, metalsmith)).catch(err => {
        pluginError = true;
        throw err;
        // dbg('caught plugin error', err)
      });
    });
  });
  masked.push((files, metalsmith) => {
    // if build is patched we do this once at the end (here)
    return writeData(files, metalsmith);
  });
  this.plugins = masked;
  // run metalsmith's original build
  this._maskedBuild(callback);
}

/**
 * ## pushData
 * clones current files & meta into store
 * @param {Object} files metalsmith files structure
 * @param {Metalsmith} metalsmith instance
 * @param {String} name descriptor for ui, usually plugin fn name
 */
function pushData(files, metalsmith, name) {
  data.plugins.push({
    // use fn.name to give user some idea where we're up to
    // name of bound function is 'bound functionName'
    fnName: (name || 'anonymous').replace(/bound /, ''),
    // convert files structure to directory tree
    files: tree(render(files)),
    // normal metalsmith metadata
    metadata: render(metalsmith.metadata())
  });
}

/**
 * ## injectData
 * writes `data.json` to metalsmith files structure
 * @param {Object} files metalsmith files structure
 */
function writeData(files, metalsmith) {
  dbg('writing data to build');
  let defer = _vow2.default.defer();
  let dataJson = {
    'debug-ui/data.json': {
      contents: Buffer.from(JSON.stringify(data))
    }
    // write the history data, no need for async
  };metalsmith.write(dataJson, defer.resolve.bind(defer));
  return defer.promise();
}

/**
 * ## writeClient
 * writes html, styles, and js to build dir
 * @param {Object} files metalsmith files structure
 * @param {Metalsmith} metalsmith
 * @returns {Promise}
 */
function writeClient(files, metalsmith) {
  if (clientWritten) return _vow2.default.resolve();
  clientWritten = true;
  const defer = _vow2.default.defer();
  // scrape the client dir and inject into files
  (0, _fs.readdir)((0, _path.join)(__dirname, 'client'), (err, children) => {
    if (err) throw new Error(err);
    const workers = [];
    const client = [];
    children.forEach(child => {
      dbg((0, _path.join)(__dirname, 'client', child));

      let worker = readFilePromise((0, _path.join)(__dirname, 'client', child)).then(contents => {
        dbg((0, _path.join)('debug-ui', child));
        client[(0, _path.join)('debug-ui', child)] = { contents };
      });
      workers.push(worker);
    });
    _vow2.default.all(workers).then(() => {
      metalsmith.write(client, defer.resolve.bind(defer));
    }).catch(defer.reject.bind(defer));
  });
  return defer.promise();
}

/**
 * ## readFilePromise
 * promisify readFile
 * @param {String} path
 * @returns {Promise<Buffer>}
 */
function readFilePromise(path) {
  const defer = _vow2.default.defer();
  (0, _fs.readFile)(path, (err, contents) => {
    if (err) return defer.reject(err);
    defer.resolve(contents);
  });
  return defer.promise();
}

/**
 * ## tree fn
 * convert files structure to directory tree
 *
 * @param {object} files metalsmith files structure
 */
function tree(files) {
  return (0, _lodash2.default)(files, function (result, val, key) {
    let path = (0, _path.parse)(key);
    if (path.dir) {
      (0, _lodash4.default)(result, path.dir.split(_path.sep).concat(path.base), val);
    } else {
      (0, _lodash4.default)(result, path.base, val);
    }
  }, {});
}

/**
 * ## render
 * Really rad fn to parse an object, convert values to something renderable,
 * and avoid multiple copies of the same object (recursion, cyclic references,
* or just copies)
 *
 * @param {object} obj target, files or metadata
 */
function render(obj) {
  // use copy so we don't mutate files
  let copy = {};
  // store seen objects so we can avoid re-printing them
  let list = [obj];
  // store paths so we can assign converted values to the right path
  let paths = [['root']];
  for (let idx = 0; idx < list.length; idx++) {
    let item = list[idx];
    Object.keys(item).forEach(key => {
      // store path of current item
      let path = paths[idx].concat([key]);
      if (key === 'contents') {
        return (0, _lodash4.default)(copy, path, '...');
      }
      if (Buffer.isBuffer(item[key])) {
        return (0, _lodash4.default)(copy, path, item[key].toString());
      }
      // check if this item has been rendered already
      let copyIdx = list.indexOf(item[key]);
      if (~copyIdx) {
        return (0, _lodash4.default)(copy, path, `[Copy: ${paths[copyIdx].join(' > ')}]`);
      }
      // store objects so we can assess them next loop
      if (item[key] instanceof Object) {
        list.push(item[key]);
        paths.push(path);
        return;
      }
      // if none ofthe above apply, just stash the value
      (0, _lodash4.default)(copy, path, item[key]);
    });
  }
  return copy.root;
}

/**
 * ## exports
 */
exports.default = { patch, report };
exports.patch = patch;
exports.report = report;
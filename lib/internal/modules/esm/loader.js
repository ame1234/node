'use strict';

const {
  FunctionPrototypeBind,
  ObjectSetPrototypeOf,
  SafeMap,
} = primordials;

const {
  threadId
} = internalBinding('worker');

const {
  ERR_INVALID_RETURN_PROPERTY,
  ERR_INVALID_RETURN_PROPERTY_VALUE,
  ERR_INVALID_RETURN_VALUE,
  ERR_UNKNOWN_MODULE_FORMAT
} = require('internal/errors').codes;
const { URL, pathToFileURL } = require('internal/url');
const { validateString } = require('internal/validators');
const ModuleMap = require('internal/modules/esm/module_map');
const ModuleJob = require('internal/modules/esm/module_job');

const { defaultResolve } = require('internal/modules/esm/resolve');
const { defaultGetFormat } = require('internal/modules/esm/get_format');
const { defaultGetSource } = require('internal/modules/esm/get_source');
const { defaultTransformSource } = require(
  'internal/modules/esm/transform_source');
const { translators } = require(
  'internal/modules/esm/translators');
const { getOptionValue } = require('internal/options');

const debug = require('internal/util/debuglog').debuglog('esm');

const defaultLoaderWorker = {
  resolveImportURL({ specifier, base }) {
    return defaultResolve(specifier, { parentURL: base });
  },

  getFormat({ url }) {
    return defaultGetFormat(url);
  },

  getSource({ url, format }) {
    return defaultGetSource(url, { format });
  },

  transformSource({ source, url, format }) {
    return defaultTransformSource(source, { url, format });
  },
};

/* A Loader instance is used as the main entry point for loading ES modules.
 * Currently, this is a singleton -- there is only one used for loading
 * the main module and everything in its dependency graph. */
class Loader {
  constructor() {
    // Methods which translate input code or other information
    // into es modules
    this.translators = translators;

    // Registry of loaded modules, akin to `require.cache`
    this.moduleMap = new ModuleMap();

    // Map of already-loaded CJS modules to use
    this.cjsCache = new SafeMap();

    // The index for assigning unique URLs to anonymous module evaluation
    this.evalIndex = 0;
  }

  _getSource(params) {
    const bottomLoaderRPC = exports.getBottomLoaderRPC();
    return bottomLoaderRPC.getSource(params);
  }

  _transformSource(params) {
    const bottomLoaderRPC = exports.getBottomLoaderRPC();
    return bottomLoaderRPC.transformSource(params);
  }

  async resolve(specifier, parentURL) {
    const isMain = parentURL === undefined;
    if (!isMain)
      validateString(parentURL, 'parentURL');
    validateString(specifier, 'specifier');

    const bottomLoaderRPC = exports.getBottomLoaderRPC();
    const resolveResponse = await bottomLoaderRPC.resolveImportURL({
      clientId: threadId,
      specifier,
      base: parentURL
    });

    if (typeof resolveResponse !== 'object') {
      throw new ERR_INVALID_RETURN_VALUE(
        'object', 'loader resolve', resolveResponse);
    }

    const { url } = resolveResponse;
    if (typeof url !== 'string') {
      throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
        'string', 'loader resolve', 'url', url);
    }

    const getFormatResponse =
      await bottomLoaderRPC.getFormat({
        clientId: threadId,
        url,
      });
    if (typeof getFormatResponse !== 'object') {
      throw new ERR_INVALID_RETURN_VALUE(
        'object', 'loader getFormat', getFormatResponse);
    }

    const { format } = getFormatResponse;
    if (typeof format !== 'string') {
      throw new ERR_INVALID_RETURN_PROPERTY_VALUE(
        'string', 'loader getFormat', 'format', format);
    }

    if (format === 'builtin') {
      return { url: `node:${url}`, format };
    }

    if (bottomLoaderRPC !== defaultLoaderWorker) {
      try {
        new URL(url);
      } catch {
        throw new ERR_INVALID_RETURN_PROPERTY(
          'url', 'loader resolve', 'url', url
        );
      }
    }

    if (
      !url.startsWith('file:') &&
      !url.startsWith('data:')
    ) {
      throw new ERR_INVALID_RETURN_PROPERTY(
        'file: or data: url', 'loader resolve', 'url', url
      );
    }

    return { url, format };
  }

  async eval(
    source,
    url = pathToFileURL(`${process.cwd()}/[eval${++this.evalIndex}]`).href
  ) {
    const evalInstance = (url) => {
      const { ModuleWrap, callbackMap } = internalBinding('module_wrap');
      const module = new ModuleWrap(url, undefined, source, 0, 0);
      callbackMap.set(module, {
        importModuleDynamically: (specifier, { url }) => {
          return this.import(specifier, url);
        }
      });

      return module;
    };
    const job = new ModuleJob(this, url, evalInstance, false, false);
    this.moduleMap.set(url, job);
    const { module, result } = await job.run();
    return {
      namespace: module.getNamespace(),
      result
    };
  }

  async import(specifier, parent) {
    const job = await this.getModuleJob(specifier, parent);
    const { module } = await job.run();
    return module.getNamespace();
  }

  // Use this to avoid .then() exports being returned
  async importWrapped(specifier, parent) {
    const job = await this.getModuleJob(specifier, parent);
    const { module } = await job.run();
    return { namespace: module.getNamespace() };
  }

  async getModuleJob(specifier, parentURL) {
    const { url, format } = await this.resolve(specifier, parentURL);
    let job = this.moduleMap.get(url);
    // CommonJS will set functions for lazy job evaluation.
    if (typeof job === 'function')
      this.moduleMap.set(url, job = job());
    if (job !== undefined)
      return job;

    let loaderInstance;
    if (!translators.has(format))
      throw new ERR_UNKNOWN_MODULE_FORMAT(format);

    loaderInstance = translators.get(format);

    const inspectBrk = parentURL === undefined &&
        format === 'module' && getOptionValue('--inspect-brk');
    job = new ModuleJob(this, url, loaderInstance, parentURL === undefined,
                        inspectBrk);
    this.moduleMap.set(url, job);
    return job;
  }
}

ObjectSetPrototypeOf(Loader.prototype, null);

exports.Loader = Loader;

let bottomLoaderRPC;
const {
  RemoteLoaderWorker,
} = require('internal/modules/esm/ipc_types');

exports.getBottomLoaderRPC = () => {
  if (bottomLoaderRPC === undefined) {
    throw new Error('not initialized');
  }
  return bottomLoaderRPC;
}

exports.initUserLoaders = function (bottomLoader) {
  // console.log('initializing user loaders', bottomLoader)
  // console.trace();
  if (!bottomLoader) {
    bottomLoaderRPC = defaultLoaderWorker;
    return;
  }
  const { emitExperimentalWarning } = require('internal/util');
  emitExperimentalWarning('--experimental-loader');
  bottomLoaderRPC = new RemoteLoaderWorker(bottomLoader);
  // console.log('initialized user loader', bottomLoader.name)
  // bottomLoaderRPC.send(
  //   new ResolveRequest({
  //     specifier: 'fs',
  //     base: pathToFileURL(process.cwd()+'/').href,
  //     conditions: [
  //       'import',
  //       'default',
  //       'node'
  //     ]
  //   })
  // );
}

/* @ts-self-types="./ssimulacra2.d.ts" */

/**
 * Chroma subsampling format
 * @enum {0 | 1 | 2 | 3}
 */
const ChromaSampling = Object.freeze({
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420: 0, "0": "Cs420",
    /**
     * Horizontally subsampled.
     */
    Cs422: 1, "1": "Cs422",
    /**
     * Not subsampled.
     */
    Cs444: 2, "2": "Cs444",
    /**
     * Monochrome.
     */
    Cs400: 3, "3": "Cs400",
});
exports.ChromaSampling = ChromaSampling;

/**
 * Scores `distorted` against `reference` with SSIMULACRA 2. 100 means identical, and lower
 * scores mean more visible distortion.
 *
 * Both images are 8-bit sRGB pixels in RGB order with no alpha, `width * height * 3` bytes long.
 *
 * # Errors
 *
 * Throws when a buffer's length doesn't match the dimensions, or when the images are smaller
 * than 8x8 pixels.
 * @param {Uint8Array} reference
 * @param {Uint8Array} distorted
 * @param {number} width
 * @param {number} height
 * @returns {number}
 */
function score(reference, distorted, width, height) {
    const ptr0 = passArray8ToWasm0(reference, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(distorted, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.score(ptr0, len0, ptr1, len1, width, height);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}
exports.score = score;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ssimulacra2_bg.js": import0,
    };
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/ssimulacra2_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();

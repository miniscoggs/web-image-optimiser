/* tslint:disable */
/* eslint-disable */

/**
 * Chroma subsampling format
 */
export enum ChromaSampling {
    /**
     * Both vertically and horizontally subsampled.
     */
    Cs420 = 0,
    /**
     * Horizontally subsampled.
     */
    Cs422 = 1,
    /**
     * Not subsampled.
     */
    Cs444 = 2,
    /**
     * Monochrome.
     */
    Cs400 = 3,
}

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
 */
export function score(reference: Uint8Array, distorted: Uint8Array, width: number, height: number): number;

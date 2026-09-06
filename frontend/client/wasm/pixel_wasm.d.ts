/* tslint:disable */
/* eslint-disable */

/**
 * Nhận diện kích thước ô lưới tốt nhất (Best Grid Size) từ Ensemble Consensus
 */
export function detect_best_grid_size(data: Uint8Array, width: number, height: number): number;

/**
 * Nhận diện danh sách các kích thước lưới ứng viên từ Ensemble Consensus của pixel-art-fixer
 * Trả về đối tượng JavaScript Array: `[{ size: 4, confidence: 98 }, ...]`
 */
export function detect_grid_candidates(data: Uint8Array, width: number, height: number): any;

/**
 * Tương thích ngược: Cho phép gọi detect_grid_candidates kèm tham số mở rộng
 */
export function detect_grid_candidates_with_filter_and_mode(data: Uint8Array, width: number, height: number, _color_mode: string, _filter_mode: string): any;

/**
 * Tương thích ngược: Cho phép gọi detect_grid_candidates kèm color_mode
 */
export function detect_grid_candidates_with_mode(data: Uint8Array, width: number, height: number, _color_mode: string): any;

/**
 * [Hướng A]: Nhận diện đồng thuận toàn diện bằng Ensemble Multi-Detector (ACF + Run-Lengths + Self-Similarity)
 * Trả về đối tượng ConsensusResult chi tiết: step_x, step_y, cols, rows, offset_x, offset_y, consensus, confidence, candidates
 */
export function detect_grid_ensemble(data: Uint8Array, width: number, height: number): any;

/**
 * Nhận diện lưới Sub-pixel chi tiết đạt độ chính xác cao từ ACF của pixel-art-fixer
 */
export function detect_subpixel_grid(data: Uint8Array, width: number, height: number): any;

/**
 * Tương thích ngược: Cho phép gọi detect_subpixel_grid kèm tham số mở rộng
 */
export function detect_subpixel_grid_with_filter_and_mode(data: Uint8Array, width: number, height: number, _color_mode: string, _filter_mode: string): any;

/**
 * Tương thích ngược: Cho phép gọi detect_subpixel_grid kèm color_mode
 */
export function detect_subpixel_grid_with_mode(data: Uint8Array, width: number, height: number, _color_mode: string): any;

export function main_js(): void;

/**
 * Tái tạo nhanh bằng Two-Stage Packing (K-means Structure + Original Color Extraction)
 */
export function pack_native_sprite(data: Uint8Array, width: number, height: number, cols: number, rows: number, k_colors: number): any;

/**
 * [Hướng A]: Tái tạo sprite pixel art ở độ phân giải gốc siêu nét bằng Snapped Cuts + Phase Alignment + Palette Extraction
 * Trả về NativeSpriteResult: { width: u32, height: u32, rgba: Uint8Array }
 */
export function reconstruct_native_sprite(data: Uint8Array, width: number, height: number, step_x: number, step_y: number, cols: number, rows: number, auto_palette: boolean): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly detect_best_grid_size: (a: number, b: number, c: number, d: number) => number;
    readonly detect_grid_candidates: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly detect_grid_candidates_with_filter_and_mode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly detect_grid_candidates_with_mode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly detect_grid_ensemble: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly detect_subpixel_grid: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly detect_subpixel_grid_with_filter_and_mode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly detect_subpixel_grid_with_mode: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly main_js: () => void;
    readonly pack_native_sprite: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly reconstruct_native_sprite: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

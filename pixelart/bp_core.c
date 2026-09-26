/**
 * bp_core.c — MC 调色盘像素画:最近色匹配 + 多种抖动 WASM 版
 *
 * 接管像素画页面的逐像素热路径:
 *   - 动态调色盘(JS 启动时经 bp_palette_add 逐项注入,上限 BP_PAL_MAX 项;
 *     每项存 sRGB + CIELAB,最近色用 LAB ΔE76)
 *   - 可选子集掩码(mask[i]!=0 表示参与匹配;不设掩码则全部参与)
 *   - 多种抖动(浮点误差缓冲,行优先 + serpentine;Bayer 有序抖动)
 *   - Riemersma(Hilbert 曲线误差扩散)
 *   - 输出最近色索引表(Uint16,支持 >255 色调色盘)
 *
 * 输出索引由 JS 映射到方块(名称/计数/导出),C 侧不认识方块。
 * 翻转(左右/上下)与水平/垂直放置都是索引表上的重排,留在 JS 做。
 *
 * 编译(Kali, emcc 6.0.5):
 *   emcc bp_core.c -O3 -flto -fno-exceptions \
 *     -s MODULARIZE=1 -s EXPORT_NAME=createBpCore -s ALLOW_MEMORY_GROWTH=1 \
 *     -s ENVIRONMENT=web,worker,node -s DISABLE_EXCEPTION_CATCHING=1 \
 *     -s EXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAPF32 \
 *     -s EXPORTED_FUNCTIONS=_bp_version,_bp_init,_bp_palette_add,_bp_palette_count,\
 * _bp_pixels_ptr,_bp_out_ptr,_bp_mask_ptr,_bp_convert,_bp_err_ptr,_bp_palette_clear \
 *     -o bp_core.js
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define BP_PAL_MAX 1024
#define BP_VERSION 1

/* ---------------- 抖动算法 id(与页面 ditherAlgo 选项一致) ---------------- */
enum {
    BP_DITHER_NONE = 0,
    BP_DITHER_FS = 1,        /* Floyd-Steinberg        7/16,3/16,5/16,1/16 */
    BP_DITHER_ATKINSON = 2,  /* Atkinson               6×1/8,总扩散 75% */
    BP_DITHER_JJN = 3,       /* Jarvis-Judice-Ninke    48 份 */
    BP_DITHER_SIERRA3 = 4,   /* Sierra 3               32 份 */
    BP_DITHER_STUCKI = 5,    /* Stucki                 42 份 */
    BP_DITHER_BURKES = 6,    /* Burkes                 32 份 */
    BP_DITHER_BAYER4 = 7,
    BP_DITHER_BAYER8 = 8,
    BP_DITHER_RIEMERSMA = 9
};

typedef struct { signed char dx; signed char dy; float w; } KERN;

static const KERN K_FS[] = {
    { 1, 0, 7.f / 16 }, { -1, 1, 3.f / 16 }, { 0, 1, 5.f / 16 }, { 1, 1, 1.f / 16 }
};
static const KERN K_ATK[] = {   /* Atkinson:总扩散 6/8,对比更强 */
    { 1, 0, 1.f / 8 }, { 2, 0, 1.f / 8 },
    { -1, 1, 1.f / 8 }, { 0, 1, 1.f / 8 }, { 1, 1, 1.f / 8 },
    { 0, 2, 1.f / 8 }
};
static const KERN K_JJN[] = {   /* Jarvis-Judice-Ninke:48 份 */
    { 1, 0, 7.f / 48 }, { 2, 0, 5.f / 48 },
    { -2, 1, 3.f / 48 }, { -1, 1, 5.f / 48 }, { 0, 1, 7.f / 48 }, { 1, 1, 5.f / 48 }, { 2, 1, 3.f / 48 },
    { -2, 2, 1.f / 48 }, { -1, 2, 3.f / 48 }, { 0, 2, 5.f / 48 }, { 1, 2, 3.f / 48 }, { 2, 2, 1.f / 48 }
};
static const KERN K_S3[] = {    /* Sierra 3:32 份 */
    { 1, 0, 5.f / 32 }, { 2, 0, 3.f / 32 },
    { -2, 1, 2.f / 32 }, { -1, 1, 4.f / 32 }, { 0, 1, 5.f / 32 }, { 1, 1, 4.f / 32 }, { 2, 1, 2.f / 32 },
    { -1, 2, 2.f / 32 }, { 0, 2, 3.f / 32 }, { 1, 2, 2.f / 32 }
};
static const KERN K_STU[] = {   /* Stucki:42 份,比 JJN 锐利 */
    { 1, 0, 8.f / 42 }, { 2, 0, 4.f / 42 },
    { -2, 1, 2.f / 42 }, { -1, 1, 4.f / 42 }, { 0, 1, 8.f / 42 }, { 1, 1, 4.f / 42 }, { 2, 1, 2.f / 42 },
    { -2, 2, 1.f / 42 }, { -1, 2, 2.f / 42 }, { 0, 2, 4.f / 42 }, { 1, 2, 2.f / 42 }, { 2, 2, 1.f / 42 }
};
static const KERN K_BUR[] = {   /* Burkes:32 份,Stucki 的单行简化 */
    { 1, 0, 8.f / 32 }, { 2, 0, 4.f / 32 },
    { -2, 1, 2.f / 32 }, { -1, 1, 4.f / 32 }, { 0, 1, 8.f / 32 }, { 1, 1, 4.f / 32 }, { 2, 1, 2.f / 32 }
};

/* Bayer 4x4 / 8x8 阈值矩阵(0..n-1) */
static const unsigned char BAYER4[16] = {
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5
};
static const unsigned char BAYER8[64] = {
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
};

/* ---------------- 全局状态 ---------------- */
static int g_w = 0, g_h = 0;
static int g_pal_n = 0;
static unsigned char g_pal_rgb[BP_PAL_MAX][3];   /* 注入的 sRGB */
static float g_pal_lab[BP_PAL_MAX][3];           /* 预转 LAB */
/* 子集掩码(mask[i]!=0 表示参与匹配;掩码全 0 = 全部参与) */
static unsigned char g_mask[BP_PAL_MAX];

static unsigned char *g_px = NULL;    /* w*h*4 RGBA 输入 */
static uint16_t *g_out = NULL;        /* w*h 索引输出 */
static float *g_err = NULL;           /* 3 行 × (w+4) × 3 通道浮点误差缓冲 */

/* ---------------- sRGB → CIELAB ---------------- */
static float sl(int c) {
    float s = c / 255.0f;
    return (s <= 0.04045f) ? s / 12.92f : powf((s + 0.055f) / 1.055f, 2.4f);
}
static void rgb2lab(int R, int G, int B, float out[3]) {
    float r = sl(R), g = sl(G), b = sl(B);
    float X = r * 0.4124f + g * 0.3576f + b * 0.1805f;
    float Y = r * 0.2126f + g * 0.7152f + b * 0.0722f;
    float Z = r * 0.0193f + g * 0.1192f + b * 0.9505f;
    X /= 0.95047f; Z /= 1.08883f;
    #define F(T) ((T) > 0.008856f ? cbrtf(T) : (7.787f * (T) + 16.0f / 116.0f))
    float fx = F(X), fy = F(Y), fz = F(Z);
    #undef F
    out[0] = 116.0f * fy - 16.0f;
    out[1] = 500.0f * (fx - fy);
    out[2] = 200.0f * (fy - fz);
}

/* ---------------- 误差缓冲(行优先,3 行滚动) ---------------- */
#define ERR(rows, x, ch) g_err[((size_t)(rows) * (size_t)(g_w + 4) + (size_t)((x) + 2)) * 3 + (ch)]

static void err_shift(void) {
    size_t rowBytes = sizeof(float) * (size_t)(g_w + 4) * 3;
    memmove(g_err, (char *)g_err + rowBytes, rowBytes * 2);
    memset((char *)g_err + rowBytes * 2, 0, rowBytes);
}
static void err_clear(void) {
    size_t rowBytes = sizeof(float) * (size_t)(g_w + 4) * 3;
    memset(g_err, 0, rowBytes * 3);
}

/* 最近色:LAB ΔE76;掩码启用时只匹配 mask!=0 的项 */
static int g_use_mask = 0;
static inline int nearest(float L, float A, float B2) {
    int best = -1;
    float bestDiff = 1e30f;
    for (int i = 0; i < g_pal_n; i++) {
        if (g_use_mask && !g_mask[i]) continue;
        float dL = g_pal_lab[i][0] - L;
        float dA = g_pal_lab[i][1] - A;
        float dB = g_pal_lab[i][2] - B2;
        float diff = dL * dL + dA * dA + dB * dB;
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;   /* 掩码全关时可能 -1;调用方回退全量 */
}
/* 无视掩码的全量最近色(掩码把所有候选都关掉时兜底) */
static inline int nearest_full(float L, float A, float B2) {
    int best = -1; float bestDiff = 1e30f;
    for (int i = 0; i < g_pal_n; i++) {
        float dL = g_pal_lab[i][0] - L;
        float dA = g_pal_lab[i][1] - A;
        float dB = g_pal_lab[i][2] - B2;
        float diff = dL * dL + dA * dA + dB * dB;
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

/* Riemersma 用:Hilbert 曲线走查(classic d2xy) */
static void d2xy(int n, int d, int *x, int *y) {
    int rx, ry, s, t = d;
    *x = *y = 0;
    for (s = 1; s < n; s *= 2) {
        rx = 1 & (t / 2);
        ry = 1 & (t ^ rx);
        /* rotate */
        if (ry == 0) {
            if (rx == 1) { *x = s - 1 - *x; *y = s - 1 - *y; }
            int tt = *x; *x = *y; *y = tt;
        }
        *x += s * rx;
        *y += s * ry;
        t /= 4;
    }
    (void)rx; (void)ry;
}

/* ---------------- 导出 API ---------------- */

int bp_version(void) { return BP_VERSION; }

/* (重)分配像素/输出/误差缓冲;调色板不清空(跨转换复用) */
int bp_init(int w, int h) {
    if (w <= 0 || h <= 0 || (long long)w * h > 16777216) return 0;
    if (g_px) { free(g_px); g_px = NULL; }
    if (g_out) { free(g_out); g_out = NULL; }
    if (g_err) { free(g_err); g_err = NULL; }
    g_px = (unsigned char *)malloc((size_t)w * h * 4);
    g_out = (uint16_t *)malloc((size_t)w * h * 2);
    size_t errBytes = sizeof(float) * (size_t)(w + 4) * 3 * 3;
    g_err = (float *)malloc(errBytes);
    if (!g_px || !g_out || !g_err) return 0;
    memset(g_err, 0, errBytes);
    g_w = w; g_h = h;
    return 1;
}

int bp_palette_add(int r, int g, int b) {
    if (g_pal_n >= BP_PAL_MAX) return -1;
    int idx = g_pal_n++;
    g_pal_rgb[idx][0] = (unsigned char)r;
    g_pal_rgb[idx][1] = (unsigned char)g;
    g_pal_rgb[idx][2] = (unsigned char)b;
    float lab[3];
    rgb2lab(r, g, b, lab);
    g_pal_lab[idx][0] = lab[0]; g_pal_lab[idx][1] = lab[1]; g_pal_lab[idx][2] = lab[2];
    return idx;
}

void bp_palette_clear(void) { g_pal_n = 0; }

int bp_palette_count(void) { return g_pal_n; }

int bp_pixels_ptr(void) { return (int)(uintptr_t)g_px; }
int bp_out_ptr(void)    { return (int)(uintptr_t)g_out; }
int bp_mask_ptr(void)   { return (int)(uintptr_t)g_mask; }
/* 调试/测试用:暴露误差缓冲指针 */
int bp_err_ptr(void)    { return (int)(uintptr_t)g_err; }

/**
 * 转换:像素已在 g_px(w*h*4 RGBA),输出索引写 g_out(w*h uint16)。
 * dither: 0..9(见枚举);serpentine: 误差扩散蛇形(0/1)
 * 返回:使用掩码时若有像素无可匹配色,自动回退全量;返回 0 = 失败。
 */
int bp_convert(int dither, int serpentine) {
    if (!g_px || !g_out || !g_err || g_pal_n <= 0) return 0;
    const int W = g_w, H = g_h;
    const int X = W, Y = H;

    g_use_mask = 0;
    /* 掩码有效性:至少 1 项开启才启用 */
    for (int i = 0; i < g_pal_n; i++) if (g_mask[i]) { g_use_mask = 1; break; }

    int algo = dither;
    if (algo < BP_DITHER_NONE || algo > BP_DITHER_RIEMERSMA) algo = BP_DITHER_NONE;

    /* ---- 有序抖动(Bayer):阈值偏移加在量化前的采样值上(不改误差缓冲) ---- */
    if (algo == BP_DITHER_BAYER4 || algo == BP_DITHER_BAYER8) {
        const unsigned char *bm = (algo == BP_DITHER_BAYER4) ? BAYER4 : BAYER8;
        int n = (algo == BP_DITHER_BAYER4) ? 4 : 8;
        float amp = 255.0f / 8.0f;   /* 与 vca_core.c 幅度一致 */
        for (int y = 0; y < Y; y++) {
            for (int x = 0; x < X; x++) {
                size_t o4 = ((size_t)y * X + x) * 4;
                if (g_px[o4 + 3] == 0) { g_out[(size_t)y * X + x] = 0xFFFF; continue; }
                float off = (bm[(y & (n - 1)) * n + (x & (n - 1))] / (float)(n * n) - 0.5f) * amp;
                int r = (int)g_px[o4] + (int)off;
                int g = (int)g_px[o4 + 1] + (int)off;
                int b = (int)g_px[o4 + 2] + (int)off;
                if (r < 0) r = 0; if (r > 255) r = 255;
                if (g < 0) g = 0; if (g > 255) g = 255;
                if (b < 0) b = 0; if (b > 255) b = 255;
                float lab[3]; rgb2lab(r, g, b, lab);
                int ci = nearest(lab[0], lab[1], lab[2]);
                if (ci < 0) ci = nearest_full(lab[0], lab[1], lab[2]);
                g_out[(size_t)y * X + x] = (uint16_t)ci;
            }
        }
        return 1;
    }

    /* ---- Riemersma:Hilbert 曲线 + 小核(1/8 右、5/16 下、5/16 左、1/16 上,同 vca) ---- */
    if (algo == BP_DITHER_RIEMERSMA) {
        /* 曲线边长 = 大于等于 max(W,H) 的最小 2 的幂 */
        int n = 1;
        while (n < (W > H ? W : H)) n *= 2;
        long long total = (long long)n * n;
        if (total > 67108864LL) return 0;   /* 安全上限 */
        err_clear();
        for (long long d = 0; d < total; d++) {
            int x, y;
            d2xy(n, (int)d, &x, &y);
            if (x >= X || y >= Y) continue;
            size_t o4 = ((size_t)y * X + x) * 4;
            if (g_px[o4 + 3] == 0) { g_out[(size_t)y * X + x] = 0xFFFF; continue; }
            float er = ERR(0, x, 0), eg = ERR(0, x, 1), eb = ERR(0, x, 2);
            int r = (int)(g_px[o4] + er + 0.5f);
            int g = (int)(g_px[o4 + 1] + eg + 0.5f);
            int b = (int)(g_px[o4 + 2] + eb + 0.5f);
            if (r < 0) r = 0; if (r > 255) r = 255;
            if (g < 0) g = 0; if (g > 255) g = 255;
            if (b < 0) b = 0; if (b > 255) b = 255;
            float lab[3]; rgb2lab(r, g, b, lab);
            int ci = nearest(lab[0], lab[1], lab[2]);
            if (ci < 0) ci = nearest_full(lab[0], lab[1], lab[2]);
            g_out[(size_t)y * X + x] = (uint16_t)ci;
            /* 误差 = 量化前 - 量化后(sRGB 域),小核散布 */
            float fr = (g_px[o4] + er) - g_pal_rgb[ci][0];
            float fg = (g_px[o4 + 1] + eg) - g_pal_rgb[ci][1];
            float fb = (g_px[o4 + 2] + eb) - g_pal_rgb[ci][2];
            /* 权重:右 1/8、下 5/8、左 1/8(仿 Riemersma 常见 2x2 前向近似) */
            float wr = 1.f / 8, wd = 5.f / 8, wl = 1.f / 8;
            if (x + 1 < X) { ERR(0, x + 1, 0) += fr * wr; ERR(0, x + 1, 1) += fg * wr; ERR(0, x + 1, 2) += fb * wr; }
            if (y + 1 < Y) { ERR(1, x, 0)     += fr * wd; ERR(1, x, 1) += fg * wd; ERR(1, x, 2) += fb * wd; }
            if (x - 1 >= 0 && y + 1 < Y) { ERR(1, x - 1, 0) += fr * wl; ERR(1, x - 1, 1) += fg * wl; ERR(1, x - 1, 2) += fb * wl; }
        }
        return 1;
    }

    /* ---- 误差扩散(FS/Atkinson/JJN/Sierra3/Stucki/Burkes),浮点误差缓冲 ---- */
    const KERN *kern; int kn;
    switch (algo) {
        case BP_DITHER_FS:      kern = K_FS;  kn = 4;  break;
        case BP_DITHER_ATKINSON:kern = K_ATK; kn = 6;  break;
        case BP_DITHER_JJN:     kern = K_JJN; kn = 12; break;
        case BP_DITHER_SIERRA3: kern = K_S3;  kn = 10; break;
        case BP_DITHER_STUCKI:  kern = K_STU; kn = 12; break;
        case BP_DITHER_BURKES:  kern = K_BUR; kn = 7;  break;
        default:                kern = NULL; kn = 0; break;   /* none */
    }

    err_clear();
    for (int y = 0; y < Y; y++) {
        int ltr = ((y & 1) == 0) || !serpentine;
        int xs = ltr ? 0 : X - 1;
        int xe = ltr ? X : -1;
        int stp = ltr ? 1 : -1;
        for (int x = xs; x != xe; x += stp) {
            size_t o4 = ((size_t)y * X + x) * 4;
            if (g_px[o4 + 3] == 0) { g_out[(size_t)y * X + x] = 0xFFFF; continue; }
            float er = ERR(0, x, 0), eg = ERR(0, x, 1), eb = ERR(0, x, 2);
            int r = (int)(g_px[o4] + er + 0.5f);
            int g = (int)(g_px[o4 + 1] + eg + 0.5f);
            int b = (int)(g_px[o4 + 2] + eb + 0.5f);
            if (r < 0) r = 0; if (r > 255) r = 255;
            if (g < 0) g = 0; if (g > 255) g = 255;
            if (b < 0) b = 0; if (b > 255) b = 255;
            float lab[3]; rgb2lab(r, g, b, lab);
            int ci = nearest(lab[0], lab[1], lab[2]);
            if (ci < 0) ci = nearest_full(lab[0], lab[1], lab[2]);
            g_out[(size_t)y * X + x] = (uint16_t)ci;
            if (!kern) continue;
            /* 误差 = 量化前(sRGB+err) - 调色板 sRGB(浮点域) */
            float fr = (g_px[o4] + er) - (float)g_pal_rgb[ci][0];
            float fg = (g_px[o4 + 1] + eg) - (float)g_pal_rgb[ci][1];
            float fb = (g_px[o4 + 2] + eb) - (float)g_pal_rgb[ci][2];
            for (int k = 0; k < kn; k++) {
                int nx = x + kern[k].dx * (ltr ? 1 : -1);
                int ny = y + kern[k].dy;
                if (nx < 0 || nx >= X || ny >= Y) continue;
                ERR(ny - y, nx, 0) += fr * kern[k].w;
                ERR(ny - y, nx, 1) += fg * kern[k].w;
                ERR(ny - y, nx, 2) += fb * kern[k].w;
            }
        }
        err_shift();
    }
    return 1;
}

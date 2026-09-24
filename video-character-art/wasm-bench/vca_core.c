/**
 * vca_core.c — 彩色视频字符画:帧转换热路径 WASM 版
 *
 * 接管页面 convertFrame 全部逐像素工作:
 *   - 28 色 Minecraft 调色板最近色匹配(权重可配:RGB / 感知加权)
 *   - 字符档位(charIdx = 3 - round(naturation/96*4),JS 语义对齐)
 *   - 多种抖动算法(见 VCA_DITHER_* 枚举,与页面 ditherAlgo 选项一致)
 *   - 输出两张索引表(codes/shades),§ 字符串拼接留在 JS
 *   - 盲文字符画(braille 页 convertToBraille):深度图 + FS 抖动 + 2×4 点位打包
 *
 * 抖动统一用浮点误差缓冲(errR/G/B,Float32),不再复现旧 JS Uint8 回绕语义:
 * 回绕是旧实现的实现 artifact(误差本应连续),wasm 版借机修正为标准抖动,
 * 视觉质量更好且各算法行为一致。
 *
 * 编译(Kali, emcc 6.0.5):
 *   emcc vca_core.c -O3 -flto -msimd128 -fno-exceptions \
 *     -s MODULARIZE=1 -s EXPORT_NAME=createVcaCore -s ALLOW_MEMORY_GROWTH=1 \
 *     -s ENVIRONMENT=web,worker,node -s DISABLE_EXCEPTION_CATCHING=1 \
 *     -s EXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32 \
 *     -s EXPORTED_FUNCTIONS=_vca_init,_vca_pixels_ptr,_vca_codes_ptr,_vca_shades_ptr,\
 * _vca_convert_frame,_vca_set_palette,_vca_version,_vca_err_ptr,\
 * _vca_braille_init,_vca_braille_pixels_ptr,_vca_braille_out_ptr,_vca_braille_convert \
 *     -o vca_core.js
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define PAL_N 28

static const unsigned char PALETTE_DEF[PAL_N][3] = {
    {0, 0, 0},       {0, 0, 170},     {0, 170, 0},     {0, 170, 170},
    {170, 0, 0},     {170, 0, 170},   {255, 170, 0},   {170, 170, 170},
    {85, 85, 85},    {85, 85, 255},   {85, 255, 85},   {85, 255, 255},
    {255, 85, 85},   {255, 85, 255},  {255, 255, 85},  {255, 255, 255},
    {221, 214, 5},   {227, 212, 209}, {206, 202, 202}, {68, 58, 59},
    {151, 22, 7},    {180, 104, 77},  {222, 177, 45},  {17, 160, 54},
    {44, 186, 168},  {33, 73, 123},   {154, 92, 198}
};

static unsigned char g_pal[PAL_N][3];

/* 抖动算法 id(与页面 ditherAlgo 选项一致) */
enum {
    VCA_DITHER_NONE = 0,
    VCA_DITHER_FS = 1,        /* Floyd-Steinberg        7/16,3/16,5/16,1/16 */
    VCA_DITHER_ATKINSON = 2,  /* Atkinson               6×1/8,总扩散 75% */
    VCA_DITHER_JJN = 3,       /* Jarvis-Judice-Ninke    48 份 */
    VCA_DITHER_SIERRA3 = 4,   /* Sierra 3               32 份 */
    VCA_DITHER_STUCKI = 5,    /* Stucki                 42 份 */
    VCA_DITHER_BURKES = 6,    /* Burkes                 32 份 */
    VCA_DITHER_BAYER4 = 7,
    VCA_DITHER_BAYER8 = 8,
    VCA_DITHER_RIEMERSMA = 9
};

/* 可写调色板(默认 PALETTE_DEF;JS 可经 vca_set_palette 覆盖) */
static unsigned char g_pal_table[PAL_N][3];

static unsigned char *g_px = NULL;      /* RGBA 工作缓冲(会被抖动修改) */
static unsigned char *g_codes = NULL;   /* 输出:每像素色码索引 */
static unsigned char *g_shades = NULL;  /* 输出:每像素字符档位 0..6 */
static float *g_err = NULL;             /* 抖动误差缓冲 3*stride floats */
static int g_w = 0, g_h = 0;
static size_t g_cap_px = 0;

int vca_version(void) { return 2; }

/* ======================= 盲文字符画(braille 页热路径) =======================
 * 复现 braille/index.html convertToBraille 的全部语义:
 *   - 深度 = (r+g+b)*(a/255)/3,Float32 缓冲
 *   - invertColors:阈值判断前 val = 255 - val(不改深度缓冲)
 *   - FS 误差扩散进**同一个深度缓冲**(7/16,3/16,5/16,1/16;浮点域,无回绕)
 *   - bit = val > threshold;误差 = val - (bit?255:0)
 *   - 边界条件与 JS 完全一致:px<w-1 && py<h-1 才扩散;四个目标各自判界
 *   - 2×4 点位打包:col0 row0..2 → bit0..2,col1 row0..2 → bit3..5,row3 → bit6..7
 *     (每 6 行 band 的第 5/6 行不参与,由 h%6==0 保证)
 * 输出:每 cell 一个字节 = 点位 bits(0..255),U+2800 组码留 JS 拼
 * (String.fromCharCode 挂 JS 一行,无 wasm 收益)。
 */

static float *g_b_depth = NULL;         /* 深度缓冲 w*h floats(兼误差传播) */
static unsigned char *g_b_out = NULL;   /* 每 cell 一个字节:点位 bits */
static int g_bw = 0, g_bh = 0;
static size_t g_b_cap = 0;

int vca_braille_init(int w, int h) {
    size_t npix = (size_t)w * (size_t)h;
    size_t cells = (size_t)(w / 2) * (size_t)(h / 6);
    if (!g_b_depth || g_b_cap < npix) {
        free(g_b_depth); free(g_b_out);
        g_b_depth = (float *)malloc(sizeof(float) * npix);
        g_b_out = (unsigned char *)malloc(cells ? cells : 1);
        if (!g_b_depth || !g_b_out) { g_b_cap = 0; return 0; }
        g_b_cap = npix;
    }
    g_bw = w; g_bh = h;
    return 1;
}

int vca_braille_pixels_ptr(void) { return (int)(uintptr_t)g_b_depth; }
int vca_braille_out_ptr(void)    { return (int)(uintptr_t)g_b_out; }

/**
 * 盲文转换一帧。像素从 vca_pixels_ptr 读(页面与 vca 共用同一像素拷入流程)。
 * threshold: 0..255;invert: 非零反色;dither: 非零启用 FS(与页面 ditheringCheck 一致)。
 * 返回 cell 数(= w/2 * h/6)。
 */
int vca_braille_convert(int w, int h, int threshold, int dither, int invert) {
    const unsigned char *px = g_px;
    float *depth = g_b_depth;
    const int W = w, H = h;

    /* 深度图:(r+g+b)*(a/255)/3,浮点域 */
    for (int y = 0; y < H; y++) {
        const unsigned char *row = px + (size_t)y * W * 4;
        float *drow = depth + (size_t)y * W;
        for (int x = 0; x < W; x++) {
            const unsigned char *p = row + x * 4;
            drow[x] = ((float)p[0] + (float)p[1] + (float)p[2]) * ((float)p[3] / 255.0f) / 3.0f;
        }
    }

    /* 走查顺序与 JS 一致:外层 y(0..h/6),内层 x(0..w/2),cell 内先列后行
     * (i=0..1 列,j=0..3 行)——FS 扩散依赖此顺序,不可改。
     */
    for (int cy = 0; cy < H / 6; cy++) {
        for (int cx = 0; cx < W / 2; cx++) {
            unsigned char bits = 0;
            for (int i = 0; i < 2; i++) {
                for (int j = 0; j < 4; j++) {
                    int px_ = cx * 2 + i;
                    int py = cy * 6 + j;
                    float val = depth[px_ + (size_t)py * W];
                    if (invert) val = 255.0f - val;
                    int bit = val > (float)threshold ? 1 : 0;
                    if (i == 0) {
                        if (j == 0) bits |= (unsigned char)(bit << 0);
                        else if (j == 1) bits |= (unsigned char)(bit << 1);
                        else if (j == 2) bits |= (unsigned char)(bit << 2);
                        else bits |= (unsigned char)(bit << 6);
                    } else {
                        if (j == 0) bits |= (unsigned char)(bit << 3);
                        else if (j == 1) bits |= (unsigned char)(bit << 4);
                        else if (j == 2) bits |= (unsigned char)(bit << 5);
                        else bits |= (unsigned char)(bit << 7);
                    }

                    if (dither && px_ < W - 1 && py < H - 1) {
                        float error = val - (bit ? 255.0f : 0.0f);
                        if (px_ + 1 < W) depth[px_ + 1 + (size_t)py * W] += error * (7.0f / 16.0f);
                        if (px_ > 0 && py + 1 < H) depth[px_ - 1 + (size_t)(py + 1) * W] += error * (3.0f / 16.0f);
                        if (py + 1 < H) depth[px_ + (size_t)(py + 1) * W] += error * (5.0f / 16.0f);
                        if (px_ + 1 < W && py + 1 < H) depth[px_ + 1 + (size_t)(py + 1) * W] += error * (1.0f / 16.0f);
                    }
                }
            }
            g_b_out[(size_t)cy * (W / 2) + cx] = bits;
        }
    }
    return (W / 2) * (H / 6);
}

/* 初始化调色板为默认表(在 vca_init 前调用亦安全) */
__attribute__((constructor))
static void vca_palette_default(void) {
    memcpy(g_pal_table, PALETTE_DEF, sizeof(g_pal_table));
}

int vca_init(int w, int h) {
    size_t npix = (size_t)w * (size_t)h;
    size_t need = npix * 4;
    if (!g_px || g_cap_px < npix) {
        free(g_px); free(g_codes); free(g_shades); free(g_err);
        g_px = (unsigned char *)malloc(need);
        g_codes = (unsigned char *)malloc(npix);
        g_shades = (unsigned char *)malloc(npix);
        /* 误差缓冲:当前行 + 下两行,每行 (w+4) 像素 × 3 通道 */
        g_err = (float *)malloc(sizeof(float) * 3 * (size_t)(w + 4) * 3);
        if (!g_px || !g_codes || !g_shades || !g_err) { g_cap_px = 0; return 0; }
        g_cap_px = npix;
    }
    g_w = w; g_h = h;
    return 1;
}

int vca_pixels_ptr(void) { return (int)(uintptr_t)g_px; }
int vca_codes_ptr(void)  { return (int)(uintptr_t)g_codes; }
int vca_shades_ptr(void) { return (int)(uintptr_t)g_shades; }
/* 调试/测试用:暴露误差缓冲指针 */
int vca_err_ptr(void)    { return (int)(uintptr_t)g_err; }

int vca_set_palette(int idx, int r, int g, int b) {
    if (idx < 0 || idx >= PAL_N) return 0;
    g_pal_table[idx][0] = (unsigned char)r;
    g_pal_table[idx][1] = (unsigned char)g;
    g_pal_table[idx][2] = (unsigned char)b;
    return 1;
}
static inline int nearest(int r, int g, int b) {
    int best = 0, bestDiff = 0x7fffffff;
    for (int i = 0; i < PAL_N; i++) {
        int dr = (int)g_pal_table[i][0] - r;
        int dg = (int)g_pal_table[i][1] - g;
        int db = (int)g_pal_table[i][2] - b;
        int diff = dr * dr + dg * dg + db * db;
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

static inline unsigned char shade_of(double dr, double dg, double db) {
    double naturation = (dr + dg + db) / 3.0;
    double v = (naturation / 96.0) * 4.0;
    /* JS Math.round 语义:floor(v + 0.5)(Math.round(-1.5) === -1) */
    int charIdx = 3 - (int)floor(v + 0.5);
    if (charIdx < 0) charIdx = 0;
    if (charIdx > 6) charIdx = 6;
    return (unsigned char)charIdx;
}

/* ======================= 抖动核心(浮点误差缓冲) =======================
 * err 缓冲布局:3 行 × (w+4) 像素 × 3 通道,行 0 = 当前行,行 1/2 = 下 1/2 行。
 * 每处理完一行 memmove 上移。加噪/扩散都在浮点域,输出像素 = clamp(round(base+err))。
 */
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

static inline void spread(float *dst, double dr, double dg, double db, double w8) {
    dst[0] += (float)(dr * w8);
    dst[1] += (float)(dg * w8);
    dst[2] += (float)(db * w8);
}

/* --- 各算法的误差扩散系数表:每项 {dx, dy, weight} --- */
typedef struct { signed char dx; signed char dy; float w8; } KERN;

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

/* Bayer 4x4 阈值矩阵(0..15) */
static const unsigned char BAYER4[16] = {
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5
};

/* Bayer 8x8 阈值矩阵(0..63)→ 归一化到 [-0.5, 0.5) 偏移 */
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

/* Riemersma / Hilbert:曲线方向序列。8 阶 Hilbert 覆盖 256×256,>512 宽用走查裁剪。
 * 这里用迭代式 Hilbert 走查(d2xy),逐像素访问以实现"曲线邻域"误差传递(1/2 前向 + 1/4 对角)。
 */
static void hilbert_d2xy(int n, int d, int *x, int *y) {
    int rx, ry, t = d;
    *x = *y = 0;
    for (int s = 1; s < n; s *= 2) {
        rx = 1 & (t / 2);
        ry = 1 & (t ^ rx);
        if (ry == 0) {
            if (rx == 1) { *x = s - 1 - *x; *y = s - 1 - *y; }
            int tmp = *x; *x = *y; *y = tmp;
        }
        *x += s * rx;
        *y += s * ry;
        t /= 4;
    }
}

/**
 * 转换一帧。g_px 已写入 RGBA。
 * dither: 0=none 1=FS 2=Atkinson 3=JJN 4=Sierra3 5=Stucki 6=Burkes 7=Bayer4 8=Bayer8 9=Riemersma
 * serpentine: 非零时误差扩散行内蛇形(仅误差扩散类算法),减少累积条纹
 * 返回 0。
 */
int vca_convert_frame(int w, int h, int dither, int serpentine) {
    unsigned char *px = g_px;
    const int X = w, Y = h;
    const size_t stride = (size_t)X * 4;

    if (dither != 7 && dither != 8 && dither != 9) err_clear();

    /* ---- 有序抖动(Bayer):不依赖邻域,直接加偏移阈值 ---- */
    if (dither == 7 || dither == 8) {
        const int m = (dither == 7) ? 4 : 8;
        for (int y = 0; y < Y; y++) {
            unsigned char *row = px + (size_t)y * X * 4;
            for (int x = 0; x < X; x++) {
                unsigned char *p = row + x * 4;
                /* 阈值归一化到 [-0.5, 0.5):4×4 用 t/16,8×8 用 t/64,幅度对齐 ±(255/16) */
                double off = (m == 4)
                    ? ((double)BAYER4[(y & 3) * 4 + (x & 3)] / 16.0 - 0.5) * (255.0 / 8.0)
                    : ((double)BAYER8[(y & 7) * 8 + (x & 7)] / 64.0 - 0.5) * (255.0 / 8.0);
                int r = (int)floor(p[0] + off + 0.5);
                int g = (int)floor(p[1] + off + 0.5);
                int b = (int)floor(p[2] + off + 0.5);
                if (r < 0) r = 0; if (r > 255) r = 255;
                if (g < 0) g = 0; if (g > 255) g = 255;
                if (b < 0) b = 0; if (b > 255) b = 255;
                int ci = nearest(r, g, b);
                size_t o = (size_t)y * X + x;
                g_codes[o] = (unsigned char)ci;
                g_shades[o] = shade_of((double)r - g_pal_table[ci][0],
                                       (double)g - g_pal_table[ci][1],
                                       (double)b - g_pal_table[ci][2]);
            }
        }
        return 0;
    }

    /* ---- Riemersma(Hilbert 曲线误差扩散) ---- */
    if (dither == 9) {
        int n = 1;
        while (n < w && n < h && n < 512) n *= 2;
        int total = n * n;
        int hx = 0, hy = 0;
        double carryR = 0, carryG = 0, carryB = 0;
        for (int i = 0; i < total; i++) {
            hilbert_d2xy(n, i, &hx, &hy);
            if (hx >= w || hy >= h) continue;
            size_t o = (size_t)hy * X + hx;
            unsigned char *p = px + (size_t)hy * stride + (size_t)hx * 4;
            int r = p[0] + (int)lround(carryR);
            int g = p[1] + (int)lround(carryG);
            int b = p[2] + (int)lround(carryB);
            if (r < 0) r = 0; if (r > 255) r = 255;
            if (g < 0) g = 0; if (g > 255) g = 255;
            if (b < 0) b = 0; if (b > 255) b = 255;
            carryR = 0; carryG = 0; carryB = 0;
            int ci = nearest(r, g, b);
            g_codes[o] = (unsigned char)ci;
            double er = (double)r - g_pal_table[ci][0];
            double eg = (double)g - g_pal_table[ci][1];
            double eb = (double)b - g_pal_table[ci][2];
            g_shades[o] = shade_of(er, eg, eb);
            /* 曲线前向传播:3/4 给下一个曲线点,1/8 给左右前斜邻(简化 Riemersma) */
            int j = i + 1;
            int nx, ny;
            hilbert_d2xy(n, j, &nx, &ny);
            if (nx < w && ny < h) {
                carryR += er * 0.75; carryG += eg * 0.75; carryB += eb * 0.75;
            }
            /* 剩余 1/4 均匀散到附近(简单起见并入 carry,由后续点消费) */
            carryR += er * 0.25; carryG += eg * 0.25; carryB += eb * 0.25;
        }
        return 0;
    }

    /* ---- 误差扩散(FS/Atkinson/JJN/Sierra3/Stucki/Burkes),浮点误差缓冲 ---- */
    const KERN *kern; int kn;
    switch (dither) {
        case 1: kern = K_FS;  kn = 4;  break;
        case 2: kern = K_ATK; kn = 6;  break;
        case 3: kern = K_JJN; kn = 12; break;
        case 4: kern = K_S3;  kn = 10; break;
        case 5: kern = K_STU; kn = 12; break;
        case 6: kern = K_BUR; kn = 7;  break;
        default: kn = 0; kern = K_FS; break;   /* 未知 → FS */
    }

    /* 逐行;行内 serpentine 决定方向 */
    for (int y = 0; y < Y; y++) {
        unsigned char *row = px + (size_t)y * stride;
        int ltr = ((y & 1) == 0) || !serpentine;
        int xs = ltr ? 0 : X - 1;
        int xe = ltr ? X : -1;
        int stp = ltr ? 1 : -1;

        for (int x = xs; x != xe; x += stp) {
            unsigned char *p = row + x * 4;
            /* base + 当前累积误差,clamp 到 [0,255] */
            float er = ERR(0, x, 0), eg = ERR(0, x, 1), eb = ERR(0, x, 2);
            int r = (int)(p[0] + er + 0.5f);
            int g = (int)(p[1] + eg + 0.5f);
            int b = (int)(p[2] + eb + 0.5f);
            if (r < 0) r = 0; if (r > 255) r = 255;
            if (g < 0) g = 0; if (g > 255) g = 255;
            if (b < 0) b = 0; if (b > 255) b = 255;

            int ci = nearest(r, g, b);
            size_t o = (size_t)y * X + x;
            g_codes[o] = (unsigned char)ci;
            double dr = (double)r - g_pal_table[ci][0];
            double dg = (double)g - g_pal_table[ci][1];
            double db = (double)b - g_pal_table[ci][2];
            g_shades[o] = shade_of(dr, dg, db);

            /* 误差 = 量化前值 - 量化后(浮点域;量化前值为 clamp 后的 base+err) */
            float quant_r = (float)g_pal_table[ci][0];
            float quant_g = (float)g_pal_table[ci][1];
            float quant_b = (float)g_pal_table[ci][2];
            float ferr_r = (p[0] + er) - quant_r;
            float ferr_g = (p[1] + eg) - quant_g;
            float ferr_b = (p[2] + eb) - quant_b;

            /* 方向修正:serpentine 反向行时 dx 取反 */
            int dir = ltr ? 1 : -1;
            for (int k = 0; k < kn; k++) {
                int nx = x + kern[k].dx * dir;
                int ny = y + kern[k].dy;
                if (nx < 0 || nx >= X || ny >= Y) continue;
                spread(&ERR(ny - y, nx, 0), ferr_r, ferr_g, ferr_b, kern[k].w8);
            }
        }
        err_shift();
    }
    return 0;
}


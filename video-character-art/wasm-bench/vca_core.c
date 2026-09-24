/**
 * vca_core.c — 彩色视频字符画:帧转换热路径的 WASM 可行性验证
 *
 * 移植 video-character-art/index.html 的 convertFrame:逐像素 28 色最近色匹配 +
 * 字符档位 + 可选 Floyd-Steinberg 抖动。目标:同一输入下与 JS 输出逐字节一致并测加速比。
 *
 * 语义对齐细节(JS 版为准):
 *  - JS 的 chunkd 是 Uint8Array:抖动误差累加会按 uint8 回绕,下一像素读到的就是
 *    回绕后的值 —— 这里同样用 unsigned char 缓冲逐字节累加,保证逐字节一致。
 *  - 误差分子 (dr*4/21 等) 在 JS 里是浮点数加到 Uint8 上再截断回绕,
 *    C 侧用 double 累加到 float 缓冲,与 JS 中间值一致,写回时再 round+wrap。
 *  - 字符档位公式 charIdx = 3 - round((naturation/96)*4) 逐字对应。
 *  - § 字符串拼接/合并不在 C 里做(收益低、UTF-8/UTF-16 转换麻烦),
 *    由 JS 从 codes/shades 索引表拼出,与 convertFrame 输出等价。
 *
 * 编译(Kali, emcc 6.0.5):
 *   emcc vca_core.c -O3 -flto -msimd128 \
 *     -s MODULARIZE=1 -s EXPORT_NAME=createVcaCore -s ALLOW_MEMORY_GROWTH=1 \
 *     -s EXPORTED_FUNCTIONS=_vca_init,_vca_pixels_ptr,_vca_codes_ptr,_vca_shades_ptr,\
 * _vca_convert_frame,_vca_stats \
 *     -o vca_core.js
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#define PAL_N 28

static const unsigned char PALETTE[PAL_N][3] = {
    {0, 0, 0},       {0, 0, 170},     {0, 170, 0},     {0, 170, 170},
    {170, 0, 0},     {170, 0, 170},   {255, 170, 0},   {170, 170, 170},
    {85, 85, 85},    {85, 85, 255},   {85, 255, 85},   {85, 255, 255},
    {255, 85, 85},   {255, 85, 255},  {255, 255, 85},  {255, 255, 255},
    {221, 214, 5},   {227, 212, 209}, {206, 202, 202}, {68, 58, 59},
    {151, 22, 7},    {180, 104, 77},  {222, 177, 45},  {17, 160, 54},
    {44, 186, 168},  {33, 73, 123},   {154, 92, 198}
};
static const char PALETTE_CODE[PAL_N] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    'a', 'b', 'c', 'd', 'e', 'f',
    'g', 'h', 'i', 'j', 'm', 'n', 'p', 'q', 's', 't', 'u'
};

static unsigned char *g_px = NULL;     // RGBA 工作缓冲(抖动会在其上累积)
static unsigned char *g_codes = NULL;  // 输出:每像素色码索引
static unsigned char *g_shades = NULL; // 输出:每像素字符档位 0..6
static int g_w = 0, g_h = 0;
static size_t g_cap = 0;

int vca_init(int w, int h) {
    size_t npix = (size_t)w * (size_t)h;
    size_t need = npix * 4;
    if (!g_px || g_cap < need) {
        free(g_px); free(g_codes); free(g_shades);
        g_px = (unsigned char *)malloc(need);
        g_codes = (unsigned char *)malloc(npix);
        g_shades = (unsigned char *)malloc(npix);
        if (!g_px || !g_codes || !g_shades) { g_cap = 0; return 0; }
        g_cap = need;
    }
    g_w = w; g_h = h;
    return 1;
}

int vca_pixels_ptr(void) { return (int)(uintptr_t)g_px; }
int vca_codes_ptr(void)  { return (int)(uintptr_t)g_codes; }
int vca_shades_ptr(void) { return (int)(uintptr_t)g_shades; }

static inline int nearest(int r, int g, int b) {
    int best = 0, bestDiff = 0x7fffffff;
    for (int i = 0; i < PAL_N; i++) {
        int dr = (int)PALETTE[i][0] - r;
        int dg = (int)PALETTE[i][1] - g;
        int db = (int)PALETTE[i][2] - b;
        int diff = dr * dr + dg * dg + db * db;
        if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
}

static inline unsigned char shade_of(double dr, double dg, double db) {
    double naturation = (dr + dg + db) / 3.0;
    double v = (naturation / 96.0) * 4.0;
    // JS Math.round 语义:向 +Inf 取整半数(Math.round(-1.5) === -1),
    // 而 C lround(-1.5) === -2。用 floor(v + 0.5) 复现 JS 行为。
    int charIdx = 3 - (int)floor(v + 0.5);
    if (charIdx < 0) charIdx = 0;
    if (charIdx > 6) charIdx = 6;
    return (unsigned char)charIdx;
}

/**
 * 转换一帧(g_px 已由 JS 写入)。dither != 0 启用 FS 抖动。
 * JS 语义(必须逐字复现):Uint8Array 元素 += 浮点误差时,
 *   存储值 = ToUint8(byte + err) = (int)trunc(byte + err) mod 256 —— 先向零截断再 mod 256。
 *   例如 1 + (-3.2) = -2.2 → trunc = -2 → mod 256 = 254。
 * C 的 (unsigned char)(负小数) 是未定义行为,不能直接转;须用 js_wrap_u8()。
 */
static inline unsigned char js_wrap_u8(double v) {
    int t = (int)v;            /* 向零截断,同 JS ToIntegerOrInfinity 截断 */
    return (unsigned char)(t & 0xFF);
}

int vca_convert_frame(int w, int h, int dither) {
    unsigned char *px = g_px;
    const int X = w, Y = h;
    const size_t stride = (size_t)X * 4;

    for (int y = 0; y < Y; y++) {
        unsigned char *row = px + (size_t)y * stride;
        for (int x = 0; x < X; x++) {
            unsigned char *p = row + x * 4;
            int r = p[0], g = p[1], b = p[2];
            int ci = nearest(r, g, b);
            size_t o = (size_t)y * X + x;
            g_codes[o] = (unsigned char)ci;
            double dr = (double)r - (double)PALETTE[ci][0];
            double dg = (double)g - (double)PALETTE[ci][1];
            double db = (double)b - (double)PALETTE[ci][2];
            g_shades[o] = shade_of(dr, dg, db);

            if (dither) {
                if (x < X - 2) {
                    p[4] = js_wrap_u8(p[4] + dr * 4.0 / 21.0);
                    p[5] = js_wrap_u8(p[5] + dg * 4.0 / 21.0);
                    p[6] = js_wrap_u8(p[6] + db * 4.0 / 21.0);
                    p[8] = js_wrap_u8(p[8] + dr * 2.0 / 21.0);
                    p[9] = js_wrap_u8(p[9] + dg * 2.0 / 21.0);
                    p[10]= js_wrap_u8(p[10]+ db * 2.0 / 21.0);
                } else if (x < X - 1) {
                    p[4] = js_wrap_u8(p[4] + dr * 7.0 / 16.0);
                    p[5] = js_wrap_u8(p[5] + dg * 7.0 / 16.0);
                    p[6] = js_wrap_u8(p[6] + db * 7.0 / 16.0);
                }
                if (x > 1 && y < Y - 2) {
                    unsigned char *nrow  = row + stride;       // y+1 行
                    unsigned char *nrow2 = row + stride * 2;   // y+2 行
                    unsigned char *q  = nrow  + (x - 2) * 4;
                    unsigned char *q1 = nrow  + (x - 1) * 4;
                    unsigned char *q2 = nrow  + x * 4;
                    unsigned char *q3 = nrow  + (x + 1) * 4;
                    unsigned char *q4 = nrow  + (x + 2) * 4;
                    unsigned char *r0 = nrow2 + (x - 2) * 4;
                    unsigned char *r1 = nrow2 + (x - 1) * 4;
                    unsigned char *r2 = nrow2 + x * 4;
                    unsigned char *r3 = nrow2 + (x + 1) * 4;
                    unsigned char *r4 = nrow2 + (x + 2) * 4;
                    q[0]  = js_wrap_u8(q[0]  + dr * 1.0 / 21.0);
                    q[1]  = js_wrap_u8(q[1]  + dg * 1.0 / 21.0);
                    q[2]  = js_wrap_u8(q[2]  + db * 1.0 / 21.0);
                    q1[0] = js_wrap_u8(q1[0] + dr * 2.0 / 21.0);
                    q1[1] = js_wrap_u8(q1[1] + dg * 2.0 / 21.0);
                    q1[2] = js_wrap_u8(q1[2] + db * 2.0 / 21.0);
                    q2[0] = js_wrap_u8(q2[0] + dr * 4.0 / 21.0);
                    q2[1] = js_wrap_u8(q2[1] + dg * 4.0 / 21.0);
                    q2[2] = js_wrap_u8(q2[2] + db * 4.0 / 21.0);
                    q3[0] = js_wrap_u8(q3[0] + dr * 2.0 / 21.0);
                    q3[1] = js_wrap_u8(q3[1] + dg * 2.0 / 21.0);
                    q3[2] = js_wrap_u8(q3[2] + db * 2.0 / 21.0);
                    q4[0] = js_wrap_u8(q4[0] + dr * 1.0 / 21.0);
                    q4[1] = js_wrap_u8(q4[1] + dg * 1.0 / 21.0);
                    q4[2] = js_wrap_u8(q4[2] + db * 1.0 / 21.0);
                    r0[0] = js_wrap_u8(r0[0] + dr * 1.0 / 42.0);
                    r0[1] = js_wrap_u8(r0[1] + dg * 1.0 / 42.0);
                    r0[2] = js_wrap_u8(r0[2] + db * 1.0 / 42.0);
                    r1[0] = js_wrap_u8(r1[0] + dr * 1.0 / 21.0);
                    r1[1] = js_wrap_u8(r1[1] + dg * 1.0 / 21.0);
                    r1[2] = js_wrap_u8(r1[2] + db * 1.0 / 21.0);
                    r2[0] = js_wrap_u8(r2[0] + dr * 2.0 / 21.0);
                    r2[1] = js_wrap_u8(r2[1] + dg * 2.0 / 21.0);
                    r2[2] = js_wrap_u8(r2[2] + db * 2.0 / 21.0);
                    r3[0] = js_wrap_u8(r3[0] + dr * 1.0 / 21.0);
                    r3[1] = js_wrap_u8(r3[1] + dg * 1.0 / 21.0);
                    r3[2] = js_wrap_u8(r3[2] + db * 1.0 / 21.0);
                    r4[0] = js_wrap_u8(r4[0] + dr * 1.0 / 42.0);
                    r4[1] = js_wrap_u8(r4[1] + dg * 1.0 / 42.0);
                    r4[2] = js_wrap_u8(r4[2] + db * 1.0 / 42.0);
                }
            }
        }
    }
    return 0;
}

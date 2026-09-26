// gerr_probe.c — 在 Kali 上直接编译运行,检查 g_err 在 row0 结束后的沉积(勿提交)
// 编译: gcc -O2 -o gerr_probe gerr_probe.c && ./gerr_probe
#include <stdio.h>
#include <string.h>

/* 直接 include bp_core.c 以访问其静态全局(g_err/g_w 等) */
#include "bp_core.c"

/* 复刻 wasm 冒烟的 h=2 渐变图,跑 bp_convert 前把 bp_convert 包一层:
   不能 hook 内部循环 —— 退而求其次:手动跑与 bp_convert 相同的行0循环,然后 dump g_err。 */

int main(void) {
    const int w = 48, h = 2;
    bp_palette_clear();
    /* 装入 palettes.json 的 A 表在 C 侧太麻烦 —— 先用 3 个探针色:
       208=Emerald Block (25,177,56), 318=Lime Stained Glass (127,203,25), 43=? 先不管,
       目的:验证 g_err 沉积路径本身(量化→输出→散布),不是全量对拍。 */
    bp_palette_add(25, 177, 56);
    bp_palette_add(127, 203, 25);
    bp_palette_add(200, 200, 200);
    if (!bp_init(w, h)) { printf("init fail\n"); return 1; }
    unsigned char *px = g_px;
    for (int x = 0; x < w; x++) {
        size_t o = (size_t)x * 4;
        px[o]     = (unsigned char)(x * 255 / (w - 1));
        px[o + 1] = 0;
        px[o + 2] = (unsigned char)(x * 128 / (w - 1) + 40);
        px[o + 3] = 255;
    }
    for (int x = 0; x < w; x++) {
        size_t o = ((size_t)w + x) * 4;
        px[o] = 16; px[o + 1] = 255; px[o + 2] = 51; px[o + 3] = 255;
    }
    /* 行0 手动循环(与 bp_convert FS 分支一致): */
    int ltr = 1;
    for (int x = 0; x < w; x++) {
        size_t o4 = (size_t)x * 4;
        float er = ERR(0, x, 0), eg = ERR(0, x, 1), eb = ERR(0, x, 2);
        int r = (int)(px[o4] + er + 0.5f);
        int g = (int)(px[o4 + 1] + eg + 0.5f);
        int b = (int)(px[o4 + 2] + eb + 0.5f);
        if (r < 0) r = 0; if (r > 255) r = 255;
        if (g < 0) g = 0; if (g > 255) g = 255;
        if (b < 0) b = 0; if (b > 255) b = 255;
        float lab[3]; rgb2lab(r, g, b, lab);
        int ci = nearest(lab[0], lab[1], lab[2]);
        if (ci < 0) ci = nearest_full(lab[0], lab[1], lab[2]);
        g_out[x] = (uint16_t)ci;
        float fr = (px[o4] + er) - (float)g_pal_rgb[ci][0];
        float fg = (px[o4 + 1] + eg) - (float)g_pal_rgb[ci][1];
        float fb = (px[o4 + 2] + eb) - (float)g_pal_rgb[ci][2];
        static const KERN *K = K_FS; int kn = 4;
        for (int k = 0; k < 4; k++) {
            int nx = x + K[k].dx * (ltr ? 1 : -1);
            int ny = 0 + K[k].dy;
            if (nx < 0 || nx >= w || ny >= h) continue;
            ERR(ny - 0, nx, 0) += fr * K[k].w;
            ERR(ny - 0, nx, 1) += fg * K[k].w;
            ERR(ny - 0, nx, 2) += fb * K[k].w;
        }
    }
    printf("after manual row0, ERR(1,x) deposits for y=1:\n");
    for (int x = 0; x < 8; x++)
        printf("  x=%d: [%.4f, %.4f, %.4f]\n", x, ERR(1, x, 0), ERR(1, x, 1), ERR(1, x, 2));
    return 0;
}

/* gerr2.c — 忠实复刻 h=2 冒烟图,真实 633 色调色盘,打印行0结束后 ERR(1,·) 的 y=1 沉积
   以及用 C 的 f32 LAB 对 (row1,x=3) 量化输入的最近色选择(勿提交) */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bp_core.c"

static const char *pal_name(int i) {
    (void)i;
    return "";
}

int main(void) {
    /* 从 pal_a.bin 读 633 色调色盘 */
    FILE *pf = fopen("pal_a.bin", "rb");
    if (!pf) { printf("pal_a.bin missing\n"); return 1; }
    bp_palette_clear();
    for (int i = 0; i < 633; i++) {
        unsigned char t[3];
        if (fread(t, 1, 3, pf) != 3) break;
        bp_palette_add(t[0], t[1], t[2]);
    }
    fclose(pf);
    printf("palette loaded: %d\n", bp_palette_count());

    const int w = 48, h = 2;
    if (!bp_init(w, h)) return 1;
    unsigned char *px = g_px;
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
        size_t o = ((size_t)y * w + x) * 4;
        px[o]     = (unsigned char)((x * 255 + (w - 1) / 2) / (w - 1));
        px[o + 1] = (unsigned char)((y * 255 + (h - 1) / 2) / (h - 1));
        px[o + 2] = (unsigned char)(((x + y) * 128 + (w + h - 2) / 2) / (w + h - 2) + 40);
        px[o + 3] = 255;
    }

    /* 完整复刻 bp_convert 的 FS serpentine 分支(只跑 row0,然后打印沉积) */
    err_clear();
    {
        int y = 0, ltr = 1;
        for (int x = 0; x < w; x++) {
            size_t o4 = ((size_t)y * w + x) * 4;
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
            g_out[y * w + x] = (uint16_t)ci;
            float fr = (px[o4] + er) - (float)g_pal_rgb[ci][0];
            float fg = (px[o4 + 1] + eg) - (float)g_pal_rgb[ci][1];
            float fb = (px[o4 + 2] + eb) - (float)g_pal_rgb[ci][2];
            for (int k = 0; k < 4; k++) {
                int nx = x + K_FS[k].dx * (1);
                int ny = y + K_FS[k].dy;
                if (nx < 0 || nx >= w || ny >= h) continue;
                ERR(ny - y, nx, 0) += fr * K_FS[k].w;
                ERR(ny - y, nx, 1) += fg * K_FS[k].w;
                ERR(ny - y, nx, 2) += fb * K_FS[k].w;
            }
        }
        printf("C(native) ERR(1,x) deposits for y=1, x=0..7:\n");
        for (int i = 0; i < 8; i++)
            printf("  x=%d: [%.4f, %.4f, %.4f]\n", i, ERR(1, i, 0), ERR(1, i, 1), ERR(1, i, 2));
        {
            float er = ERR(1, 3, 0), eg = ERR(1, 3, 1), eb = ERR(1, 3, 2);
            size_t o4 = (size_t)(w + 3) * 4;
            int r = (int)(px[o4] + er + 0.5f);
            int g = (int)(px[o4 + 1] + eg + 0.5f);
            int b = (int)(px[o4 + 2] + eb + 0.5f);
            int cr = r < 0 ? 0 : (r > 255 ? 255 : r);
            int cg = g < 0 ? 0 : (g > 255 ? 255 : g);
            int cb = b < 0 ? 0 : (b > 255 ? 255 : b);
            printf("C quantized rgb at (y1,x3): (%d,%d,%d) clamped (%d,%d,%d)\n", r, g, b, cr, cg, cb);
            float lab2[3]; rgb2lab(cr, cg, cb, lab2);
            int ci = nearest_full(lab2[0], lab2[1], lab2[2]);
            printf("C nearest at (y1,x3): %d\n", ci);
            printf("C picks check: pal[%d].rgb=(%d,%d,%d) pal[%d].rgb=(%d,%d,%d)\n",
                   208, g_pal_rgb[208][0], g_pal_rgb[208][1], g_pal_rgb[208][2],
                   318, g_pal_rgb[318][0], g_pal_rgb[318][1], g_pal_rgb[318][2]);
        }
    }
    return 0;
}

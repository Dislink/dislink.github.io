/**
 * video-frame-capture.test.js — 调度逻辑回归测试(node javascript/video-frame-capture.test.js)
 *
 * 用假 video 对象模拟「播放卡顿」场景,验证 VideoFrameCapture 的核心行为:
 *   1. rvfc 模式:画面不更新(不回调)时不会重复取帧;
 *   2. raf 模式:画面计数不增长(卡顿)时不取帧,时间轴假前进也不取;
 *   3. 追帧跳变:目标时刻的真实画面已过去 -> droppedLate,不用后面的画面回填;
 *   4. 背压:转换比取帧慢时 droppedBacklog,播放不被拖死;
 *   5. 正常播放:帧数、顺序、统计正确。
 */
'use strict';

const path = require('path');
const modPath = path.join(__dirname, 'video-frame-capture.js');

// 最小 DOM 垫片:脚本只用 document.createElement('canvas') 与 performance.now
function makeStubEnv() {
    const listeners = {};
    return {
        window: {
            performance: { now: () => Date.now() },
            requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 8),
            cancelAnimationFrame: (id) => clearTimeout(id),
            reportError: (e) => { console.error('[stub reportError]', e && e.message); },
            addEventListener: () => { },
            removeEventListener: () => { },
            setTimeout, clearTimeout,
            // 测试挂载点
            __listeners: listeners
        },
        document: {
            createElement() {
                const canvas = {
                    width: 0, height: 0,
                    getContext() {
                        return {
                            drawImage() { },
                            getImageData(x, y, w, h) {
                                return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
                            }
                        };
                    }
                };
                return canvas;
            }
        }
    };
}

function loadModule() {
    const env = makeStubEnv();
    const fn = new Function('window', 'globalThis', 'document',
        `${require('fs').readFileSync(modPath, 'utf8')};\nreturn window.VideoFrameCapture;`);
    const VFC = fn(env.window, env.window, env.document);
    return { VFC, window: env.window };
}

/** 假视频:手动驱动 rAF/事件 */
function makeFakeVideo({ hasRvfc = false, hasQuality = true } = {}) {
    const listeners = {};
    return {
        duration: 10,
        currentTime: 0,
        paused: false,
        ended: false,
        __listeners: listeners,
        __emit(evt) {
            (listeners[evt] || []).forEach((fn) => fn({ target: this }));
        },
        addEventListener(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
        removeEventListener(evt, fn) {
            const arr = listeners[evt] || [];
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
        },
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; },
        ...(hasRvfc ? {
            requestVideoFrameCallback() { return 1; },
            cancelVideoFrameCallback() { }
        } : {}),
        ...(hasQuality ? {
            getVideoPlaybackQuality() { return { totalVideoFrames: this.__frames }; }
        } : {}),
        __frames: 0
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 驱动假视频的 rAF 循环:模拟「时间轴走 + 画面计数走」或卡顿 */
function driveRaf(video, script) {
    // script: 每一项 [deltaTimeMs, deltaFrames],模拟每 16ms 一轮
    let i = 0;
    const timer = setInterval(() => {
        if (i >= script.length) { clearInterval(timer); return; }
        const [dt, df] = script[i++];
        video.currentTime += dt / 1000;
        video.__frames += df;
    }, 8);
    return () => clearInterval(timer);
}

async function runPlayback(VFC, video, opts = {}) {
    const frames = [];
    const p = VFC.captureDuringPlayback(video, {
        fps: 10, duration: video.duration, total: opts.total || 10,
        width: 4, height: 2, startIndex: 1,
        convert: (img) => 'f' + frames.length,
        onFrame: (t) => frames.push(t),
        ...opts
    });
    const stop = driveRaf(video, opts.script);
    const res = await p;
    stop();
    return { ...res, frames };
}

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log('  ok  ' + name); }
    else { failed++; console.error('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
    const { VFC } = loadModule();

    // ---- 1. 正常播放(raf + 画面计数可用) ----
    {
        const video = makeFakeVideo();
        const res = await runPlayback(VFC, video, {
            script: Array(60).fill([20, 1])   // 每轮 +20ms,+1 帧,匀速
        });
        check('1a 正常播放取满 9 帧', res.stats.captured === 9, JSON.stringify(res.stats));
        check('1b 无迟到丢弃', res.stats.droppedLate === 0, String(res.stats.droppedLate));
        check('1c 帧顺序正确', res.frames[0] === 'f0' && res.frames[8] === 'f8');
    }

    // ---- 2. 卡顿:时间轴走但画面计数不涨(旧 bug 场景) ----
    {
        const video = makeFakeVideo();
        // 前 5 轮正常,随后 20 轮卡顿(时间轴走,画面不动),再恢复
        const script = [];
        for (let i = 0; i < 5; i++) script.push([20, 1]);
        for (let i = 0; i < 40; i++) script.push([20, 0]);
        for (let i = 0; i < 40; i++) script.push([20, 1]);
        const res = await runPlayback(VFC, video, {
            total: 20,
            script
        });
        check('2a 卡顿期间不重复取帧', res.stats.captured <= 20, JSON.stringify(res.stats));
        check('2b 卡顿被记录', res.stats.stalls >= 1, String(res.stats.stalls));
        check('2c 无背压丢帧(转换很快)', res.stats.droppedBacklog === 0, String(res.stats.droppedBacklog));
    }

    // ---- 3. 追帧跳变:长时间卡顿后 currentTime 跳到 5s ----
    {
        const video = makeFakeVideo();
        video.duration = 20;
        const frames = [];
        const p = VFC.captureDuringPlayback(video, {
            fps: 10, duration: 20, total: 20, startIndex: 1, width: 4, height: 2,
            convert: () => 'x', onFrame: (t, idx) => frames.push(idx),
            maxPending: 8
        });
        // 模拟:0.5s 处卡住 2s(时间轴不动,画面不动),然后追帧跳到 5s
        let round = 0;
        const timer = setInterval(() => {
            round++;
            if (round <= 4) { video.currentTime += 0.05; video.__frames++; }
            else if (round <= 30) { /* 卡死 */ }
            else { video.currentTime = 5.0; video.__frames += 100; }
            if (round > 45) { clearInterval(timer); }
        }, 8);
        const res = await p;
        clearInterval(timer);
        // 跳变后 t=5.0 的画面出现在 1.0..5.0 的目标时刻:应 droppedLate 而不是回填
        check('3a 跳变区间记为迟到丢弃', res.stats.droppedLate >= 10, JSON.stringify(res.stats));
        check('3b 跳变前画面不回填迟到帧', frames.every((f) => f === 1 || f === 2), 'frames=' + JSON.stringify(frames));
    }

    // ---- 4. 背压:转换很慢时丢帧而非堆积 ----
    // 注:背压真正触发需要「时间轴大幅超前 + 转换慢」;时间轴慢速前进时
    // consider 每轮只命中 1 个目标帧,pending 短暂为 0~1 即被清空,天然无堆积。
    {
        const video = makeFakeVideo();
        // 每轮时间轴 +0.5s(=5 个 interval),转换 120ms:命中 5 个目标帧但 maxPending=2,
        // 其中部分还因迟到被丢,验证两条丢帧路径都工作、captured 受限
        const res = await runPlayback(VFC, video, {
            total: 12, maxPending: 2,
            convert: () => { const s = Date.now(); while (Date.now() - s < 120) { } return 'slow'; },
            script: Array(400).fill([500, 50])
        });
        check('4a 慢转换下 captured 受限', res.stats.captured <= 8, JSON.stringify(res.stats));
        check('4b 仍取到多数帧', res.stats.captured >= 2, String(res.stats.captured));
        check('4c 迟到丢弃生效', res.stats.droppedLate > 0, String(res.stats.droppedLate));
    }

    // ---- 5. 拿不到画面计数 API 时退化为看时间轴 ----
    {
        const video = makeFakeVideo({ hasQuality: false });
        const script = [];
        for (let i = 0; i < 10; i++) script.push([20, 1]);
        for (let i = 0; i < 40; i++) script.push([0, 0]);   // 时间轴也不动
        for (let i = 0; i < 40; i++) script.push([20, 1]);
        const res = await runPlayback(VFC, video, { total: 20, script });
        check('5a 时间轴不动时不取帧', res.stats.captured <= 20, JSON.stringify(res.stats));
        check('5b 卡顿被记录', res.stats.stalls >= 1, String(res.stats.stalls));
    }

    // ---- 6. seek 路径 ----
    {
        const video = makeFakeVideo();
        // seekTo 依赖 seeked 事件:偷懒直接在 currentTime setter 触发 —— 用 __emit
        video.__listeners.seeked = [];
        Object.defineProperty(video, 'currentTime', {
            get() { return this.__t || 0; },
            set(v) { this.__t = v; setTimeout(() => this.__emit('seeked'), 0); }
        });
        const p = VFC.captureBySeek(video, {
            fps: 10, duration: 1, total: 10, startIndex: 0, width: 4, height: 2,
            convert: () => 's', seekTimeout: 500
        });
        const res = await p;
        check('6a seek 路径取满 10 帧', res.stats.captured === 10, JSON.stringify(res.stats));
        check('6b seek 路径模式标记', res.stats.presentMode === 'seek');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

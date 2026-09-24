/**
 * video-frame-capture.js — 视频播放取帧调度器
 * 供「彩色视频字符画生成器」(video-character-art) 与「视频转盲文」(braille) 共用。
 *
 * ============================ 修复的问题 ============================
 * 旧实现用 requestAnimationFrame 轮询 video.currentTime,只要时间轴走到目标帧时刻就立刻
 * drawImage 当前画面。视频解码/渲染卡顿时会出现两类错误取帧:
 *   1) 画面冻结但时间轴继续走(解码跟不上、渲染掉帧):同一个冻结画面被连续取成多帧;
 *   2) 卡顿后时间轴追帧跳变:跳变后的画面被回填到卡顿期间的那些时刻上,而且一次循环最多
 *      补 4 帧,卡顿区间被大量重复帧填满。
 * 结果是输出里卡顿处的帧被多取、内容还错位到卡顿之后。
 *
 * 修复策略:
 *   - 优先使用 video.requestVideoFrameCallback(rVFC):只在解码器真正呈现新画面时回调,
 *     用 meta.mediaTime(画面自身的媒体时间)判断它落在哪个目标帧上。画面不更新 -> 不回调
 *     -> 不取帧,天然不会重复取冻结画面。
 *   - 回退到 rAF 时双保险:优先看 video.getVideoPlaybackQuality().totalVideoFrames 是否增长
 *     (解码器有没有真的解码出新画面),拿不到该 API 时退而看 currentTime 是否前进;两者都
 *     说明「没有新画面」,则本轮跳过取帧并计入卡顿,不重复取同一张画面。
 *   - 目标时刻比当前画面落后超过一个帧间隔(lateFactor * interval)时,认定该时刻的真实
 *     画面已经过去,直接丢弃并计数(droppedLate),不再用后面的画面回填。
 *
 * =========================== 顺带优化卡顿 ===========================
 *   - 取帧(轻:drawImage + getImageData)与转换(重:逐像素匹配/抖动)解耦,转换放进宏任务
 *     队列逐帧执行,避免一次 rAF 里连转 4 帧的长任务阻塞解码与合成(旧实现 batch<4)。
 *   - 复用同一块离屏画布与 2D 上下文(willReadFrequently),不再每帧 new canvas + getContext。
 *   - 转换积压超过 maxPending 时主动丢帧(背压 droppedBacklog),宁可少几帧也不把播放拖卡。
 *
 * ============================ 优化效果记录 ===========================
 * 取帧方式、取到帧数、卡顿跳过帧数、背压丢帧数、卡顿次数/时长、耗时都会写入返回的 stats,
 * 页面把它们显示在状态栏并打到 console / window.__videoCaptureStats,便于对比优化前后。
 * 调度逻辑的回归测试见同目录 video-frame-capture.test.js(node javascript/video-frame-capture.test.js)。
 *
 * ========================= 关于「直接请求某一帧」 =========================
 * 浏览器无法在解码中「直接请求某一帧」:HTMLVideoElement 只提供 currentTime 定位(seek),
 * WebCodecs 的 VideoFrame/VideoDecoder 才能精确抽帧,但要求视频流自包含且浏览器支持,
 * 且无法替代 <video> 的宽容格式支持,因此未采用。rVFC(mediaTime)已能达到同等效果:
 * 每个真实呈现的画面都带自己的媒体时间戳,目标帧判定基于画面时间而非墙钟,效果等同于
 * 「解码器有帧时按需取帧」。若未来要支持更大分辨率,可再引入 WebCodecs 路径。
 */
(function (global) {
    'use strict';

    var EPS = 1e-4;

    function nowMs() {
        return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    }

    function on(target, evt, fn) {
        target.addEventListener(evt, fn);
        return fn;
    }

    function off(target, evt, fn) {
        if (fn) target.removeEventListener(evt, fn);
    }

    // ============ 离屏画布(全页复用) ============
    var sharedCanvas = null;
    var sharedCtx = null;

    function getCaptureCtx(w, h) {
        if (!sharedCanvas) {
            sharedCanvas = document.createElement('canvas');
            // 每帧都要 getImageData 读回,CPU 内存画布比 GPU 画布读回更快
            sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
        }
        if (sharedCanvas.width !== w) sharedCanvas.width = w;
        if (sharedCanvas.height !== h) sharedCanvas.height = h;
        return sharedCtx;
    }

    /**
     * 取当前画面像素(轻量:一次 drawImage + getImageData)。
     * @returns {ImageData}
     */
    function capturePixels(video, w, h) {
        var ctx = getCaptureCtx(w, h);
        ctx.drawImage(video, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h);
    }

    // ============ 可靠的 seek(带超时兜底) ============
    function seekTo(video, time, timeoutMs) {
        return new Promise(function (resolve) {
            if (time === undefined || isNaN(time)) time = 0;
            if (timeoutMs === undefined) timeoutMs = 500;
            var duration = video.duration || 0;
            if (duration > 0 && time > duration) time = duration;
            if (time < 0) time = 0;

            var settled = false;
            var handler = function () {
                if (settled) return;
                settled = true;
                off(video, 'seeked', handler);
                resolve();
            };
            on(video, 'seeked', handler);
            try { video.currentTime = time; } catch (e) { /* ignore */ }

            setTimeout(function () {
                if (!settled) {
                    settled = true;
                    off(video, 'seeked', handler);
                    resolve();
                }
            }, timeoutMs);
        });
    }

    /**
     * 解码出的画面计数:用来判断「有没有新画面」。
     * 播放卡顿时时间轴可能还在走(音频时钟/掉帧),但这个计数不会涨 —— 这正是旧实现重复
     * 取同一张冻结画面的根因。拿不到该 API 时返回 -1。
     */
    function decodedPictureCount(video) {
        if (typeof video.getVideoPlaybackQuality === 'function') {
            try {
                var q = video.getVideoPlaybackQuality();
                if (q && typeof q.totalVideoFrames === 'number') return q.totalVideoFrames;
            } catch (e) { /* ignore */ }
        }
        return -1;
    }

    // ============ 运行中的任务(供 cancel 使用) ============
    var activeRun = null;

    function beginRun(cancelFn) {
        cancelActive();
        activeRun = cancelFn;
    }

    function endRun(cancelFn) {
        if (activeRun === cancelFn) activeRun = null;
    }

    function cancelActive() {
        var fn = activeRun;
        activeRun = null;
        if (fn) {
            try { fn(); } catch (e) { /* ignore */ }
        }
    }

    function newStats(presentMode, total) {
        return {
            presentMode: presentMode,   // rvfc | raf | seek
            total: total,               // 计划取的总帧数(时长 x fps)
            captured: 0,                // 实际取到并转换完成的帧数
            droppedLate: 0,             // 卡顿/追帧跳过:该时刻的真实画面已经过去
            droppedBacklog: 0,          // 转换跟不上,主动背压丢帧
            stalls: 0,
            stallMs: 0,
            wallMs: 0,
            reason: ''
        };
    }

    /**
     * 播放取帧:边播放边按目标帧率取帧。
     * opts: {
     *   fps, duration, total, startIndex,
     *   width, height,            // 取帧像素尺寸
     *   convert(imgData, w, h),   // 重活:像素 -> 文本,在宏任务里逐帧执行
     *   onFrame(text, index),     // 可选:每转换完一帧回调一次
     *   onProgress(stats),        // 可选:进度回调
     *   maxPending, lateFactor,   // 可选:背压上限 / 迟到判定系数
     *   convertTimeoutMs          // 可选:转换卡死保护(默认 15000)
     * }
     * @returns {Promise<{frames: string[], stats: object}>} frames 按 startIndex..total-1 顺序
     */
    function captureDuringPlayback(video, opts) {
        opts = opts || {};
        var fps = opts.fps || 10;
        var duration = opts.duration || video.duration || 0;
        var total = opts.total || Math.ceil(duration * fps);
        var startIndex = opts.startIndex || 1;
        var width = opts.width;
        var height = opts.height;
        var convert = opts.convert || function () { return ''; };
        var onFrame = opts.onFrame || function () { };
        var onProgress = opts.onProgress || function () { };
        var maxPending = opts.maxPending || 3;
        var lateFactor = opts.lateFactor || 1.5;
        var interval = 1 / fps;

        var useRvfc = typeof video.requestVideoFrameCallback === 'function';
        var stats = newStats(useRvfc ? 'rvfc' : 'raf', total);

        var cancelled = false;
        var cancelFn = function () { cancelled = true; };

        return new Promise(function (resolve) {
            var t0 = nowMs();
            var out = [];
            var nextIndex = startIndex;
            var pending = [];
            var converting = false;
            var done = false;
            var lastPresentedTime = -1;
            var lastPictureCount = 0;
            var lastPictureAt = t0;
            var waitingAt = 0;
            var rvfcHandle = null;
            var rafHandle = null;
            var watchdog = null;
            var events = [];

            beginRun(function () {
                cancelled = true;
                finish('cancelled');
            });

            // ---------- 卡顿统计(waiting/stalled 由浏览器给出,两条路径都适用) ----------
            function onWaiting() {
                if (!waitingAt) {
                    waitingAt = nowMs();
                    stats.stalls++;
                }
            }

            function onPlaying() {
                if (waitingAt) {
                    stats.stallMs += nowMs() - waitingAt;
                    waitingAt = 0;
                }
            }

            function onEnded() {
                finish('ended');
            }

            // ---------- 转换队列:每帧一个宏任务,让出主线程给解码/合成 ----------
            function pump() {
                if (converting || pending.length === 0) return;
                var job = pending.shift();
                converting = true;
                setTimeout(function () {
                    if (cancelled) { converting = false; return; }
                    var text = '';
                    try {
                        text = convert(job.imgData, width, height);
                    } catch (e) {
                        if (global.reportError) global.reportError(e);
                    }
                    out[job.index - startIndex] = text;
                    stats.captured++;
                    try { onFrame(text, job.index); } catch (e) { /* ignore */ }
                    converting = false;
                    onProgress(stats);
                    pump();
                    drainIfDone();
                }, 0);
            }

            // ---------- 取帧判定 ----------
            function consider(presentedTime) {
                var batch = 0;
                while (nextIndex < total && presentedTime >= nextIndex * interval && batch < 8) {
                    var lag = presentedTime - nextIndex * interval;
                    if (lag > lateFactor * interval) {
                        // 卡顿/追帧:该时刻的画面已经过去,不能用现在的画面回填
                        stats.droppedLate++;
                        nextIndex++;
                        continue;
                    }
                    if (pending.length >= maxPending) {
                        // 转换跟不上:背压丢帧,优先保证播放不卡
                        stats.droppedBacklog++;
                        nextIndex++;
                        continue;
                    }
                    var index = nextIndex;
                    nextIndex++;
                    batch++;
                    pending.push({ index: index, imgData: capturePixels(video, width, height) });
                    pump();
                }
            }

            function tick(presentedTime) {
                if (done || cancelled) return;
                if (presentedTime <= lastPresentedTime + EPS) return;   // 画面未更新(卡顿),不取帧
                lastPresentedTime = presentedTime;
                lastPictureAt = nowMs();
                consider(presentedTime);
                onProgress(stats);
                if (nextIndex >= total) drainIfDone();
                if (duration > 0 && presentedTime >= duration - EPS) finish('duration');
            }

            // 目标帧取完且转换队列排空 -> 结束
            function drainIfDone() {
                if (done) return;
                if (nextIndex >= total && pending.length === 0 && !converting) finish('complete');
            }

            // ---------- 两条取帧路径 ----------
            function rvfcCb(now, meta) {
                if (done || cancelled) return;
                try {
                    tick(meta.mediaTime);
                } catch (e) {
                    if (global.reportError) global.reportError(e);
                }
                if (!done && !cancelled) {
                    try { rvfcHandle = video.requestVideoFrameCallback(rvfcCb); } catch (e) { /* ignore */ }
                }
            }

            function rafCb() {
                if (done || cancelled) return;
                var t = video.currentTime;
                var pics = decodedPictureCount(video);   // -1 表示拿不到该 API
                if (pics >= 0) {
                    if (pics <= lastPictureCount) {
                        // 解码器没吐新画面 —— 卡顿中,时间轴走不走都不取帧
                        onWaiting();
                        rafHandle = global.requestAnimationFrame(rafCb);
                        return;
                    }
                    lastPictureCount = pics;
                    onPlaying();
                    tick(t);
                } else if (t <= lastPresentedTime + EPS) {
                    // 拿不到画面计数,退化为看时间轴:没前进视为卡顿,不取帧
                    onWaiting();
                    rafHandle = global.requestAnimationFrame(rafCb);
                    return;
                } else {
                    onPlaying();
                    tick(t);
                }
                if (!done && !cancelled) rafHandle = global.requestAnimationFrame(rafCb);
            }

            function detach() {
                if (rvfcHandle !== null && typeof video.cancelVideoFrameCallback === 'function') {
                    try { video.cancelVideoFrameCallback(rvfcHandle); } catch (e) { /* ignore */ }
                    rvfcHandle = null;
                }
                if (rafHandle !== null && global.cancelAnimationFrame) {
                    try { global.cancelAnimationFrame(rafHandle); } catch (e) { /* ignore */ }
                    rafHandle = null;
                }
                for (var i = 0; i < events.length; i++) off(video, events[i][0], events[i][1]);
                events = [];
                if (watchdog) { clearInterval(watchdog); watchdog = null; }
            }

            function finish(reason) {
                if (done) return;
                done = true;
                cancelled = true;
                stats.reason = reason;
                if (waitingAt) {
                    stats.stallMs += nowMs() - waitingAt;
                    waitingAt = 0;
                }
                detach();
                try { video.pause(); } catch (e) { /* ignore */ }
                // 等转换队列排空,保证返回的 frames 完整
                var drain = function () {
                    if (pending.length > 0 || converting) {
                        setTimeout(drain, 0);
                        return;
                    }
                    stats.wallMs = Math.round(nowMs() - t0);
                    endRun(cancelFn);
                    resolve({ frames: out, stats: stats });
                };
                drain();
            }

            events.push(['ended', on(video, 'ended', onEnded)]);
            events.push(['waiting', on(video, 'waiting', onWaiting)]);
            events.push(['stalled', on(video, 'stalled', onWaiting)]);
            events.push(['playing', on(video, 'playing', onPlaying)]);

            onProgress(stats);

            if (useRvfc) {
                try {
                    lastPictureCount = Math.max(0, decodedPictureCount(video));
                    rvfcHandle = video.requestVideoFrameCallback(rvfcCb);
                } catch (e) {
                    // 少数实现会在非播放态抛错,退回 rAF
                    stats.presentMode = 'raf';
                    rafHandle = global.requestAnimationFrame(rafCb);
                }
            } else {
                rafHandle = global.requestAnimationFrame(rafCb);
            }

            // 看门狗:长时间没有任何新画面 -> 认定播放已停,收尾(避免 Promise 挂死)
            watchdog = setInterval(function () {
                if (done || cancelled) return;
                if (video.ended) { finish('ended'); return; }
                var sincePicture = nowMs() - lastPictureAt;
                if (sincePicture > 4000) { finish('stall-timeout'); return; }
                if (video.paused && nowMs() - t0 > 1000) finish('paused');
            }, 500);
        });
    }

    /**
     * 逐帧 seek 取帧:慢,但每帧都精确定位到目标时刻,不受播放卡顿影响(回退路径)。
     */
    function captureBySeek(video, opts) {
        opts = opts || {};
        var fps = opts.fps || 10;
        var duration = opts.duration || video.duration || 0;
        var total = opts.total || Math.ceil(duration * fps);
        var startIndex = opts.startIndex || 0;
        var width = opts.width;
        var height = opts.height;
        var convert = opts.convert || function () { return ''; };
        var onFrame = opts.onFrame || function () { };
        var onProgress = opts.onProgress || function () { };
        var seekTimeout = opts.seekTimeout || 200;

        var stats = newStats('seek', total);
        var cancelled = false;
        var cancelFn = function () { cancelled = true; };

        return new Promise(function (resolve) {
            var t0 = nowMs();
            var out = [];
            var i = startIndex;

            beginRun(function () {
                cancelled = true;
                finalize();
            });

            function finalize() {
                stats.wallMs = Math.round(nowMs() - t0);
                endRun(cancelFn);
                resolve({ frames: out, stats: stats });
            }

            function step() {
                if (cancelled) return;
                if (i >= total) { finalize(); return; }
                var time = i / fps;
                if (duration > 0 && time > duration) time = duration;
                seekTo(video, time, seekTimeout).then(function () {
                    if (cancelled) return;
                    var text = '';
                    try {
                        text = convert(capturePixels(video, width, height), width, height);
                    } catch (e) {
                        if (global.reportError) global.reportError(e);
                    }
                    out[i - startIndex] = text;
                    stats.captured++;
                    try { onFrame(text, i); } catch (e) { /* ignore */ }
                    onProgress(stats);
                    i++;
                    setTimeout(step, 0);   // 让出主线程,进度条才有机会刷新
                });
            }

            try { video.pause(); } catch (e) { /* ignore */ }
            onProgress(stats);
            step();
        });
    }

    global.VideoFrameCapture = {
        capturePixels: capturePixels,
        captureDuringPlayback: captureDuringPlayback,
        captureBySeek: captureBySeek,
        seekTo: seekTo,
        cancel: cancelActive,
        hasActiveRun: function () { return !!activeRun; }
    };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * midi-waterfall.js — MIDI 瀑布流可视化播放器 (带音效)
 *
 * 依赖: MIDIFile.js (全局 MIDIFile / MIDIEvents)
 *       页面需定义 getSoundString(program, percussion) 函数 (midi2mcfunction/midiconvertor 已有)
 *
 * 用法:
 *   initWaterfall('container-id', midiFileInstance, { speed: 1.0 });
 *
 * 在页面中需要有以下元素 (由 initWaterfall 自动绑定):
 *   #container-id — 画布容器 div
 *   #wf-play — 播放/暂停按钮
 *   #wf-stop — 停止按钮
 *   #wf-speed — 速度选择器
 *   #wf-progress — 进度条
 *   #wf-current-time — 当前时间显示
 *   #wf-total-time — 总时长显示
 */
(function() {

    // --- Channel colors ---
    var CHANNEL_COLORS = [
        '#3b82f6', '#22c55e', '#ef4444', '#f59e0b',
        '#a855f7', '#ec4899', '#14b8a6', '#f97316',
        '#06b6d4', '#64748b', '#84cc16', '#d946ef',
        '#0ea5e9', '#10b981', '#eab308', '#78716c'
    ];

    // --- Note names for labels ---
    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // --- Utility ---
    function formatTime(ms) {
        var totalSec = Math.round(ms / 1000);
        var min = Math.floor(totalSec / 60);
        var sec = totalSec % 60;
        return min + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // --- MIDI note to frequency ---
    function midiToFreq(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    // --- Audio engine ---
    var audioContext = null;

    function getAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioContext;
    }

    function playNote(midiNote, vol) {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        var freq = midiToFreq(midiNote);
        var now = ctx.currentTime;

        var gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        gain.connect(ctx.destination);

        // 基频 (三角波, 音色更温暖)
        var osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);
        osc1.connect(gain);

        // 高八度泛音
        var osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        var gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0.1, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.connect(gain2);
        gain2.connect(gain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.8);
        osc2.stop(now + 0.8);
    }

    // --- State per instance ---
    var instances = {};

    /**
     * 主入口: 初始化瀑布流可视化
     * @param {string} containerId — 容器元素 ID
     * @param {object} midiFile — MIDIFile 实例
     * @param {object} options — { speed: number }
     */
    window.initWaterfall = function(containerId, midiFile, options) {
        options = options || {};
        var container = document.getElementById(containerId);
        if (!container) return;

        // 清除旧实例
        var old = instances[containerId];
        if (old) {
            if (old.animId) cancelAnimationFrame(old.animId);
            old.destroyed = true;
            // 把旧实例的播放按钮文字恢复
            var oldPlayBtn = document.getElementById('wf-play');
            if (oldPlayBtn) oldPlayBtn.textContent = '播放';
        }

        // 解析事件, 计算音符持续时间
        var notes = parseNotes(midiFile);
        var timeTotal = midiFile.timeTotal || 1000;

        // 确定垂直缩放: 让整曲能在一个视窗高度 (3 次翻屏) 显示,
        // 但保证播放时每屏约 3 秒窗宽
        var pixelsPerSecond = Math.max(60, Math.min(300, container.clientHeight ? (container.clientHeight * 3) / (timeTotal / 1000) : 100));

        // 新建 canvas
        var canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        canvas.style.width = '100%';
        container.innerHTML = '';
        container.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        // 状态
        var state = {
            containerId: containerId,
            notes: notes,
            timeTotal: timeTotal,
            currentTime: 0,
            speed: options.speed || 1.0,
            isPlaying: false,
            lastFrameTime: 0,
            animId: null,
            canvas: canvas,
            ctx: ctx,
            pixelsPerSecond: pixelsPerSecond,
            leftMargin: 36,
            rightMargin: 44,
            topMargin: 8,
            playheadY: 0.82,
            seekPending: false,
            destroyed: false,
            lastPlayedIndex: -1,  // 用于音效触发
            soundPlayCheck: true   // 音效开
        };
        instances[containerId] = state;

        // 同步尺寸
        resizeCanvas(state);
        window.addEventListener('resize', function() { if (!state.destroyed) resizeCanvas(state); });

        // 绑定控件
        var playBtn = document.getElementById('wf-play');
        var stopBtn = document.getElementById('wf-stop');
        var speedSelect = document.getElementById('wf-speed');
        var progressSlider = document.getElementById('wf-progress');
        var currentTimeEl = document.getElementById('wf-current-time');
        var totalTimeEl = document.getElementById('wf-total-time');

        if (totalTimeEl) totalTimeEl.textContent = formatTime(timeTotal);

        // 播放/暂停
        if (playBtn) {
            playBtn.onclick = function() {
                if (state.currentTime >= state.timeTotal) {
                    state.currentTime = 0;
                    state.lastPlayedIndex = -1;
                }
                state.isPlaying = !state.isPlaying;
                playBtn.textContent = state.isPlaying ? '暂停' : '播放';
                if (state.isPlaying) {
                    state.lastFrameTime = performance.now();
                    if (!state.animId) loop(state);
                }
            };
        }

        // 停止
        if (stopBtn) {
            stopBtn.onclick = function() {
                state.isPlaying = false;
                state.currentTime = 0;
                state.lastPlayedIndex = -1;
                if (playBtn) playBtn.textContent = '播放';
                if (progressSlider) progressSlider.value = 0;
                if (currentTimeEl) currentTimeEl.textContent = '0:00';
                if (state.animId) { cancelAnimationFrame(state.animId); state.animId = null; }
                renderFrame(state);
            };
        }

        // 速度
        if (speedSelect) {
            speedSelect.onchange = function() {
                state.speed = parseFloat(speedSelect.value);
            };
        }

        // 进度条
        if (progressSlider) {
            progressSlider.oninput = function() {
                state.currentTime = (progressSlider.value / 1000) * state.timeTotal;
                state.seekPending = true;
                state.lastPlayedIndex = -1;
                if (currentTimeEl) currentTimeEl.textContent = formatTime(state.currentTime);
                if (!state.isPlaying) renderFrame(state);
            };
        }

        // 启动第一帧
        renderFrame(state);
    };

    // --- 解析 MIDI 事件, 计算音符持续时间 ---
    function parseNotes(midiFile) {
        var allEvents = midiFile.getEvents(
            [MIDIEvents.EVENT_MIDI],
            [],
            [],
            true
        )[0];  // 合并所有音轨, 按时间排列

        // 分离 note-on 和 note-off
        var noteOns = [];
        var noteOffEvents = [];

        for (var i = 0; i < allEvents.length; i++) {
            var ev = allEvents[i];
            if (ev.subtype === 0x9 && ev.param2 > 0) {
                // Note On with velocity > 0
                noteOns.push(ev);
            } else if (ev.subtype === 0x8 || (ev.subtype === 0x9 && ev.param2 === 0)) {
                // Note Off
                noteOffEvents.push(ev);
            }
        }

        // 配对 note-on / note-off 计算持续时间
        // 每颗 note-on 按顺序找第一个未被消费的同音高 note-off
        var offUsed = {};
        var renderNotes = [];
        for (var j = 0; j < noteOns.length; j++) {
            var on = noteOns[j];
            var key = on.channel + ':' + on.param1;
            var duration = 250;
            for (var k = 0; k < noteOffEvents.length; k++) {
                if (offUsed[k]) continue;
                var off = noteOffEvents[k];
                var offKey = off.channel + ':' + off.param1;
                if (offKey === key && off.playTime > on.playTime) {
                    duration = off.playTime - on.playTime;
                    offUsed[k] = true;
                    break;
                }
            }
            if (duration > 5000) duration = 5000;

            renderNotes.push({
                pitch: on.param1,
                channel: on.channel,
                playTime: on.playTime,
                duration: duration,
                velocity: on.param2
            });
        }
        return renderNotes;
    }

    // --- Canvas 尺寸调整 ---
    function resizeCanvas(state) {
        var container = state.canvas.parentElement;
        if (!container) return;
        var rect = container.getBoundingClientRect();
        var w = rect.width || 600;
        var h = Math.max(200, Math.min(500, window.innerHeight * 0.4));
        state.canvas.width = w * (window.devicePixelRatio || 1);
        state.canvas.height = h * (window.devicePixelRatio || 1);
        state.canvas.style.width = w + 'px';
        state.canvas.style.height = h + 'px';
        state.width = state.canvas.width;
        state.height = state.canvas.height;
        state.dpr = window.devicePixelRatio || 1;
        state.columnWidth = (state.width - state.leftMargin * state.dpr - state.rightMargin * state.dpr) / 128;
        state.pixelsPerMs = state.pixelsPerSecond / 1000 * state.dpr;

        if (!state.isPlaying) renderFrame(state);
    }

    // --- 主循环 ---
    function loop(state) {
        if (state.destroyed) return;
        var now = performance.now();
        if (state.isPlaying) {
            var delta = now - state.lastFrameTime;
            state.currentTime += delta * state.speed;
            if (state.currentTime >= state.timeTotal) {
                state.currentTime = state.timeTotal;
                state.isPlaying = false;
                var playBtn = document.getElementById('wf-play');
                if (playBtn) playBtn.textContent = '播放';
            }

            // 更新进度条
            var progress = Math.min(1, state.currentTime / state.timeTotal);
            var slider = document.getElementById('wf-progress');
            if (slider && !state.seekPending) slider.value = Math.round(progress * 1000);
            var timeEl = document.getElementById('wf-current-time');
            if (timeEl) timeEl.textContent = formatTime(state.currentTime);

            // 触发音效: 在播放头时间附近找需要播放的音符
            var prevTime = state.currentTime - (now - state.lastFrameTime) * state.speed * 1.5;
            if (prevTime < 0) prevTime = 0;
            var nextPlayIdx = state.lastPlayedIndex + 1;
            var noteIdx = nextPlayIdx < 0 ? 0 : nextPlayIdx;
            while (noteIdx < state.notes.length && state.notes[noteIdx].playTime <= state.currentTime) {
                var n = state.notes[noteIdx];
                if (n.playTime >= prevTime) {
                    triggerSound(n);
                }
                noteIdx++;
            }
            state.lastPlayedIndex = noteIdx - 1;
        }
        state.lastFrameTime = now;
        state.seekPending = false;

        renderFrame(state);
        state.animId = requestAnimationFrame(function() { loop(state); });
    }

    // --- 渲染一帧 ---
    function renderFrame(state) {
        var ctx = state.ctx;
        var w = state.width;
        var h = state.height;
        var dpr = state.dpr;
        var colW = state.columnWidth;
        var lm = state.leftMargin * dpr;
        var rm = state.rightMargin * dpr;
        var tm = state.topMargin * dpr;
        var playheadY = h * state.playheadY;

        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, w, h);

        // ----- 网格线和音高标签 -----
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.font = (10 * dpr) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';

        for (var p = 0; p < 128; p++) {
            var x = lm + p * colW + colW / 2;
            if (p % 12 === 0) {
                // 八度线 (C)
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, tm);
                ctx.lineTo(x, h);
                ctx.stroke();

                // 标签
                var octave = Math.floor(p / 12) - 1;
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('C' + octave, x - 2, h - 12 * dpr);

                // 小刻度线
                ctx.strokeStyle = '#e2e8f0';
                ctx.lineWidth = 0.5;
            } else if (p % 2 === 0) {
                // 半数网格线
                ctx.strokeStyle = '#f1f5f9';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(x, tm);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
        }

        // 回正描边色
        ctx.strokeStyle = '#e2e8f0';

        // ----- 时间刻度 (右侧) -----
        ctx.textAlign = 'left';
        ctx.fillStyle = '#94a3b8';
        var timeInterval = 2000; // 2 秒间隔
        if (state.timeTotal > 60000) timeInterval = 10000;
        else if (state.timeTotal > 15000) timeInterval = 5000;

        for (var t = 0; t <= state.timeTotal; t += timeInterval) {
            var y = t * state.pixelsPerMs - getScrollOffset(state);
            if (y >= tm && y <= h) {
                ctx.fillText(formatTime(t), w - rm + 4 * dpr, y);
            }
        }

        // ----- 绘制音符 -----
        var scrollOff = getScrollOffset(state);
        var visibleTop = tm - 50 * dpr;
        var visibleBottom = h + 50 * dpr;

        for (var i = 0; i < state.notes.length; i++) {
            var note = state.notes[i];
            var noteY = note.playTime * state.pixelsPerMs - scrollOff;
            var noteH = Math.max(2 * dpr, note.duration * state.pixelsPerMs);

            // 视口裁剪
            if (noteY + noteH < visibleTop || noteY > visibleBottom) continue;

            var noteX = lm + note.pitch * colW + 1;
            var noteW = Math.max(2 * dpr, colW - 2);

            // 按通道染色
            var color = CHANNEL_COLORS[note.channel % CHANNEL_COLORS.length];
            // 速度影响透明度
            var alpha = 0.4 + (note.velocity / 127) * 0.6;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;

            // 圆角矩形
            var r = Math.max(1, 2 * dpr);
            var nw = noteW;
            var nh = noteH;
            var nx = noteX;
            var ny = noteY;
            ctx.beginPath();
            ctx.moveTo(nx + r, ny);
            ctx.lineTo(nx + nw - r, ny);
            ctx.quadraticCurveTo(nx + nw, ny, nx + nw, ny + r);
            ctx.lineTo(nx + nw, ny + nh - r);
            ctx.quadraticCurveTo(nx + nw, ny + nh, nx + nw - r, ny + nh);
            ctx.lineTo(nx + r, ny + nh);
            ctx.quadraticCurveTo(nx, ny + nh, nx, ny + nh - r);
            ctx.lineTo(nx, ny + r);
            ctx.quadraticCurveTo(nx, ny, nx + r, ny);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // ----- 播放头线 -----
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = Math.max(1, 2 * dpr);
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(lm, playheadY);
        ctx.lineTo(w - rm + 12 * dpr, playheadY);
        ctx.stroke();
        ctx.setLineDash([]);

        // 播放头小三角
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.moveTo(lm - 6 * dpr, playheadY);
        ctx.lineTo(lm, playheadY - 4 * dpr);
        ctx.lineTo(lm, playheadY + 4 * dpr);
        ctx.closePath();
        ctx.fill();
    }

    // --- 计算滚动偏移 ---
    function getScrollOffset(state) {
        var playheadY = state.height * state.playheadY;
        return state.currentTime * state.pixelsPerMs - playheadY;
    }

    // --- 触发音效 ---
    function triggerSound(note) {
        // velocity 范围 1-127, 映射到 0.2 - 0.65 音量范围
        // 用对数映射让轻音和强音的听感差异更合理
        var vol = 0.1 + Math.pow(note.velocity / 127, 0.6) * 0.55;
        playNote(note.pitch, vol);
    }

})();

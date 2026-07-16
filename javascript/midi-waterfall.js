/**
 * midi-waterfall.js — MIDI 瀑布流可视化播放器
 *
 * 依赖: MIDIFile.js (全局 MIDIFile / MIDIEvents)
 *
 * 用法:
 *   // 合成音瀑布流 (默认)
 *   initWaterfall('container-id', midiFile, { speed: 1.0 });
 *
 *   // Minecraft 音效瀑布流 (模拟命令方块播放效果)
 *   initMCSoundWaterfall('container-id', midiFile, { speed: 1.0 });
 *
 * 在页面中需要有以下元素:
 *   #container-id — 画布容器 div
 *   #wf-play — 播放/暂停按钮
 *   #wf-stop — 停止按钮
 *   #wf-speed — 速度选择器
 *   #wf-progress — 进度条
 *   #wf-current-time — 当前时间显示
 *   #wf-total-time — 总时长显示
 *   (如果同一页面有多个瀑布流, 每个瀑布流的控件 ID 需要不同)
 */

(function() {

    var CHANNEL_COLORS = [
        '#3b82f6', '#22c55e', '#ef4444', '#f59e0b',
        '#a855f7', '#ec4899', '#14b8a6', '#f97316',
        '#06b6d4', '#64748b', '#84cc16', '#d946ef',
        '#0ea5e9', '#10b981', '#eab308', '#78716c'
    ];

    var INSTRUMENT_COLORS = [
        '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
        '#ef4444', '#14b8a6', '#ec4899', '#f97316',
        '#06b6d4', '#84cc16', '#0ea5e9', '#d946ef',
        '#10b981', '#eab308', '#8b5cf6', '#f43f5e',
        '#0d9488', '#e11d48', '#6366f1', '#0891b2'
    ];
    var DEFAULT_INSTR_COLOR = '#94a3b8'; // gray for default instrument (no program change)

    window.getInstrumentColor = function(idx) {
        return INSTRUMENT_COLORS[idx % INSTRUMENT_COLORS.length];
    };

    var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    function formatTime(ms) {
        var totalSec = Math.round(ms / 1000);
        var min = Math.floor(totalSec / 60);
        var sec = totalSec % 60;
        return min + ':' + (sec < 10 ? '0' : '') + sec;
    }

    function updateProgressFill(slider, pct) {
        if (!slider) return;
        slider.style.setProperty('--progress', (pct * 100) + '%');
    }

    function midiToFreq(midiNote) {
        return 440 * Math.pow(2, (midiNote - 69) / 12);
    }

    function midiToMCPlaybackRate(midiNote) {
        return Math.pow(2, (midiNote - 66) / 12);
    }

    // ---- Audio ----
    var audioContext = null;
    var soundBuffers = {};

    function getAudioContext() {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        return audioContext;
    }

    // Synthesized note (for MIDI waterfall)
    function playSynthNote(midiNote, vol) {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        var freq = midiToFreq(midiNote);
        var now = ctx.currentTime;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(vol * 0.4, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        gain.connect(ctx.destination);
        var osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);
        osc1.connect(gain);
        var osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        var gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0.1, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.connect(gain2);
        gain2.connect(gain);
        osc1.start(now); osc2.start(now);
        osc1.stop(now + 0.8); osc2.stop(now + 0.8);
    }

    // Load WAV from /sounds/note.{name}.wav
    function loadSound(name, callback) {
        if (soundBuffers[name]) { if (callback) callback(soundBuffers[name]); return; }
        var ctx = getAudioContext();
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/sounds/note.' + name + '.wav', true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function() {
            ctx.decodeAudioData(xhr.response, function(buf) {
                soundBuffers[name] = buf;
                if (callback) callback(buf);
            }, function() { if (callback) callback(null); });
        };
        xhr.onerror = function() { if (callback) callback(null); };
        xhr.send();
    }

    // Preload common MC sounds
    var MC_SOUNDS = ['harp','bell','bass','banjo','bd','snare','hat','bit','pling','flute','guitar','cow_bell','didgeridoo','iron_xylophone','icechime','xylophone','bassattack'];
    function preloadMCSounds() {
        for (var i = 0; i < MC_SOUNDS.length; i++) loadSound(MC_SOUNDS[i]);
    }

    // Play Minecraft WAV note with pitch shifting
    function playMCSound(name, midiNote, vol) {
        var ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        var now = ctx.currentTime;
        var buf = soundBuffers[name];
        if (!buf) {
            loadSound(name, function(b) { if (b) doPlayMC(b, midiNote, vol); });
            return;
        }
        doPlayMC(buf, midiNote, vol);
    }

    function doPlayMC(buf, midiNote, vol) {
        var ctx = getAudioContext();
        var now = ctx.currentTime;
        var source = ctx.createBufferSource();
        source.buffer = buf;
        source.playbackRate.value = midiToMCPlaybackRate(midiNote);
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(Math.min(1, vol * 0.5), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(now);
        source.stop(now + 0.5);
    }

    // Assign instrument index matching table rowIdx order
    // Uses the rowLookup built by the HTML table (exact match guaranteed)
        function assignSoundIdx(notes, midiFile, rowLookup) {
        if (!rowLookup || Object.keys(rowLookup).length === 0) {
            for (var j = 0; j < notes.length; j++) notes[j].soundIdx = -1;
            return 0;
        }
        var playList = midiFile.getEvents([MIDIEvents.EVENT_MIDI],[MIDIEvents.EVENT_MIDI_PROGRAM_CHANGE, MIDIEvents.EVENT_MIDI_NOTE_ON], [], true)[0];
        playList.sort(function(a,b){return a.playTime-b.playTime});

        for (var j = 0; j < notes.length; j++) {
            var n = notes[j];
            if (n.channel === 9) {
                var pkey = undefined;
                if (rowLookup[n.track]) pkey = rowLookup[n.track]['p'+n.pitch];
                if (pkey === undefined && rowLookup['perc']) pkey = rowLookup['perc']['p'+n.pitch];
                n.soundIdx = pkey !== undefined ? pkey : -1;
            } else {
                // Detect format: per-(track,channel) or per-channel
                var useTrackChannel = rowLookup[0] !== undefined;
                var rowIdx = -1;
                var pcList;
                if (useTrackChannel) {
                    pcList = rowLookup[n.track] ? rowLookup[n.track][n.channel] : undefined;
                } else {
                    pcList = rowLookup['c' + n.channel];
                }
                if (pcList && pcList.length > 0) {
                    var cnt = 0;
                    for (var i = 0; i < playList.length; i++) {
                        var ev = playList[i];
                        if (ev.channel !== 9 && ev.subtype === 0xc && ev.playTime <= n.playTime) {
                            if (useTrackChannel) {
                                if (ev.track === n.track && ev.channel === n.channel) cnt++;
                            } else {
                                if (ev.channel === n.channel) cnt++;
                            }
                        }
                    }
                    var idx = cnt > 0 ? cnt - 1 : 0;
                    if (idx < pcList.length) rowIdx = pcList[idx];
                }
                n.soundIdx = rowIdx;
            }
        }
        return 0;
    }

    // ---- Notes parsing ----
    function parseNotes(midiFile) {
        var allEvents = midiFile.getEvents([MIDIEvents.EVENT_MIDI], [], [], true)[0];
        var noteOns = [], noteOffs = [];
        for (var i = 0; i < allEvents.length; i++) {
            var ev = allEvents[i];
            if (ev.subtype === 0x9 && ev.param2 > 0) noteOns.push(ev);
            else if (ev.subtype === 0x8 || (ev.subtype === 0x9 && ev.param2 === 0)) noteOffs.push(ev);
        }
        var used = {};
        var notes = [];
        for (var j = 0; j < noteOns.length; j++) {
            var on = noteOns[j];
            var key = on.channel + ':' + on.param1;
            var dur = 250;
            for (var k = 0; k < noteOffs.length; k++) {
                if (used[k]) continue;
                var off = noteOffs[k];
                if ((off.channel + ':' + off.param1) === key && off.playTime > on.playTime) {
                    dur = off.playTime - on.playTime; used[k] = true; break;
                }
            }
            if (dur > 5000) dur = 5000;
            notes.push({ pitch: on.param1, channel: on.channel, playTime: on.playTime, duration: dur, velocity: on.param2, track: on.track || 0 });
        }
        return notes;
    }

    // ---- Instance state ----
    var instances = {};

    // ---- Core waterfall engine (used by both types) ----
    function createWaterfall(containerId, midiFile, opts) {
        opts = opts || {};
        var container = document.getElementById(containerId);
        if (!container) return null;

        var old = instances[containerId];
        if (old) { if (old.animId) cancelAnimationFrame(old.animId); old.destroyed = true; }

        var notes = parseNotes(midiFile);
        var notesCmd = [];
        var instCount = 0;
        // For command preview, use fixed short duration
        if (opts.fixedDuration) {
            instCount = assignSoundIdx(notes, midiFile, opts.rowLookup);
            for (var i = 0; i < notes.length; i++) {
                notesCmd.push({ pitch: notes[i].pitch, channel: notes[i].channel, playTime: notes[i].playTime, duration: 80, velocity: notes[i].velocity, soundIdx: notes[i].soundIdx, track: notes[i].track });
            }
        }

        var timeTotal = midiFile.timeTotal || 1000;
        var pps = Math.max(60, Math.min(300, container.clientHeight ? (container.clientHeight * 3) / (timeTotal / 1000) : 100));

        var canvas = document.createElement('canvas');
        canvas.style.display = 'block'; canvas.style.width = '100%';
        container.innerHTML = ''; container.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        var state = {
            containerId: containerId,
            notes: opts.fixedDuration ? notesCmd : notes,
            timeTotal: timeTotal,
            currentTime: 0,
            speed: opts.speed || 1.0,
            isPlaying: false, lastFrameTime: 0, animId: null,
            canvas: canvas, ctx: ctx, pixelsPerSecond: pps,
            leftMargin: 36, rightMargin: 44, topMargin: 8, playheadY: 0.18,
            seekPending: false, destroyed: false, lastPlayedIndex: -1,
            mode: opts.mode || 'synth', // 'synth' or 'mcsound'
            instCount: instCount,
            // 歌词显示
            lyricManager: opts.lyricManager || null,
            lyricDisplayEnabled: !!opts.lyricDisplayEnabled,
            lyricSongName: opts.lyricSongName || '',
            _lastLyricIdx: -2,
            _lastLyricUpdate: 0,
            _selectedTimeMs: -1, // 用户点击/拖拽选中的时间（虚线指示）
            // 歌词编辑回调
            onTimeSelected: opts.onTimeSelected || null,   // function(snappedTimeMs, rawClickMs)
            onLyricTimeChanged: opts.onLyricTimeChanged || null, // function(lyricIndex, newTimeMs)
            onLyricEdit: opts.onLyricEdit || null          // function(lyricIndex, text, timeMs)
        };
        instances[containerId] = state;

        // 动态设置歌词管理器的便捷方法
        state.setLyricManager = function(mgr, enabled, songName) {
            state.lyricManager = mgr || null;
            // 只要传入了管理器就默认开启显示；enabled 显式 false 时关闭
            if (arguments.length >= 2) {
                state.lyricDisplayEnabled = !!enabled && !!mgr;
            } else {
                state.lyricDisplayEnabled = !!mgr;
            }
            if (songName !== undefined) state.lyricSongName = songName;
            state._lastLyricIdx = -2; // 强制下次 render 刷新
            // 立即重绘；再 rAF 一次，避免容器刚 display:block 时宽高为 0
            try { renderFrame(state); } catch (e) {}
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(function() {
                    if (state.destroyed) return;
                    try {
                        resizeCanvas(state);
                        renderFrame(state);
                    } catch (e2) {}
                });
            }
        };

        // 若页面在瀑布流创建前就准备好了歌词预览，仅挂到命令预览（mcsound）瀑布流
        // 合成音瀑布流不显示字幕预览
        if (!state.lyricManager && state.mode === 'mcsound'
            && window._pendingLyricPreview && window._pendingLyricPreview.mgr) {
            state.lyricManager = window._pendingLyricPreview.mgr;
            state.lyricDisplayEnabled = true;
            state.lyricSongName = window._pendingLyricPreview.songName || '';
            state.lyricMarkerMode = window._pendingLyricPreview.markerMode || 'phrase';
            state.lyricMarkers = window._pendingLyricPreview.markers || [];
        }

        resizeCanvas(state);

        // ---- Canvas click: add new lyric or edit existing ----
        // 拖拽结束后短时抑制 click，避免 mouseup 后的 click 误触发编辑
        state._dragLyricIdx = -1;
        state._suppressClickUntil = 0;
        canvas.addEventListener('click', function(e) {
            if (performance.now() < state._suppressClickUntil) return;

            var rect = canvas.getBoundingClientRect();
            var cssY = e.clientY - rect.top;
            var dpr = state.dpr;
            var devY = cssY * dpr;
            var clickTimeMs = state.currentTime + (devY - state.height * state.playheadY) / state.pixelsPerMs;
            clickTimeMs = Math.max(0, Math.min(state.timeTotal, clickTimeMs));
            var snapped = snapToNearestNote(state, clickTimeMs);

            // 优先命中已有歌词标记（精确时间附近，默认 80ms）
            if (state.lyricDisplayEnabled) {
                var markList = (state.lyricMarkers && state.lyricMarkers.length)
                    ? state.lyricMarkers
                    : (state.lyricManager && state.lyricManager.lyrics) || [];
                var bestLi = -1;
                var bestDist = 80;
                for (var li = 0; li < markList.length; li++) {
                    var lyricMs = markList[li].time_ms;
                    var d1 = Math.abs(lyricMs - clickTimeMs);
                    var d2 = Math.abs(lyricMs - snapped);
                    var d = Math.min(d1, d2);
                    if (d < bestDist) {
                        bestDist = d;
                        bestLi = li;
                    }
                }
                if (bestLi >= 0) {
                    var hit = markList[bestLi];
                    state._selectedTimeMs = hit.time_ms;
                    state._selectedTimeIsDrag = false;
                    renderFrame(state);
                    var hitText = hit.displayText != null ? hit.displayText : (hit.text || '');
                    if (typeof state.onLyricEdit === 'function') {
                        state.onLyricEdit(bestLi, hitText, hit.time_ms);
                    } else if (typeof state.onTimeSelected === 'function') {
                        state.onTimeSelected(hit.time_ms, clickTimeMs);
                    }
                    return;
                }
            }

            // 没有匹配到已有歌词 → 添加模式：标记选中点
            state._selectedTimeMs = snapped;
            state._selectedTimeIsDrag = false;
            state._lastLyricIdx = -2;
            renderFrame(state);
            if (typeof state.onTimeSelected === 'function') {
                state.onTimeSelected(snapped, clickTimeMs);
            }
        });

        // ---- Canvas scroll wheel ----
        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            var delta = e.deltaY > 0 ? 500 : -500;
            state.currentTime = Math.max(0, Math.min(state.timeTotal, state.currentTime + delta));
            state.lastPlayedIndex = -1;
            state._lastLyricIdx = -2;
            state._selectedTimeIsDrag = false;
            renderFrame(state);
            var pfx = state.containerId.replace(/[^a-zA-Z0-9]/g, '_');
            var slider = document.getElementById(pfx + '_progress');
            if (slider) { slider.value = Math.round((state.currentTime / state.timeTotal) * 1000); updateProgressFill(slider, state.currentTime / state.timeTotal); }
            var timeEl = document.getElementById(pfx + '_current');
            if (timeEl) timeEl.textContent = formatTime(state.currentTime);
        }, { passive: false });

        // ---- Drag lyric markers ----
        canvas.addEventListener('mousedown', function(e) {
            var rect = canvas.getBoundingClientRect();
            var devY = (e.clientY - rect.top) * state.dpr;
            var clickMs = state.currentTime + (devY - state.height * state.playheadY) / state.pixelsPerMs;
            state._dragLyricIdx = -1;
            state._dragStartMs = clickMs; // 记录起始位置（未弱吸附前的原始值）
            var dragList = (state.lyricMarkers && state.lyricMarkers.length)
                ? state.lyricMarkers
                : (state.lyricManager && state.lyricManager.lyrics) || [];
            if (!dragList.length) return;
            for (var li = 0; li < dragList.length; li++) {
                var dt = Math.abs(dragList[li].time_ms - clickMs);
                if (dt < 80) { state._dragLyricIdx = li; break; }
            }
        });
        document.addEventListener('mousemove', function(e) {
            if (state._dragLyricIdx < 0) return;
            var dragList = (state.lyricMarkers && state.lyricMarkers.length)
                ? state.lyricMarkers
                : (state.lyricManager && state.lyricManager.lyrics) || [];
            if (!dragList.length || state._dragLyricIdx >= dragList.length) return;
            var rect = canvas.getBoundingClientRect();
            var devY = (e.clientY - rect.top) * state.dpr;
            var rawMs = state.currentTime + (devY - state.height * state.playheadY) / state.pixelsPerMs;
            rawMs = Math.max(0, Math.min(state.timeTotal, rawMs));
            var snappedMs = snapToNearestNote(state, rawMs);
            // 弱吸附：如果距离原位置 <200ms，锁定在原位
            var dragDelta = Math.abs(rawMs - state._dragStartMs);
            var newTimeMs = dragDelta < 200
                ? dragList[state._dragLyricIdx].time_ms
                : snappedMs;
            if (typeof state.onLyricTimeChanged === 'function') {
                // 传入标记时间点，编辑器按精确时间改标签
                state.onLyricTimeChanged(state._dragLyricIdx, Math.round(newTimeMs), dragList[state._dragLyricIdx].time_ms);
            }
            state._selectedTimeMs = newTimeMs;
            state._selectedTimeIsDrag = true;
        });
        document.addEventListener('mouseup', function() {
            if (state._dragLyricIdx >= 0) {
                state._selectedTimeIsDrag = false;
                state._suppressClickUntil = performance.now() + 250;
            }
            state._dragLyricIdx = -1;
        });
        document.addEventListener('mouseleave', function() {
            if (state._dragLyricIdx >= 0) {
                state._selectedTimeIsDrag = false;
                state._suppressClickUntil = performance.now() + 250;
            }
            state._dragLyricIdx = -1;
        });

        window.addEventListener('resize', function() { if (!state.destroyed) resizeCanvas(state); });

        renderFrame(state);
        return state;
    }

    function snapToNearestNote(state, timeMs) {
        if (!state.notes || !state.notes.length) return Math.round(timeMs);
        var best = state.notes[0].playTime, bestD = Math.abs(best - timeMs);
        for (var si = 1; si < state.notes.length; si++) {
            var d = Math.abs(state.notes[si].playTime - timeMs);
            if (d < bestD) { bestD = d; best = state.notes[si].playTime; }
        }
        return Math.round(best);
    }

    window.snapToNearestNote = snapToNearestNote;

    // ---- Initializers ----
    window.initWaterfall = function(containerId, midiFile, opts) {
        opts = opts || {};
        opts.mode = 'synth';
        var state = createWaterfall(containerId, midiFile, opts);
        if (!state) return;
        bindControls(state, containerId);
        preloadMCSounds();
        return state;
    };

    window.initMCSoundWaterfall = function(containerId, midiFile, opts) {
        opts = opts || {};
        opts.mode = 'mcsound';
        opts.fixedDuration = true;
        var state = createWaterfall(containerId, midiFile, opts);
        if (!state) return;
        bindControls(state, containerId);
        preloadMCSounds();
        return state;
    };

    /**
     * 获取指定瀑布流实例的状态对象
     * @param {string} containerId
     * @returns {object|null}
     */
    window.getWaterfallState = function(containerId) {
        return instances[containerId] || null;
    };

    // ---- Bind controls with unique IDs ----
    function bindControls(state, containerId) {
        var prefix = containerId.replace(/[^a-zA-Z0-9]/g, '_');

        var playBtn = document.getElementById(prefix + '_play');
        var stopBtn = document.getElementById(prefix + '_stop');
        var speedSelect = document.getElementById(prefix + '_speed');
        var progressSlider = document.getElementById(prefix + '_progress');
        var currentTimeEl = document.getElementById(prefix + '_current');
        var totalTimeEl = document.getElementById(prefix + '_total');

        if (totalTimeEl) totalTimeEl.textContent = formatTime(state.timeTotal);
        if (progressSlider) updateProgressFill(progressSlider, 0);

        if (playBtn) {
            playBtn.onclick = function() {
                if (state.currentTime >= state.timeTotal) { state.currentTime = 0; state.lastPlayedIndex = -1; }
                state.isPlaying = !state.isPlaying;
                playBtn.textContent = state.isPlaying ? '暂停' : '播放';
                if (state.isPlaying) { state.lastFrameTime = performance.now(); if (!state.animId) loop(state); }
            };
        }
        if (stopBtn) {
            stopBtn.onclick = function() {
                state.isPlaying = false; state.currentTime = 0; state.lastPlayedIndex = -1;
                state._lastLyricIdx = -2; state._lastLyricUpdate = 0;
                if (playBtn) playBtn.textContent = '播放';
                if (progressSlider) { progressSlider.value = 0; updateProgressFill(progressSlider, 0); }
                if (currentTimeEl) currentTimeEl.textContent = '0:00';
                if (state.animId) { cancelAnimationFrame(state.animId); state.animId = null; }
                renderFrame(state);
            };
        }
        if (speedSelect) {
            speedSelect.onchange = function() { state.speed = parseFloat(speedSelect.value); };
        }
        if (progressSlider) {
            progressSlider.oninput = function() {
                state.currentTime = (progressSlider.value / 1000) * state.timeTotal;
                state.seekPending = true; state.lastPlayedIndex = -1;
                state._lastLyricIdx = -2; // 强制刷新歌词
                if (currentTimeEl) currentTimeEl.textContent = formatTime(state.currentTime);
                updateProgressFill(progressSlider, state.currentTime / state.timeTotal);
                if (!state.isPlaying) renderFrame(state);
            };
        }
    }

    // ---- Canvas resize ----
    function resizeCanvas(state) {
        var container = state.canvas.parentElement;
        if (!container) return;
        var w = container.getBoundingClientRect().width || 600;
        var h = Math.max(200, Math.min(500, window.innerHeight * 0.4));
        var dpr = window.devicePixelRatio || 1;
        state.canvas.width = w * dpr;
        state.canvas.height = h * dpr;
        state.canvas.style.width = w + 'px';
        state.canvas.style.height = h + 'px';
        state.width = state.canvas.width;
        state.height = state.canvas.height;
        state.dpr = dpr;
        state.columnWidth = (state.width - state.leftMargin * dpr - state.rightMargin * dpr) / 128;
        state.pixelsPerMs = state.pixelsPerSecond / 1000 * dpr;
        if (!state.isPlaying) renderFrame(state);
    }

    // ---- Main loop ----
    function loop(state) {
        if (state.destroyed) return;
        var now = performance.now();
        if (state.isPlaying) {
            var delta = now - state.lastFrameTime;
            state.currentTime += delta * state.speed;
            if (state.currentTime >= state.timeTotal) {
                state.currentTime = state.timeTotal; state.isPlaying = false;
                var prefix = state.containerId.replace(/[^a-zA-Z0-9]/g, '_');
                var playBtn = document.getElementById(prefix + '_play');
                if (playBtn) playBtn.textContent = '播放';
            }

            var progress = Math.min(1, state.currentTime / state.timeTotal);
            var prefix = state.containerId.replace(/[^a-zA-Z0-9]/g, '_');
            var slider = document.getElementById(prefix + '_progress');
            if (slider && !state.seekPending) { slider.value = Math.round(progress * 1000); updateProgressFill(slider, progress); }
            var timeEl = document.getElementById(prefix + '_current');
            if (timeEl) timeEl.textContent = formatTime(state.currentTime);

            // Trigger sounds
            var prevTime = state.currentTime - (now - state.lastFrameTime) * state.speed * 1.5;
            if (prevTime < 0) prevTime = 0;
            var noteIdx = state.lastPlayedIndex + 1;
            if (noteIdx < 0) noteIdx = 0;
            while (noteIdx < state.notes.length && state.notes[noteIdx].playTime <= state.currentTime) {
                var n = state.notes[noteIdx];
                if (n.playTime >= prevTime) {
                    if (state.mode === 'synth') {
                        var vol = 0.1 + Math.pow(n.velocity / 127, 0.6) * 0.55;
                        playSynthNote(n.pitch, vol);
                    } else if (state.mode === 'mcsound') {
                        // Use per-page sound lookup function
                        var soundName = 'harp';
                        if (typeof window.getSoundForNote === 'function') {
                            soundName = window.getSoundForNote(n.track, n.channel, n.pitch, n.playTime).replace('note.', '');
                        } else {
                            if (n.channel === 9) soundName = 'bd';
                        }
                        var vol = 0.1 + Math.pow(n.velocity / 127, 0.6) * 0.55;
                        playMCSound(soundName, n.pitch, vol);
                    }
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

    // ---- Render ----
    function renderFrame(state) {
        var ctx = state.ctx, w = state.width, h = state.height, dpr = state.dpr;
        var colW = state.columnWidth, lm = state.leftMargin * dpr, rm = state.rightMargin * dpr, tm = state.topMargin * dpr;
        var playheadY = h * state.playheadY;

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, w, h);

        ctx.font = (10 * dpr) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';

        for (var p = 0; p < 128; p++) {
            var x = lm + p * colW + colW / 2;
            if (p % 12 === 0) {
                ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, tm); ctx.lineTo(x, h); ctx.stroke();
                ctx.fillStyle = '#94a3b8';
                ctx.fillText('C' + (Math.floor(p / 12) - 1), x - 2, h - 12 * dpr);
            } else if (p % 2 === 0) {
                ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo(x, tm); ctx.lineTo(x, h); ctx.stroke();
            }
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = '#94a3b8';
        var timeInterval = state.timeTotal > 60000 ? 10000 : (state.timeTotal > 15000 ? 5000 : 2000);
        for (var t = 0; t <= state.timeTotal; t += timeInterval) {
            var y = t * state.pixelsPerMs - getScrollOffset(state);
            if (y >= tm && y <= h) ctx.fillText(formatTime(t), w - rm + 4 * dpr, y);
        }

        var scrollOff = getScrollOffset(state);
        var visibleTop = tm - 50 * dpr, visibleBottom = h + 50 * dpr;
        for (var i = 0; i < state.notes.length; i++) {
            var note = state.notes[i];
            var noteY = note.playTime * state.pixelsPerMs - scrollOff;
            var noteH = Math.max(2 * dpr, note.duration * state.pixelsPerMs);
            if (noteY + noteH < visibleTop || noteY > visibleBottom) continue;

            var noteX = lm + note.pitch * colW + 1;
            var noteW = Math.max(2 * dpr, colW - 2);
            var color;
            if (state.mode === 'mcsound' && note.soundIdx !== undefined) {
                if (note.soundIdx === -1) {
                    color = DEFAULT_INSTR_COLOR;
                } else {
                    color = INSTRUMENT_COLORS[note.soundIdx % INSTRUMENT_COLORS.length];
                }
            } else {
                color = CHANNEL_COLORS[note.channel % CHANNEL_COLORS.length];
            }
            var alpha = 0.4 + (note.velocity / 127) * 0.6;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;

            var r = Math.max(1, 2 * dpr);
            ctx.beginPath();
            ctx.moveTo(noteX + r, noteY);
            ctx.lineTo(noteX + noteW - r, noteY);
            ctx.quadraticCurveTo(noteX + noteW, noteY, noteX + noteW, noteY + r);
            ctx.lineTo(noteX + noteW, noteY + noteH - r);
            ctx.quadraticCurveTo(noteX + noteW, noteY + noteH, noteX + noteW - r, noteY + noteH);
            ctx.lineTo(noteX + r, noteY + noteH);
            ctx.quadraticCurveTo(noteX, noteY + noteH, noteX, noteY + noteH - r);
            ctx.lineTo(noteX, noteY + r);
            ctx.quadraticCurveTo(noteX, noteY, noteX + r, noteY);
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = Math.max(1, 2 * dpr);
        ctx.setLineDash([6 * dpr, 4 * dpr]);
        ctx.beginPath(); ctx.moveTo(lm, playheadY); ctx.lineTo(w - rm + 12 * dpr, playheadY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath(); ctx.moveTo(lm - 6 * dpr, playheadY);
        ctx.lineTo(lm, playheadY - 4 * dpr); ctx.lineTo(lm, playheadY + 4 * dpr);
        ctx.closePath(); ctx.fill();

        // 歌词覆盖层：内容变化时立即刷新；否则节流到 1 秒
        if (state.lyricManager && state.lyricDisplayEnabled) {
            var curIdx = state.lyricManager.getCurrentIndex(state.currentTime);
            var perfNow = performance.now();
            if (curIdx !== state._lastLyricIdx || perfNow - state._lastLyricUpdate > 1000) {
                drawLyricOverlay(state);
                state._lastLyricIdx = curIdx;
                state._lastLyricUpdate = perfNow;
            } else {
                // 重绘上一次的覆盖层（每帧都要重绘，因为 canvas 被清空过）
                drawLyricOverlay(state);
            }
        }

        // ---- Lyric time markers (drag handles) ----
        drawLyricMarkers(state);
    }

    function getScrollOffset(state) {
        // 蓝线固定在 82% 高度处, 已播放的音符往上滚出视野
        // 未播放的音符从下方出现, 向蓝线移动
        return state.currentTime * state.pixelsPerMs - state.height * state.playheadY;
    }

    function drawLyricMarkers(state) {
        // ---- 选中时间虚线指示（始终显示，不受 lyricManager 控制） ----
        if (state._selectedTimeMs !== undefined && state._selectedTimeMs >= 0) {
            var ctx = state.ctx, w = state.width, h = state.height, dpr = state.dpr;
            var lm = state.leftMargin * dpr, rm = state.rightMargin * dpr, tm = state.topMargin * dpr;
            var overlayTop = h - 76 * dpr;
            var scrollOff = getScrollOffset(state);
            var selY = state._selectedTimeMs * state.pixelsPerMs - scrollOff;
            if (selY >= tm && selY <= overlayTop) {
                ctx.strokeStyle = state._selectedTimeIsDrag ? 'rgba(148,163,184,0.7)' : 'rgba(148,163,184,0.5)';
                ctx.lineWidth = Math.max(1, 1.5 * dpr);
                ctx.setLineDash([4 * dpr, 6 * dpr]);
                ctx.beginPath();
                ctx.moveTo(lm, selY);
                ctx.lineTo(w - rm + 8 * dpr, selY);
                ctx.stroke();
                ctx.setLineDash([]);
                // 左侧淡色小三角箭头
                ctx.fillStyle = 'rgba(148,163,184,0.6)';
                ctx.beginPath();
                ctx.moveTo(lm - 4 * dpr, selY);
                ctx.lineTo(lm, selY - 3 * dpr);
                ctx.lineTo(lm, selY + 3 * dpr);
                ctx.closePath();
                ctx.fill();
            }
        }

        if (!state.lyricDisplayEnabled) return;
        var markList = (state.lyricMarkers && state.lyricMarkers.length)
            ? state.lyricMarkers
            : ((state.lyricManager && state.lyricManager.lyrics) || []);
        if (!markList.length) return;

        var ctx = state.ctx, w = state.width, h = state.height, dpr = state.dpr;
        var lm = state.leftMargin * dpr, rm = state.rightMargin * dpr, tm = state.topMargin * dpr;
        var overlayTop = h - 76 * dpr; // 底部歌词覆盖层，避免标记压在上面
        var markX = w - rm + 8 * dpr;
        var tri = 5 * dpr;
        var scrollOff = getScrollOffset(state);
        var mode = state.lyricMarkerMode || 'phrase';
        var curIdx = -1;
        var tNow = state.currentTime;
        for (var ci = 0; ci < markList.length; ci++) {
            if (markList[ci].time_ms <= tNow) curIdx = ci; else break;
        }

        // ---- 右侧歌词时间标记 ----
        for (var li = 0; li < markList.length; li++) {
            var mark = markList[li];
            var mY = mark.time_ms * state.pixelsPerMs - scrollOff;
            if (mY < tm || mY > overlayTop) continue;

            // phrase 模式：仅乐句起点画虚线；syllable 模式：每个音节都可有短虚线
            var isFullLine = mode === 'phrase'
                ? (mark.isPhraseStart !== false)
                : !!mark.isPhraseStart;
            if (isFullLine) {
                ctx.strokeStyle = 'rgba(148,163,184,0.2)';
                ctx.lineWidth = Math.max(1, 1 * dpr);
                ctx.setLineDash([3 * dpr, 6 * dpr]);
                ctx.beginPath(); ctx.moveTo(lm, mY); ctx.lineTo(w - rm, mY); ctx.stroke();
                ctx.setLineDash([]);
            }

            var isCur = (li === curIdx);
            var isDrag = (li === state._dragLyricIdx);
            ctx.fillStyle = isDrag ? '#ef4444' : (isCur ? '#f59e0b' : '#94a3b8');
            ctx.beginPath();
            ctx.moveTo(markX, mY);
            ctx.lineTo(markX + tri, mY - tri);
            ctx.lineTo(markX + tri, mY + tri);
            ctx.closePath();
            ctx.fill();

            // 显示时间文本 + 歌词缩略
            var timeStr = formatTime(mark.time_ms);
            ctx.font = (9 * dpr) + 'px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';
            ctx.fillStyle = isCur ? '#f59e0b' : '#94a3b8';
            ctx.fillText(timeStr, markX - 3 * dpr, mY);

            var preview = '';
            if (mode === 'syllable') {
                // 音节模式：每个标记显示自身音节文本
                preview = (mark.displayText != null ? mark.displayText : (mark.text || ''));
            } else if (isFullLine) {
                // 乐句模式：起点显示整句
                preview = mark.phraseText || mark.text || '';
            }
            preview = String(preview).replace(/\n/g, ' ');
            if (preview.length > 16) preview = preview.substring(0, 16) + '…';
            if (preview) ctx.fillText(preview, markX - 42 * dpr, mY);
        }
    }

    function findCurrentLyricIndex(state) {
        if (!state.lyricManager || !state.lyricManager.lyrics.length) return -1;
        var lyrics = state.lyricManager.lyrics;
        var t = state.currentTime;
        var idx = -1;
        for (var i = 0; i < lyrics.length; i++) {
            if (lyrics[i].time_ms <= t) idx = i; else break;
        }
        return idx;
    }

    // ---- Lyric overlay ----
    // 将 Minecraft 颜色代码 §X 映射为 canvas 颜色
    var MC_COLOR_MAP = {
        '0': '#000', '1': '#00a', '2': '#0a0', '3': '#0aa',
        '4': '#a00', '5': '#a0a', '6': '#fa0', '7': '#aaa',
        '8': '#555', '9': '#55f', 'a': '#5f5', 'b': '#5ff',
        'c': '#f55', 'd': '#f5f', 'e': '#ff5', 'f': '#fff'
    };

    /**
     * 解析带 § 颜色代码的字符串，返回 [{text, color}] 片段数组
     * 支持 \n 分行
     */
    function parseColoredText(str) {
        if (!str) return [];
        var fragments = [];
        var currentColor = '#aaa';
        var lines = str.split('\n');

        for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            var i = 0;
            while (i < line.length) {
                if (line[i] === '§' || line[i] === 'Â' && line[i + 1] === '§') {
                    // 处理 UTF-8 编码的 § (0xC2A7)
                    var colorIdx;
                    if (line[i] === '§') {
                        colorIdx = i + 1;
                        i += 2;
                    } else {
                        colorIdx = i + 2;
                        i += 3;
                    }
                    if (colorIdx < line.length) {
                        var code = line[colorIdx].toLowerCase();
                        if (MC_COLOR_MAP[code]) currentColor = MC_COLOR_MAP[code];
                    }
                } else {
                    // 收集连续普通文本
                    var start = i;
                    while (i < line.length && line[i] !== '§' && !(line[i] === 'Â' && line[i + 1] === '§')) i++;
                    fragments.push({ text: line.slice(start, i), color: currentColor });
                }
            }
            if (li < lines.length - 1) {
                fragments.push({ text: '\n', color: currentColor });
            }
        }
        return fragments;
    }

    /**
     * 在画布底部绘制歌词覆盖层（模拟 titleraw actionbar 效果）
     * 直接按 LyricManager 数据绘制，避免 JSON 往返解析失败导致预览空白
     */
    function drawLyricOverlay(state) {
        if (!state.lyricManager || !state.lyricDisplayEnabled) return;

        var ctx = state.ctx, w = state.width, h = state.height, dpr = state.dpr || 1;
        if (!ctx || !w || !h) return;

        var mgr = state.lyricManager;
        var t = state.currentTime || 0;
        var songName = state.lyricSongName || '';

        // 底部区域高度：约 76px（含 padding）
        var overlayHeight = 76 * dpr;
        var overlayY = h - overlayHeight;

        // 半透明背景
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, overlayY, w, overlayHeight);

        // 取上一句 / 当前 / 下一句
        var idx = -1;
        try { idx = mgr.getCurrentIndex(t); } catch (e) { idx = -1; }
        var prev = '';
        var next = '';
        var currText = '';
        try {
            prev = idx > 0 ? (mgr.getLyricAt(idx - 1) || '') : '';
            next = (idx >= 0 && idx < mgr.lyrics.length - 1) ? (mgr.getLyricAt(idx + 1) || '') : '';
            var currSentence = idx >= 0 ? mgr.lyrics[idx] : null;
            if (currSentence && currSentence.syllables && typeof mgr.buildSyllableLine === 'function') {
                currText = mgr.buildSyllableLine(currSentence, t) || '';
            } else if (currSentence) {
                currText = '§f' + (currSentence.text || '');
            } else {
                currText = '§f';
            }
        } catch (e2) {
            currText = '§f';
        }

        var progress = mgr.totalMs > 0 ? Math.min(1, t / mgr.totalMs) : 0;
        var bar = '';
        var timeStr = '0:00';
        var remainStr = '0:00';
        var totalStr = '0:00';
        try {
            bar = mgr.buildProgressBar(progress);
            timeStr = mgr.formatTime(t);
            remainStr = mgr.formatTime(Math.max(0, mgr.totalMs - t));
            totalStr = mgr.formatTime(mgr.totalMs);
        } catch (e3) {
            var filled = Math.round(progress * 20);
            bar = '§a' + new Array(filled + 1).join('-') + '§7' + new Array(20 - filled + 1).join('-');
        }

        // 与 buildTitleCommand 一致的四行文本
        var esc = function(s) { return String(s || '').replace(/§/g, ''); };
        var textContent = '§7' + esc(prev)
            + '\n' + currText
            + '\n§7' + esc(next)
            + '\n§7[' + bar + '§7] §f' + timeStr + ' §7/ -' + remainStr + ' §8(' + totalStr + ') §e' + esc(songName);

        var fragments = parseColoredText(textContent);

        var fontSize = 11 * dpr;
        ctx.font = fontSize + 'px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        var lineX = 6 * dpr;
        var lineY = overlayY + 6 * dpr;
        var lineHeight = fontSize * 1.35;

        for (var fi = 0; fi < fragments.length; fi++) {
            var frag = fragments[fi];
            if (frag.text === '\n') {
                lineX = 6 * dpr;
                lineY += lineHeight;
                continue;
            }
            ctx.fillStyle = frag.color;
            ctx.fillText(frag.text, lineX, lineY);
            lineX += ctx.measureText(frag.text).width;
        }
    }

})();

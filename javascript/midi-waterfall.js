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
            // No lookup table available (midi2tiles etc.), all notes get -1
            for (var j = 0; j < notes.length; j++) notes[j].soundIdx = -1;
            return 0;
        }
        // Build playList to get event order with track/channel info
        var playList = midiFile.getEvents([MIDIEvents.EVENT_MIDI],[MIDIEvents.EVENT_MIDI_PROGRAM_CHANGE, MIDIEvents.EVENT_MIDI_NOTE_ON], [], true)[0];
        playList.sort(function(a,b){return a.playTime-b.playTime});

        // Detect lookup style: channel-based (midiconvertor) or track+channel-based (midi2mcfunction)
        var useChannelLookup = rowLookup['c0'] !== undefined || rowLookup['c1'] !== undefined;

        for (var j = 0; j < notes.length; j++) {
            var n = notes[j];
            if (n.channel === 9) {
                var pkey = undefined;
                if (rowLookup[n.track]) pkey = rowLookup[n.track]['p' + n.pitch];
                if (pkey === undefined && rowLookup['perc']) pkey = rowLookup['perc']['p' + n.pitch];
                n.soundIdx = pkey !== undefined ? pkey : -1;
            } else {
                var rowIdx = -1;
                var pcList, key;
                if (useChannelLookup) {
                    key = 'c' + n.channel;
                    pcList = rowLookup[key];
                } else {
                    pcList = rowLookup[n.track] ? rowLookup[n.track][n.channel] : undefined;
                }
                if (pcList && pcList.length > 0) {
                    var cnt = 0;
                    for (var i = 0; i < playList.length; i++) {
                        var ev = playList[i];
                        if (ev.channel !== 9 && ev.subtype === 0xc && ev.playTime <= n.playTime) {
                            if (useChannelLookup) {
                                if (ev.channel === n.channel) cnt++;
                            } else {
                                if (ev.track === n.track && ev.channel === n.channel) cnt++;
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
            instCount: instCount
        };
        instances[containerId] = state;

        resizeCanvas(state);
        window.addEventListener('resize', function() { if (!state.destroyed) resizeCanvas(state); });

        renderFrame(state);
        return state;
    }

    function buildStateKey(containerId) {
        return containerId;
    }

    // ---- Initializers ----
    window.initWaterfall = function(containerId, midiFile, opts) {
        opts = opts || {};
        opts.mode = 'synth';
        var state = createWaterfall(containerId, midiFile, opts);
        if (!state) return;
        bindControls(state, containerId);
        preloadMCSounds();
    };

    window.initMCSoundWaterfall = function(containerId, midiFile, opts) {
        opts = opts || {};
        opts.mode = 'mcsound';
        opts.fixedDuration = true;
        var state = createWaterfall(containerId, midiFile, opts);
        if (!state) return;
        bindControls(state, containerId);
        preloadMCSounds();
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
                        // Try to find the sound name from the global soundStrings
                        var soundName = 'harp';
                        if (n.channel === 9) {
                            soundName = 'bd';
                        } else if (typeof soundStrings !== 'undefined' && soundStrings && soundStrings[n.channel]) {
                            var chArr = soundStrings[n.channel];
                            if (chArr && chArr.length > 0) {
                                var last = chArr[chArr.length - 1];
                                if (last && last[0]) soundName = last[0].replace('note.', '');
                            }
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
    }

    function getScrollOffset(state) {
        // 蓝线固定在 82% 高度处, 已播放的音符往上滚出视野
        // 未播放的音符从下方出现, 向蓝线移动
        return state.currentTime * state.pixelsPerMs - state.height * state.playheadY;
    }

})();

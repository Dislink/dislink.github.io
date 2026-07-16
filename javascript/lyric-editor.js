/**
 * lyric-editor.js — 瀑布流歌词编辑 UI 的共享逻辑
 *
 * 依赖: lyric.js (LyricParser / LyricManager)
 *       midi-waterfall.js (getWaterfallState)
 *
 * 用法:
 *   var editor = LyricEditor.init({
 *     waterfallId: 'cmd-preview-container',
 *     onAfterChange: function() { // optional height estimate etc. }
 *   });
 *   // 上传 MIDI 后:
 *   editor.loadFromMidi(midiFile);
 *   // 初始化瀑布流时传入:
 *   initMCSoundWaterfall(id, midiFile, Object.assign(opts, editor.getWaterfallCallbacks()));
 *   // 读取当前管理器 / 是否启用:
 *   editor.getManager(); editor.isEnabled();
 */
(function() {
    'use strict';

    var MATCH_TOLERANCE_MS = 500;

    function $(id) { return document.getElementById(id); }

    function fmtLrcTag(timeMs) {
        var mm = Math.floor(timeMs / 60000);
        var ss = ((timeMs % 60000) / 1000).toFixed(2);
        return '[' + (mm < 10 ? '0' : '') + mm + ':' + (ss.length < 5 ? '0' + ss : ss) + ']';
    }

    function formatEditTime(timeMs) {
        var sec = timeMs / 1000;
        var m = Math.floor(sec / 60);
        var s = (sec % 60).toFixed(2);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    /**
     * 把扁平歌词数组还原为 LRC 文本行。
     * 同一行内多时间标签 = 音节模式；行与行之间换行 = 乐句。
     * 若条目自带 syllables，按音节时间重建多标签行；
     * 否则相邻条目间隔 < 500ms 时合并到同一行。
     */
    function rebuildLrcLines(lyricsArr) {
        if (!lyricsArr || !lyricsArr.length) return [];
        var lines = [];

        function lineFromSyllables(syls) {
            var s = '';
            for (var i = 0; i < syls.length; i++) {
                s += fmtLrcTag(syls[i].time_ms) + syls[i].text;
            }
            return s;
        }

        // 优先：带 syllables 的句子级条目
        if (lyricsArr[0].syllables && lyricsArr[0].syllables.length) {
            for (var i = 0; i < lyricsArr.length; i++) {
                var item = lyricsArr[i];
                if (item.syllables && item.syllables.length) {
                    lines.push(lineFromSyllables(item.syllables));
                } else {
                    lines.push(fmtLrcTag(item.time_ms) + (item.text || ''));
                }
            }
            return lines;
        }

        // 扁平音节/整句：相邻 <500ms 合并为同一 LRC 行
        var result = [{
            time_ms: lyricsArr[0].time_ms,
            text: fmtLrcTag(lyricsArr[0].time_ms) + lyricsArr[0].text
        }];
        for (var j = 1; j < lyricsArr.length; j++) {
            var prev = result[result.length - 1];
            var cur = lyricsArr[j];
            if (cur.time_ms - prev.time_ms < 500) {
                prev.text += fmtLrcTag(cur.time_ms) + cur.text;
            } else {
                result.push({
                    time_ms: cur.time_ms,
                    text: fmtLrcTag(cur.time_ms) + cur.text
                });
            }
        }
        return result.map(function(x) { return x.text; });
    }

    /**
     * 将歌词数组写成 LRC 文本。
     * 有内容时始终以 \n 结尾，保证「添加乐句」后下一句一定换行。
     */
    function lyricsToLrcText(lyricsArr) {
        var lines = rebuildLrcLines(lyricsArr || []);
        if (!lines.length) return '';
        return lines.join('\n') + '\n';
    }

    /**
     * 在 LRC 源文本中查找与 timeMs 最接近的条目。
     * @returns {{index:number, text:string, time_ms:number}|null}
     */
    function findLyricNearTime(lrcText, timeMs, toleranceMs) {
        toleranceMs = toleranceMs == null ? MATCH_TOLERANCE_MS : toleranceMs;
        var lyrics = window.LyricParser.parseLRC(lrcText || '');
        if (!lyrics.length) return null;
        var best = -1;
        var bestD = Infinity;
        for (var i = 0; i < lyrics.length; i++) {
            var d = Math.abs(lyrics[i].time_ms - timeMs);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (best < 0 || bestD > toleranceMs) return null;
        return {
            index: best,
            text: lyrics[best].text,
            time_ms: lyrics[best].time_ms
        };
    }

    /**
     * 初始化页面级歌词编辑器。
     * @param {object} opts
     * @param {string} opts.waterfallId - 命令预览瀑布流 container id（用于选时/推进）
     * @param {string|string[]} [opts.previewWaterfallIds] - 额外需要同步歌词覆盖层的瀑布流 id
     * @param {function} [opts.onAfterChange] - 歌词变更后回调
     * @param {function} [opts.getMidiFile] - 返回当前 midiFile
     * @param {function} [opts.getSongName] - 返回当前歌曲名
     * @param {string} [opts.enableId='enableLyrics']
     * @param {string} [opts.optionsId='lyric_options']
     * @param {string} [opts.textareaId='lyricTextarea']
     * @param {string} [opts.infoId='lyricInfo']
     * @param {string} [opts.lrcUploadId='lrcUpload']
     * @param {string} [opts.overlayId='lyricEditorOverlay']
     * @param {string} [opts.inputId='lyricEditInput']
     * @param {string} [opts.addBtnId='lyricAddBtn']
     * @param {string} [opts.appendBtnId='lyricAppendBtn']
     * @param {string} [opts.timeDisplayId='editTimeDisplay']
     */
    function init(opts) {
        opts = opts || {};
        var waterfallId = opts.waterfallId || 'cmd-preview-container';
        var previewIds = opts.previewWaterfallIds || [];
        if (typeof previewIds === 'string') previewIds = [previewIds];
        // 始终包含编辑用瀑布流本身
        var allWaterfallIds = [waterfallId].concat(previewIds).filter(function(id, i, arr) {
            return id && arr.indexOf(id) === i;
        });
        var enableEl = $(opts.enableId || 'enableLyrics');
        var optionsEl = $(opts.optionsId || 'lyric_options');
        var textarea = $(opts.textareaId || 'lyricTextarea');
        var infoEl = $(opts.infoId || 'lyricInfo');
        var lrcUpload = $(opts.lrcUploadId || 'lrcUpload');
        var overlay = $(opts.overlayId || 'lyricEditorOverlay');
        var input = $(opts.inputId || 'lyricEditInput');
        var addBtn = $(opts.addBtnId || 'lyricAddBtn');
        var appendBtn = $(opts.appendBtnId || 'lyricAppendBtn');
        var timeDisplay = $(opts.timeDisplayId || 'editTimeDisplay');

        var state = {
            lyricMgr: null,
            midiExtractedText: '',
            selectedEditTime: 0,
            editingLyricIdx: -1,
            lyricTimer: null
        };

        function getMidiFile() {
            if (typeof opts.getMidiFile === 'function') return opts.getMidiFile();
            return typeof midiFile !== 'undefined' ? midiFile : null;
        }

        function getSongName() {
            if (typeof opts.getSongName === 'function') return opts.getSongName();
            try {
                if (typeof upload !== 'undefined' && upload.files && upload.files[0]) {
                    return upload.files[0].name.replace(/\.midi?$/i, '');
                }
            } catch (e) {}
            return '';
        }

        function isEnabled() {
            return !!(enableEl && enableEl.checked);
        }

        function getManager() {
            return state.lyricMgr;
        }

        function forEachWaterfall(fn) {
            for (var i = 0; i < allWaterfallIds.length; i++) {
                var st = window.getWaterfallState && window.getWaterfallState(allWaterfallIds[i]);
                if (st) fn(st, allWaterfallIds[i]);
            }
        }

        function updateLyricStatus() {
            var text = (textarea.value || '').trim();
            if (!text) {
                if (infoEl) infoEl.innerText = '已解析 0 条歌词';
                return [];
            }
            var lyrics = window.LyricParser.parseLRC(text);
            var msg = '已解析 ' + lyrics.length + ' 条歌词';
            if (lyrics.length) {
                msg += '（最后时间: ' + new window.LyricManager(lyrics, 0).formatTime(lyrics[lyrics.length - 1].time_ms) + '）';
            }
            if (infoEl) infoEl.innerText = msg;
            return lyrics;
        }

        function refreshLyricManager() {
            // 未勾选：隐藏输入区，关闭预览/编辑，清空挂起的预览
            var enabled = isEnabled();
            if (optionsEl) optionsEl.style.display = enabled ? 'block' : 'none';
            if (!enabled) {
                hideOverlay();
                state.lyricMgr = null;
                window._pendingLyricPreview = null;
                forEachWaterfall(function(wfState) {
                    if (wfState.setLyricManager) wfState.setLyricManager(null, false);
                });
                if (typeof opts.onAfterChange === 'function') opts.onAfterChange();
                return;
            }

            var mf = getMidiFile();
            var text = (textarea && textarea.value) ? String(textarea.value).trim() : '';
            var lyrics;
            // 文本仍是 MIDI 提取原样 → 保留音节级渐进高亮数据
            if (window._rawMidiSyllables && text === state.midiExtractedText) {
                lyrics = window.LyricParser.mergeIntoSentences(window._rawMidiSyllables);
            } else {
                lyrics = text ? window.LyricParser.parseLRC(text) : [];
            }

            var totalMs = 0;
            if (mf && mf.timeTotal) totalMs = mf.timeTotal;
            // 即使 getMidiFile 暂时拿不到对象，也尽量从已有瀑布流状态取总时长
            if (!totalMs) {
                forEachWaterfall(function(wfState) {
                    if (!totalMs && wfState.timeTotal) totalMs = wfState.timeTotal;
                });
            }

            // 仅在启用时，把歌词推送到目标瀑布流（默认命令预览，不含合成音瀑布流）
            if (lyrics.length && totalMs) {
                state.lyricMgr = new window.LyricManager(lyrics, totalMs);
                var songName = getSongName();
                var applied = 0;
                forEachWaterfall(function(wfState) {
                    if (wfState.setLyricManager) {
                        wfState.setLyricManager(state.lyricMgr, true, songName);
                        applied++;
                    }
                });
                // 瀑布流可能尚未初始化：挂到 window，供稍后 init 后再次 refresh
                window._pendingLyricPreview = applied ? null : {
                    mgr: state.lyricMgr,
                    songName: songName
                };
            } else {
                state.lyricMgr = null;
                window._pendingLyricPreview = null;
                forEachWaterfall(function(wfState) {
                    if (wfState.setLyricManager) wfState.setLyricManager(null, false);
                });
            }
            if (typeof opts.onAfterChange === 'function') opts.onAfterChange();
        }

        function showOverlay(timeMs, fillText, mode) {
            // mode: 'add' | 'edit'
            state.selectedEditTime = timeMs;
            if (timeDisplay) timeDisplay.innerText = formatEditTime(timeMs);
            if (overlay) overlay.style.display = 'block';
            if (input) {
                input.value = fillText == null ? '' : fillText;
                input.focus();
                // 编辑时把光标放到末尾，方便继续改
                try {
                    var len = input.value.length;
                    input.setSelectionRange(len, len);
                } catch (e) {}
            }
            if (addBtn) {
                addBtn.textContent = mode === 'edit' ? '修改' : '添加乐句';
            }
        }

        function hideOverlay() {
            if (overlay) overlay.style.display = 'none';
            state.editingLyricIdx = -1;
            if (addBtn) addBtn.textContent = '添加乐句';
        }

        /**
         * 点击瀑布流空白处 / 选中时间点：
         * 若该时间附近已有歌词 → 进入编辑并回填；否则进入新增模式。
         */
        function onTimeSelected(snappedMs, rawMs) {
            if (!isEnabled()) return;
            var match = findLyricNearTime(textarea.value, snappedMs, MATCH_TOLERANCE_MS);
            if (!match && rawMs != null) {
                match = findLyricNearTime(textarea.value, rawMs, MATCH_TOLERANCE_MS);
            }
            if (match) {
                state.editingLyricIdx = match.index;
                showOverlay(match.time_ms, match.text, 'edit');
                // 同步瀑布流选中线到真实歌词时间
                var wfState = window.getWaterfallState && window.getWaterfallState(waterfallId);
                if (wfState) {
                    wfState._selectedTimeMs = match.time_ms;
                    wfState._selectedTimeIsDrag = false;
                }
                return;
            }
            state.editingLyricIdx = -1;
            showOverlay(snappedMs, '', 'add');
        }

        /** 点击时间轴上已有歌词标记 → 编辑 */
        function onLyricEdit(idx, text, timeMs) {
            if (!isEnabled()) return;
            state.editingLyricIdx = idx;
            // 有音节时，编辑框填整句文本（不含时间标签），用户改的是整句内容
            showOverlay(timeMs, text || '', 'edit');
        }

        /** 拖拽歌词时间标记 */
        function onLyricTimeChanged(idx, newTimeMs) {
            if (!isEnabled()) return;
            var src = (textarea.value || '').trim();
            if (!src) return;
            var currentLyrics = window.LyricParser.parseLRC(src);
            if (!currentLyrics.length || idx < 0 || idx >= currentLyrics.length) return;

            // 保留 syllables：只平移整句起点，音节相对间隔不变
            var old = currentLyrics[idx];
            var delta = Math.round(newTimeMs) - old.time_ms;
            var updated = { time_ms: Math.round(newTimeMs), text: old.text };
            if (old.syllables && old.syllables.length) {
                updated.syllables = old.syllables.map(function(s) {
                    return { time_ms: s.time_ms + delta, text: s.text };
                });
            }
            currentLyrics[idx] = updated;
            currentLyrics.sort(function(a, b) { return a.time_ms - b.time_ms; });
            textarea.value = lyricsToLrcText(currentLyrics);
            window._rawMidiSyllables = null;
            window._manualLyricMode = true;
            updateLyricStatus();
            refreshLyricManager();
        }

        function advanceToNextNote() {
            var wfState = window.getWaterfallState && window.getWaterfallState(waterfallId);
            if (!wfState || !wfState.notes || !wfState.notes.length) return;
            var found = false;
            for (var ni = 0; ni < wfState.notes.length; ni++) {
                if (wfState.notes[ni].playTime > state.selectedEditTime + 50) {
                    state.selectedEditTime = wfState.notes[ni].playTime;
                    found = true;
                    break;
                }
            }
            if (!found) return;
            wfState._selectedTimeMs = state.selectedEditTime;
            wfState._selectedTimeIsDrag = false;
            if (timeDisplay) timeDisplay.innerText = formatEditTime(state.selectedEditTime);
            // 推进后若新时间点已有内容，回填供继续编辑；否则清空输入
            var match = findLyricNearTime(textarea.value, state.selectedEditTime, MATCH_TOLERANCE_MS);
            if (match) {
                state.editingLyricIdx = match.index;
                if (input) input.value = match.text;
                if (addBtn) addBtn.textContent = '修改';
            } else {
                state.editingLyricIdx = -1;
                if (input) input.value = '';
                if (addBtn) addBtn.textContent = '添加乐句';
            }
        }

        // ---- 按钮：添加乐句（独立成行，行尾固定 \n）----
        if (addBtn) {
            addBtn.onclick = function() {
                var text = (input.value || '').trim();
                if (!text) return;
                window._rawMidiSyllables = null;
                window._manualLyricMode = true;

                if (state.editingLyricIdx >= 0) {
                    // 修改：替换指定句文本后整表重建（保留行尾 \n）
                    var currentLyrics = window.LyricParser.parseLRC((textarea.value || '').trim());
                    if (state.editingLyricIdx < currentLyrics.length) {
                        currentLyrics[state.editingLyricIdx] = {
                            time_ms: currentLyrics[state.editingLyricIdx].time_ms,
                            text: text
                        };
                        currentLyrics.sort(function(a, b) { return a.time_ms - b.time_ms; });
                        textarea.value = lyricsToLrcText(currentLyrics);
                    }
                } else {
                    // 添加乐句：字符串直接写入，不走 parse/rebuild（避免 <500ms 合并吞换行）
                    // 结果形如："[00:02.13]lyric 111 2222 333 4444\n"
                    var prev = textarea.value || '';
                    if (prev.length && !/\n$/.test(prev)) prev += '\n';
                    textarea.value = prev + fmtLrcTag(state.selectedEditTime) + text + '\n';
                }
                state.editingLyricIdx = -1;
                hideOverlay();
                if (input) input.value = '';
                updateLyricStatus();
                refreshLyricManager();
            };
        }

        // ---- 按钮：添加音节（不主动换行；若上一条是乐句已有 \n，则自然起新行）----
        if (appendBtn) {
            appendBtn.onclick = function() {
                // 保留用户输入的首尾空格（单词间距）
                var appendText = input ? input.value : '';
                if (!appendText || !appendText.replace(/\s/g, '').length) return;
                window._rawMidiSyllables = null;
                window._manualLyricMode = true;

                // 关键：不要 strip 尾部 \n！
                // - 上一操作是「添加乐句」→ 文本以 \n 结尾 → 音节从新行开始
                // - 上一操作是「添加音节」→ 文本不以 \n 结尾 → 音节黏在同一行
                //   例: [00:01.00]a[00:01.20]b
                var prev = textarea.value || '';
                textarea.value = prev + fmtLrcTag(state.selectedEditTime) + appendText;

                if (input) input.value = '';
                updateLyricStatus();
                refreshLyricManager();
                advanceToNextNote();
                if (input) input.focus();
            };
        }

        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // Enter = 添加乐句（换行语义）；Shift+Enter 也可当音节
                    if (e.shiftKey && appendBtn) appendBtn.click();
                    else if (addBtn) addBtn.click();
                } else if (e.key === 'Escape') {
                    hideOverlay();
                }
            });
        }

        if (enableEl) {
            enableEl.onchange = function() { refreshLyricManager(); };
        }

        if (lrcUpload) {
            lrcUpload.onchange = function() {
                if (!this.files || !this.files[0]) return;
                var r = new FileReader();
                r.onload = function() {
                    textarea.value = r.result;
                    window._rawMidiSyllables = null;
                    window._manualLyricMode = true;
                    updateLyricStatus();
                    refreshLyricManager();
                };
                r.readAsText(this.files[0]);
            };
        }

        if (textarea) {
            textarea.oninput = function() {
                if (state.lyricTimer) clearTimeout(state.lyricTimer);
                state.lyricTimer = setTimeout(function() {
                    // 用户手动改文本后不再视为 MIDI 原样
                    window._manualLyricMode = true;
                    updateLyricStatus();
                    refreshLyricManager();
                }, 300);
            };
        }

        /**
         * 从 MIDI 提取歌词并填入文本域（不强制启用勾选框）
         */
        function loadFromMidi(mf) {
            window._rawMidiSyllables = null;
            state.midiExtractedText = '';
            if (!mf || !window.LyricParser) return;
            try {
                var midiLyrics = window.LyricParser.parseFromMIDI(mf);
                if (!midiLyrics.length) return;
                window._rawMidiSyllables = midiLyrics;
                var sentences = window.LyricParser.mergeIntoSentences(midiLyrics);
                var lrcLines = [];
                for (var si = 0; si < sentences.length; si++) {
                    var s = sentences[si];
                    lrcLines.push(fmtLrcTag(s.time_ms) + s.text);
                }
                var full = lrcLines.join('\n');
                state.midiExtractedText = full.trim();
                // 末尾保留换行，便于后续添加乐句
                textarea.value = full ? full + '\n' : '';
                updateLyricStatus();
            } catch (e) {
                // MIDI 无歌词属正常
            }
        }

        function getWaterfallCallbacks() {
            return {
                onTimeSelected: onTimeSelected,
                onLyricTimeChanged: onLyricTimeChanged,
                onLyricEdit: onLyricEdit
            };
        }

        // 兼容旧页面全局回调命名（部分页面可能直接引用）
        window.onWaterfallTimeSelected = onTimeSelected;
        window.onWaterfallLyricEdit = onLyricEdit;
        window.onWaterfallLyricTimeChanged = onLyricTimeChanged;

        return {
            isEnabled: isEnabled,
            getManager: getManager,
            refresh: refreshLyricManager,
            updateStatus: updateLyricStatus,
            loadFromMidi: loadFromMidi,
            getWaterfallCallbacks: getWaterfallCallbacks,
            fmtLrcTag: fmtLrcTag,
            rebuildLrcLines: rebuildLrcLines,
            lyricsToLrcText: lyricsToLrcText,
            findLyricNearTime: findLyricNearTime,
            /** 暴露内部 state 供高度估算等只读使用 */
            _state: state
        };
    }

    window.LyricEditor = {
        init: init,
        fmtLrcTag: fmtLrcTag,
        rebuildLrcLines: rebuildLrcLines,
        lyricsToLrcText: lyricsToLrcText,
        findLyricNearTime: findLyricNearTime,
        formatEditTime: formatEditTime
    };
})();

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

    // 仅「完全同一时间点」才进入修改（吸附后的 tick 对齐容差）
    var EXACT_TIME_MS = 20;
    // 展示/点击辅助：略宽一点，仅用于标记命中，不用于自动推进后误进编辑
    var MARKER_HIT_MS = 80;

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
     * 解析 LRC 源文本中的每个时间标签及其内容区间（保留多标签行结构）
     * @returns {Array<{time_ms:number, tag:string, tagStart:number, tagEnd:number, content:string, contentEnd:number, lineStart:number}>}
     */
    function parseLrcTagsRaw(lrcText) {
        var text = lrcText || '';
        var re = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
        var items = [];
        var m;
        while ((m = re.exec(text)) !== null) {
            var min = parseInt(m[1], 10);
            var sec = parseFloat(m[2]);
            var time_ms;
            if (min >= 60) {
                var hh = Math.floor(min / 60);
                var mm2 = min % 60;
                time_ms = Math.round((hh * 3600 + mm2 * 60 + sec) * 1000);
            } else {
                time_ms = Math.round((min * 60 + sec) * 1000);
            }
            items.push({
                time_ms: time_ms,
                tag: m[0],
                tagStart: m.index,
                tagEnd: m.index + m[0].length
            });
        }
        for (var i = 0; i < items.length; i++) {
            var contentEnd = text.length;
            if (i + 1 < items.length) contentEnd = items[i + 1].tagStart;
            // 不跨过换行：标签内容只到行尾
            var nl = text.indexOf('\n', items[i].tagEnd);
            if (nl >= 0 && nl < contentEnd) contentEnd = nl;
            items[i].content = text.slice(items[i].tagEnd, contentEnd);
            items[i].contentEnd = contentEnd;
            var ls = text.lastIndexOf('\n', items[i].tagStart - 1);
            items[i].lineStart = ls < 0 ? 0 : ls + 1;
        }
        return items;
    }

    function findExactTagIndex(items, timeMs) {
        for (var i = 0; i < items.length; i++) {
            if (Math.abs(items[i].time_ms - timeMs) <= EXACT_TIME_MS) return i;
        }
        return -1;
    }

    /**
     * 在相同时间点替换标签内容；找不到返回 null
     */
    function replaceExactTagContent(lrcText, timeMs, newContent) {
        var items = parseLrcTagsRaw(lrcText);
        var idx = findExactTagIndex(items, timeMs);
        if (idx < 0) return null;
        var it = items[idx];
        return lrcText.slice(0, it.tagEnd) + newContent + lrcText.slice(it.contentEnd);
    }



    /**
     * 将 timeMs 所在整行替换为单标签乐句行
     * 用于乐句模式下修改整句（去掉旧音节切分）
     */
    function replacePhraseLineAtTime(lrcText, timeMs, newContent) {
        var items = parseLrcTagsRaw(lrcText);
        var idx = findExactTagIndex(items, timeMs);
        if (idx < 0) return null;
        var it = items[idx];
        var lineStart = it.lineStart;
        var nl = String.fromCharCode(10);
        var lineEnd = lrcText.indexOf(nl, it.tagStart);
        if (lineEnd < 0) lineEnd = lrcText.length;
        else lineEnd += 1; // include newline
        var line = fmtLrcTag(Math.round(timeMs)) + newContent + nl;
        return lrcText.slice(0, lineStart) + line + lrcText.slice(lineEnd);
    }

    /**
     * 从解析后的 lyrics（可能含 syllables）展开为瀑布流标记列表
     * mode: 'phrase' | 'syllable'
     */
    /**
     * 构建瀑布流标记：始终以乐句为一级标记；
     * 若乐句含多个音节，附带 syllables 供展开显示。
     */
    function buildMarkers(lyrics) {
        var markers = [];
        if (!lyrics || !lyrics.length) return markers;
        for (var i = 0; i < lyrics.length; i++) {
            var sent = lyrics[i];
            var syls = (sent.syllables && sent.syllables.length) ? sent.syllables : [];
            var hasMulti = syls.length > 1;
            markers.push({
                time_ms: sent.time_ms,
                text: sent.text || '',
                displayText: sent.text || '',
                sentenceIndex: i,
                syllableIndex: -1,
                isPhrase: true,
                isPhraseStart: true,
                phraseText: sent.text || '',
                hasMultiSyllables: hasMulti,
                syllables: syls.map(function(s) {
                    return { time_ms: s.time_ms, text: s.text, displayText: s.text };
                })
            });
        }
        return markers;
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
     * 仅在时间完全相同（±EXACT_TIME_MS）时命中标签。
     * @returns {{index:number, text:string, time_ms:number, tagIndex:number}|null}
     */
    function findLyricNearTime(lrcText, timeMs, toleranceMs) {
        // 兼容旧调用：默认改为精确匹配
        var tol = toleranceMs == null ? EXACT_TIME_MS : toleranceMs;
        var items = parseLrcTagsRaw(lrcText || '');
        if (!items.length) return null;
        var best = -1;
        var bestD = Infinity;
        for (var i = 0; i < items.length; i++) {
            var d = Math.abs(items[i].time_ms - timeMs);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (best < 0 || bestD > tol) return null;
        return {
            index: best,
            tagIndex: best,
            text: items[best].content,
            time_ms: items[best].time_ms
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
            editingTagTimeMs: -1,
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
                    wfState.lyricMarkers = [];
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
                var markers = buildMarkers(state.lyricMgr.lyrics);
                var applied = 0;
                forEachWaterfall(function(wfState) {
                    if (wfState.setLyricManager) {
                        wfState.setLyricManager(state.lyricMgr, true, songName);
                    }
                    wfState.lyricMarkers = markers;
                    applied++;
                });
                // 瀑布流可能尚未初始化：挂到 window，供稍后 init 后再次 refresh
                window._pendingLyricPreview = applied ? null : {
                    mgr: state.lyricMgr,
                    songName: songName,
                    markers: markers
                };
            } else {
                state.lyricMgr = null;
                window._pendingLyricPreview = null;
                forEachWaterfall(function(wfState) {
                    if (wfState.setLyricManager) wfState.setLyricManager(null, false);
                    wfState.lyricMarkers = [];
                });
            }
            if (typeof opts.onAfterChange === 'function') opts.onAfterChange();
        }

        function syncWaterfallSelection(timeMs) {
            var wfState = window.getWaterfallState && window.getWaterfallState(waterfallId);
            if (!wfState) return;
            wfState._selectedTimeMs = timeMs;
            wfState._selectedTimeIsDrag = false;
            // 触发重绘，保证虚线与输入框时间一致
            if (wfState.setLyricManager && wfState.lyricManager) {
                wfState.setLyricManager(wfState.lyricManager, wfState.lyricDisplayEnabled, wfState.lyricSongName);
            }
        }

        function showOverlay(timeMs, fillText, mode) {
            // mode: 'add' | 'edit'
            state.selectedEditTime = Math.round(timeMs);
            if (mode === 'edit') {
                state.editingTagTimeMs = Math.round(timeMs);
            } else {
                state.editingTagTimeMs = -1;
            }
            if (timeDisplay) timeDisplay.innerText = formatEditTime(state.selectedEditTime);
            if (overlay) overlay.style.display = 'block';
            if (input) {
                input.value = fillText == null ? '' : fillText;
                input.focus();
                try {
                    var len = input.value.length;
                    input.setSelectionRange(len, len);
                } catch (e) {}
            }
            if (addBtn) {
                addBtn.textContent = mode === 'edit' ? '修改' : '添加乐句';
            }
            // 瀑布流选中线与编辑时间强制同步
            syncWaterfallSelection(state.selectedEditTime);
        }

        function hideOverlay() {
            if (overlay) overlay.style.display = 'none';
            state.editingLyricIdx = -1;
            state.editingTagTimeMs = -1;
            if (addBtn) addBtn.textContent = '添加乐句';
        }

        /**
         * 点击瀑布流空白处 / 选中时间点：
         * 若该时间附近已有歌词 → 进入编辑并回填；否则进入新增模式。
         */
        function onTimeSelected(snappedMs, rawMs) {
            if (!isEnabled()) return;
            var tMs = Math.round(snappedMs);
            // 只有精确同一时间点才进入修改；附近时间一律视为新增
            var match = findLyricNearTime(textarea.value, tMs, EXACT_TIME_MS);
            if (match) {
                state.editingLyricIdx = match.index;
                state.editingTagTimeMs = match.time_ms;
                showOverlay(match.time_ms, match.text, 'edit');
                return;
            }
            state.editingLyricIdx = -1;
            state.editingTagTimeMs = -1;
            showOverlay(tMs, '', 'add');
        }

        /** 点击时间轴上已有歌词标记 → 编辑该时间点标签内容 */
        function onLyricEdit(idx, text, timeMs) {
            if (!isEnabled()) return;
            var tMs = Math.round(timeMs);
            var match = findLyricNearTime(textarea.value, tMs, EXACT_TIME_MS);
            // 优先用源文本精确标签内容；没有则用标记传来的 text
            var fill = match ? match.text : (text || '');
            var useTime = match ? match.time_ms : tMs;
            state.editingLyricIdx = match ? match.index : idx;
            state.editingTagTimeMs = useTime;
            showOverlay(useTime, fill, 'edit');
        }

        /** 拖拽歌词时间标记 */
        function onLyricTimeChanged(idx, newTimeMs, oldTimeMs) {
            if (!isEnabled()) return;
            var src = textarea.value || '';
            if (!src.trim()) return;
            var fromMs = (oldTimeMs != null) ? oldTimeMs : null;
            // 优先按精确旧时间定位标签；否则退回 idx 对应 markers/解析项
            var items = parseLrcTagsRaw(src);
            var tagIdx = -1;
            if (fromMs != null) {
                tagIdx = findExactTagIndex(items, fromMs);
            }
            if (tagIdx < 0 && idx >= 0 && idx < items.length) tagIdx = idx;
            if (tagIdx < 0) return;
            var it = items[tagIdx];
            var newTag = fmtLrcTag(Math.round(newTimeMs));
            // 只替换时间标签本身，保留内容
            textarea.value = src.slice(0, it.tagStart) + newTag + src.slice(it.tagEnd);
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
            // 推进到下一音符后：始终保持「新增」状态，清空输入，避免误进修改
            state.editingLyricIdx = -1;
            state.editingTagTimeMs = -1;
            if (input) input.value = '';
            if (addBtn) addBtn.textContent = '添加乐句';
            if (overlay) overlay.style.display = 'block';
        }

        // ---- 按钮：添加乐句（独立成行，行尾固定 \n）----
        if (addBtn) {
            addBtn.onclick = function() {
                var text = (input.value || '').trim();
                if (!text) return;
                window._rawMidiSyllables = null;
                window._manualLyricMode = true;

                // 修改：仅当 editingTagTimeMs 精确命中已有标签时替换该标签内容
                // 注意：不要用整行单标签替换，否则会抹掉 MIDI 多音节时间轴
                if (state.editingTagTimeMs >= 0) {
                    var replaced = replaceExactTagContent(textarea.value || '', state.editingTagTimeMs, text);
                    if (replaced != null) {
                        textarea.value = replaced;
                    } else {
                        var prev0 = textarea.value || '';
                        if (prev0.length && !/\n$/.test(prev0)) prev0 += '\n';
                        textarea.value = prev0 + fmtLrcTag(state.selectedEditTime) + text + '\n';
                    }
                } else {
                    // 添加乐句：字符串直接写入
                    var prev = textarea.value || '';
                    if (prev.length && !/\n$/.test(prev)) prev += '\n';
                    textarea.value = prev + fmtLrcTag(state.selectedEditTime) + text + '\n';
                }
                state.editingLyricIdx = -1;
                state.editingTagTimeMs = -1;
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

                var tMs = Math.round(state.selectedEditTime);
                // 精确同一时间点：替换该标签内容（可编辑音节，避免重复时间标签）
                var prev = textarea.value || '';
                var rep = replaceExactTagContent(prev, tMs, appendText);
                if (rep != null) {
                    textarea.value = rep;
                } else {
                    // 新增音节：不要 strip 尾部 \n
                    textarea.value = prev + fmtLrcTag(tMs) + appendText;
                }

                state.editingLyricIdx = -1;
                state.editingTagTimeMs = -1;
                if (input) input.value = '';
                if (addBtn) addBtn.textContent = '添加乐句';
                updateLyricStatus();
                refreshLyricManager();
                advanceToNextNote();
                if (input) input.focus();
            };
        }

        function snapEditToNote(direction) {
            // direction: -1 prev, +1 next
            if (!isEnabled()) return;
            var wfState = window.getWaterfallState && window.getWaterfallState(waterfallId);
            if (!wfState || !wfState.notes || !wfState.notes.length) return;
            var cur = state.selectedEditTime;
            var target = null;
            if (direction > 0) {
                for (var i = 0; i < wfState.notes.length; i++) {
                    if (wfState.notes[i].playTime > cur + 20) {
                        target = wfState.notes[i].playTime;
                        break;
                    }
                }
            } else {
                for (var j = wfState.notes.length - 1; j >= 0; j--) {
                    if (wfState.notes[j].playTime < cur - 20) {
                        target = wfState.notes[j].playTime;
                        break;
                    }
                }
            }
            if (target == null) return;
            state.selectedEditTime = target;
            wfState._selectedTimeMs = target;
            wfState._selectedTimeIsDrag = false;
            // 精确同一时间有标签 → 编辑；否则新增
            var match = findLyricNearTime(textarea.value, target, EXACT_TIME_MS);
            if (match) {
                state.editingLyricIdx = match.index;
                state.editingTagTimeMs = match.time_ms;
                showOverlay(match.time_ms, match.text, 'edit');
            } else {
                state.editingLyricIdx = -1;
                state.editingTagTimeMs = -1;
                showOverlay(target, '', 'add');
            }
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
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    snapEditToNote(-1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    snapEditToNote(1);
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
                // 按音节写出多时间标签 LRC，例如 [00:01.00]a[00:01.20]b
                // 不要只写句首时间+整句文本，否则一修改就丢音节时间轴
                var full = lyricsToLrcText(sentences);
                state.midiExtractedText = full.trim();
                textarea.value = full;
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
        parseLrcTagsRaw: parseLrcTagsRaw,
        replaceExactTagContent: replaceExactTagContent,
        replacePhraseLineAtTime: replacePhraseLineAtTime,
        buildMarkers: buildMarkers,
        formatEditTime: formatEditTime
    };
})();

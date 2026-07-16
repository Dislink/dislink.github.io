/**
 * lyric.js - 歌词/字幕解析与管理模块
 * 兼容标准 LRC 及网易云音乐等常见播放器格式
 * 用于 MIDI 转换器的歌词生成与瀑布流预览
 */
(function() {
    'use strict';

    // ============================================================
    // 1. LRC 解析器
    // ============================================================
    var LyricParser = {
        /**
         * 解析 LRC 文本
         * @param {string} text - LRC 格式文本
         * @returns {Array<{time_ms: number, text: string}>}
         */
        parseLRC: function(text) {
            if (!text || !text.trim()) return [];
            var lines = text.split(/\r?\n/);
            var lyrics = [];
            // 匹配 [mm:ss.xx] 或 [mm:ss.xxx] 或 [hh:mm:ss.xx]
            var tagRegex = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

            for (var li = 0; li < lines.length; li++) {
                var line = lines[li];
                if (!line.trim()) continue;

                var tags = [];

                // 重置 regex 状态
                tagRegex.lastIndex = 0;
                var mm;
                while ((mm = tagRegex.exec(line)) !== null) {
                    tags.push(mm);
                }
                if (!tags.length) continue;

                // 多时间标签行 → 生成一个 entry 含 syllables（逐音节渐进高亮）
                if (tags.length > 1) {
                    var syls = [];
                    var fullText = '';
                    for (var ti = 0; ti < tags.length; ti++) {
                        var t = tags[ti];
                        var contentStart = t.index + t[0].length;
                        var contentEnd = ti < tags.length - 1 ? tags[ti + 1].index : line.length;
                        var segText = line.slice(contentStart, contentEnd);
                        if (!segText) continue;

                        var min = parseInt(t[1], 10);
                        var sec = parseFloat(t[2]);
                        var time_ms;
                        if (min >= 60) {
                            var hh = Math.floor(min / 60);
                            var mm2 = min % 60;
                            time_ms = Math.round((hh * 3600 + mm2 * 60 + sec) * 1000);
                        } else {
                            time_ms = Math.round((min * 60 + sec) * 1000);
                        }

                        syls.push({ time_ms: time_ms, text: segText });
                        fullText += segText;
                    }
                    if (syls.length) {
                        lyrics.push({
                            time_ms: syls[0].time_ms,
                            text: fullText,
                            syllables: syls
                        });
                    }
                } else {
                    // 单时间标签 → 标准 LRC 行
                    var content = line.slice(tags[0].index + tags[0][0].length);
                    if (!content) continue;

                    var min = parseInt(tags[0][1], 10);
                    var sec = parseFloat(tags[0][2]);
                    var time_ms;
                    if (min >= 60) {
                        var hh = Math.floor(min / 60);
                        var mm2 = min % 60;
                        time_ms = Math.round((hh * 3600 + mm2 * 60 + sec) * 1000);
                    } else {
                        time_ms = Math.round((min * 60 + sec) * 1000);
                    }
                    lyrics.push({ time_ms: time_ms, text: content });
                }
            }

            // 按时间排序
            lyrics.sort(function(a, b) { return a.time_ms - b.time_ms; });

            // 去重（同一时间戳的多条记录只保留第一条）
            var result = [];
            for (var i = 0; i < lyrics.length; i++) {
                if (i === 0 || lyrics[i].time_ms !== lyrics[i - 1].time_ms) {
                    result.push(lyrics[i]);
                }
            }
            return result;
        },

        /**
         * 从 MIDI 文件中提取歌词
         * 先尝试 getLyrics()，若失败或结果异常则直接扫描所有 meta 事件
         * @param {MIDIFile} midiFile - MIDI 文件对象
         * @returns {Array<{time_ms: number, text: string}>}
         */
        parseFromMIDI: function(midiFile) {
            if (!midiFile) return [];

            // 方法1：尝试标准 getLyrics()
            try {
                if (typeof midiFile.getLyrics === 'function') {
                    var lyrics = midiFile.getLyrics();
                    if (lyrics && lyrics.length > 0) {
                        var result1 = lyrics
                            .filter(function(e) { return e && e.text && e.playTime !== undefined && e.playTime >= 0; })
                            .sort(function(a, b) { return a.playTime - b.playTime; });
                        if (result1.length >= 2) {
                            return result1.map(function(e) {
                                return { time_ms: Math.round(e.playTime), text: e.text };
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn('lyric.js: getLyrics() failed, trying fallback', e);
            }

            // 方法2：直接扫描所有 meta 事件（比 getLyrics 更稳健）
            try {
                if (typeof MIDIEvents === 'undefined' || typeof midiFile.getEvents !== 'function') return [];
                var allMeta = midiFile.getEvents([MIDIEvents.EVENT_META], [], [], true)[0];
                if (!allMeta || !allMeta.length) return [];
                var result = [];
                var isKaraokeMode = false; // 是否遇到 words 标记（karaoke 模式）
                var karaokeTexts = [];     // karaoke 模式下收集的文本

                for (var i = 0; i < allMeta.length; i++) {
                    var ev = allMeta[i];
                    var subtype = ev.subtype;
                    // 0x05 = LYRICS, 0x01 = TEXT
                    var isLyric = (subtype === 0x05);
                    var isText = (subtype === 0x01);
                    if (!isLyric && !isText) continue;

                    // 解码文本
                    var text = '';
                    try {
                        if (typeof UTF8 !== 'undefined') {
                            text = UTF8.getStringFromBytes(ev.data, 0, ev.length, true);
                        } else {
                            text = ev.data.map(function(c) { return String.fromCharCode(c); }).join('');
                        }
                    } catch (ex) {
                        text = ev.data.map(function(c) { return String.fromCharCode(c); }).join('');
                    }
                    if (!text) continue;

                    // karaoke 标记
                    if (isText && text.indexOf('words') === 0) {
                        isKaraokeMode = true;
                        karaokeTexts.length = 0; // 清空之前的文本
                        continue;
                    }

                    // 跳过 @T/@I/@L 等元信息标签
                    if (isText && text.length >= 2 && text[0] === '@' && 'TIL'.indexOf(text[1]) !== -1) {
                        continue;
                    }

                    // 存储解码后的文本到事件对象上，供后续读取
                    ev._decodedText = text;

                    if (isKaraokeMode && isText) {
                        // karaoke 模式：所有 TEXT 事件都是歌词
                        karaokeTexts.push(ev);
                    } else {
                        // 非 karaoke 模式：LYRICS 事件直接用，TEXT 事件只有 playTime > 0 才用
                        if (isLyric || ev.playTime > 0) {
                            result.push(ev);
                        }
                    }
                }

                // karaoke 模式优先
                var events = isKaraokeMode && karaokeTexts.length ? karaokeTexts : result;

                if (!events.length) return [];
                return events
                    .sort(function(a, b) { return a.playTime - b.playTime; })
                    .filter(function(e) { return e.playTime !== undefined && e.playTime >= 0; })
                    .map(function(e) {
                        return { time_ms: Math.round(e.playTime), text: e._decodedText || '' };
                    });
            } catch (e) {
                console.warn('lyric.js: meta fallback scan failed', e);
                return [];
            }
        },

        /**
         * 将音节级歌词事件合并为句子级
         * 用于逐音节的 MIDI 歌词（如 Still Alive 的 "This " "was " "a " "tri" "umph. "）
         * @param {Array<{time_ms: number, text: string}>} events - 已排序的音节级事件
         * @returns {Array<{time_ms: number, text: string, syllables: Array}>}
         *          每个句子含完整 text 和 syllables 子数组
         */
        mergeIntoSentences: function(events) {
            if (!events || !events.length) return [];
            // 断句标点：以 .!?:; 结尾，后可选地跟一个引号/括号/叹号，再跟上可选空白
            // 例如 "us.\" " / "dead.) " / "FAIL! " 都视为句子结束
            var TERMINATOR = /[.!?:;][""')\]]?\s*$/;
            var sentences = [];
            var curSyls = [];

            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                curSyls.push({ time_ms: ev.time_ms, text: ev.text });

                // 主断句：标点结尾
                var shouldSplit = TERMINATOR.test(ev.text);

                // 逗号断句：累计文本 > 12 且当前音节含逗号 → 也切分
                if (!shouldSplit) {
                    var accLen = 0;
                    for (var _j = 0; _j < curSyls.length; _j++) {
                        accLen += curSyls[_j].text.length;
                    }
                    if (accLen > 12 && /,/.test(ev.text)) {
                        shouldSplit = true;
                    }
                }

                if (shouldSplit) {
                    sentences.push(LyricParser._buildSentence(curSyls));
                    curSyls = [];
                }
            }
            // 末尾未被标点结束的残余音节也作为一句
            if (curSyls.length) {
                sentences.push(LyricParser._buildSentence(curSyls));
            }
            return sentences;
        },

        /**
         * 内部：把音节数组组装成句子对象
         * @private
         */
        _buildSentence: function(syls) {
            var fullText = '';
            for (var i = 0; i < syls.length; i++) {
                fullText += syls[i].text;
            }
            return {
                time_ms: syls[0].time_ms,
                text: fullText,
                syllables: syls
            };
        },

        /**
         * 判断事件数组是否为音节级（需要合并）
         * 经验规则：如果事件数 > 1 且第一条文本不以断句标点结尾、也不以换行符结尾、且长度较短 → 视为音节级
         * @private
         */
        _looksLikeSyllables: function(events) {
            if (!events || events.length < 2) return false;
            // 已有 syllables 字段 → 已经是句子级
            if (events[0].syllables !== undefined) return false;
            var first = events[0].text || '';
            // 如果第一条就含换行 → 可能是 LRC 多行
            if (first.indexOf('\n') >= 0) return false;
            // 第一条以断句标点结尾 → 可能本身已是整句
            if (/[.!?:;]\s*$/.test(first)) return false;

            // 检查时间间隔：音节级 MIDI 歌词通常每个间隔 < 600ms
            // 用户手动输入的 LRC 各行之间通常间隔 > 1s
            var avgGap = 0, gapCount = 0;
            for (var gi = 1; gi < Math.min(events.length, 10); gi++) {
                avgGap += events[gi].time_ms - events[gi - 1].time_ms;
                gapCount++;
            }
            if (gapCount > 0) avgGap /= gapCount;
            if (avgGap > 800) return false; // 大间隔 → LRC 整句

            // 统计含断句标点的事件数
            var termCount = 0;
            for (var i = 0; i < events.length; i++) {
                if (/[.!?:;]\s*$/.test(events[i].text || '')) termCount++;
            }
            var avgPerTerm = termCount > 0 ? events.length / termCount : Infinity;
            return avgPerTerm >= 1.5;
        },

        /**
         * 在指定时间添加一句歌词，返回按时间排序去重后的新数组
         * @param {Array} lyrics - 现有歌词数组
         * @param {number} timeMs - 新歌词时间（毫秒）
         * @param {string} text - 歌词文本
         * @returns {Array} 新数组
         */
        addLyricAtTime: function(lyrics, timeMs, text) {
            var newArr = (lyrics || []).slice();
            newArr.push({ time_ms: Math.round(timeMs), text: text });
            newArr.sort(function(a, b) { return a.time_ms - b.time_ms; });
            return newArr;
        },

        /**
         * 修改指定索引歌词的时间，返回按时间排序后的新数组
         * @param {Array} lyrics - 现有歌词数组
         * @param {number} index - 要修改的索引
         * @param {number} newTimeMs - 新时间（毫秒）
         * @returns {Array} 新数组
         */
        updateLyricTime: function(lyrics, index, newTimeMs) {
            if (!lyrics || index < 0 || index >= lyrics.length) return lyrics;
            var newArr = lyrics.slice();
            newArr[index] = { time_ms: Math.round(newTimeMs), text: newArr[index].text };
            newArr.sort(function(a, b) { return a.time_ms - b.time_ms; });
            return newArr;
        }
    };

    // ============================================================
    // 2. 歌词管理器
    // ============================================================
    /**
     * @constructor
     * @param {Array<{time_ms: number, text: string}>} lyrics - 已排序的歌词数组
     * @param {number} totalMs - 总时长（毫秒）
     */
    function LyricManager(lyrics, totalMs) {
        this.totalMs = totalMs || 0;
        if (lyrics && lyrics.length) {
            if (lyrics[0].syllables !== undefined) {
                // 已经包含 syllable 数据（从 mergeIntoSentences 得来）→ 直接使用
                this.lyrics = lyrics;
            } else if (!window._manualLyricMode && LyricParser._looksLikeSyllables(lyrics)) {
                // 只有非手动模式下才进行音节合并
                this.lyrics = LyricParser.mergeIntoSentences(lyrics);
            } else {
                // LRC 整句级数据 → 直接使用
                this.lyrics = lyrics;
            }
        } else {
            this.lyrics = [];
        }
    }

    /**
     * 二分查找指定时间对应的歌词索引
     * @param {number} timeMs - 当前时间（毫秒）
     * @returns {number} 歌词索引（-1 表示尚未开始或没有歌词）
     */
    LyricManager.prototype.getCurrentIndex = function(timeMs) {
        if (!this.lyrics.length || timeMs < 0) return -1;
        if (timeMs < this.lyrics[0].time_ms) return -1;

        // 二分查找
        var lo = 0, hi = this.lyrics.length - 1;
        while (lo < hi) {
            var mid = Math.ceil((lo + hi) / 2);
            if (this.lyrics[mid].time_ms <= timeMs) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    };

    /**
     * 构建完整句子文本（用于 getLyricAt 的返回）
     */
    LyricManager.prototype.getLyricAt = function(index) {
        if (index < 0 || index >= this.lyrics.length) return '';
        return this.lyrics[index].text;
    };

    /**
     * 为当前行构建渐进高亮文本（按已唱音节切分白/灰）
     * 若句子无 syllables（LRC 整句），返回整段白色文本
     * @param {object} sentence - {text, time_ms, syllables}
     * @param {number} currentTime - 当前时间（毫秒）
     * @returns {string} 带颜色代码的文本
     */
    LyricManager.prototype.buildSyllableLine = function(sentence, currentTime) {
        if (!sentence || !sentence.syllables || !sentence.syllables.length) {
            return (sentence && sentence.text) || '';
        }
        var syllables = sentence.syllables;
        // 找到已唱到的音节索引
        var sungCount = 0;
        for (var i = 0; i < syllables.length; i++) {
            if (syllables[i].time_ms <= currentTime) sungCount = i + 1;
        }
        // 已唱部分用白色 §f，未唱部分用灰色 §7，保留用户输入的空格
        var result = '';
        for (var j = 0; j < syllables.length; j++) {
            result += (j < sungCount ? '§f' : '§7') + syllables[j].text;
        }
        return result;
    };

    /**
     * 格式化毫秒为 mm:ss
     * @param {number} ms
     * @returns {string}
     */
    LyricManager.prototype.formatTime = function(ms) {
        if (ms < 0) ms = 0;
        var totalSec = Math.round(ms / 1000);
        var m = Math.floor(totalSec / 60);
        var s = totalSec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    };

    /**
     * 构建进度条字符串（20格）
     * @param {number} progress - 0~1 的进度
     * @returns {string} 例如 "§a----------§7----------"
     */
    LyricManager.prototype.buildProgressBar = function(progress) {
        progress = Math.max(0, Math.min(1, progress));
        var filled = Math.round(progress * 20);
        var empty = 20 - filled;
        return '§a' + '-'.repeat(filled) + '§7' + '-'.repeat(empty);
    };

    /**
     * 转义用户文本中的 § 字符（防止被 Minecraft 误解为颜色代码）
     * @param {string} s
     * @returns {string}
     */
    LyricManager._escapeColor = function(s) {
        if (!s) return '';
        // 移除 § 字符防止被 Minecraft 误解为颜色代码
        return String(s).replace(/§/g, '');
    };

    /**
     * 构建完整的 titleraw 命令
     * 当前行：句子级输出（无 syllables）全白；音节级输出（有 syllables）按已唱音节切分白/灰
     * @param {number} currentTime - 当前时间（毫秒）
     * @param {string} songName - 歌曲名
     * @returns {string} titleraw 命令字符串
     */
    LyricManager.prototype.buildTitleCommand = function(currentTime, songName) {
        var idx = this.getCurrentIndex(currentTime);
        var prev = idx > 0 ? this.getLyricAt(idx - 1) : '';
        var next = (idx >= 0 && idx < this.lyrics.length - 1) ? this.getLyricAt(idx + 1) : '';
        var currSentence = idx >= 0 ? this.lyrics[idx] : null;

        // 当前行：根据是否含 syllables 选择渲染方式
        var currText;
        if (currSentence && currSentence.syllables) {
            // MIDI 音节级：渐进高亮（已唱白/未唱灰），已包含 §f/§7 前缀
            currText = this.buildSyllableLine(currSentence, currentTime);
        } else {
            // LRC 整句：整行白色（需添加 §f 前缀）
            currText = currSentence ? '§f' + (currSentence.text || '') : '§f';
        }

        var progress = this.totalMs > 0 ? Math.min(1, currentTime / this.totalMs) : 0;
        var bar = this.buildProgressBar(progress);

        var timeStr = this.formatTime(currentTime);
        var remainStr = this.formatTime(Math.max(0, this.totalMs - currentTime));
        var totalStr = this.formatTime(this.totalMs);

        var esc = LyricManager._escapeColor;

        // 四行文本：上一句(灰) / 当前(白/灰渐进) / 下一句(灰) / 进度条+当前/剩余/总时长+歌名
        // 注意：当前行已自带 § 颜色代码（syllableLine 或 §f前缀），不再 esc
        var prevLine = '§7' + esc(prev);
        var nextLine = '§7' + esc(next);
        var currLine = currText; // currText 已包含 § 颜色代码

        var text = prevLine
                 + '\n' + currLine
                 + '\n' + nextLine
                 + '\n§7[' + bar + '§7] §f' + timeStr + ' §7/ -' + remainStr + ' §8(' + totalStr + ') §e' + esc(songName || '');

        var rawtext = JSON.stringify({ rawtext: [{ text: text }] });
        return 'titleraw @a actionbar ' + rawtext;
    };

    // ============================================================
    // 3. 全局暴露
    // ============================================================
    window.LyricParser = LyricParser;
    window.LyricManager = LyricManager;

})();

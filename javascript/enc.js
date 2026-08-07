/**
 * 网易基岩版世界存档 LevelDB 文件加解密
 * magic (BE): 0x801D3001 / 0x901D3001 视为已加密
 */

function isEncrypted(src) {
    if (!src || src.byteLength < 4) return false;
    try {
        var enc = new DataView(src instanceof ArrayBuffer ? src : src.buffer || src);
        // 与历史实现一致：getUint32 默认大端
        var magic = enc.getUint32(0);
        return magic === 0x801D3001 || magic === 0x901D3001;
    } catch (e) {
        return false;
    }
}

function fileDecrypt(src) {
    if (!src || !(src instanceof ArrayBuffer)) {
        throw new Error('解密失败：输入不是有效的 ArrayBuffer');
    }
    if (src.byteLength < 4) {
        throw new Error('解密失败：文件过短（' + src.byteLength + ' 字节），无法解密');
    }
    if (!isEncrypted(src)) {
        throw new Error('解密失败：文件不是网易加密格式');
    }

    var dst = new ArrayBuffer(src.byteLength + (src.byteLength % 8 ? 8 : 0));
    new Uint8Array(dst).set(new Uint8Array(src));
    var enc = new DataView(dst);
    for (var i = 0; i < enc.byteLength - 8; i += 8) {
        enc.setInt32(i, enc.getInt32(i, true) ^ 0x31353839, true);
        enc.setInt32(i + 4, enc.getInt32(i + 4, true) ^ 0x32333838, true);
    }
    // 去掉 4 字节魔数前缀
    return enc.buffer.slice(4, src.byteLength);
}

function fileEncrypt(src) {
    if (!src || !(src instanceof ArrayBuffer)) {
        throw new Error('加密失败：输入不是有效的 ArrayBuffer');
    }
    if (isEncrypted(src)) {
        throw new Error('加密失败：文件已经是加密格式');
    }

    var dst = new ArrayBuffer(src.byteLength + 4 + ((src.byteLength + 4) % 8 ? 8 : 0));
    new Uint8Array(dst).set(new Uint8Array(src), 4);
    var enc = new DataView(dst);
    enc.setInt32(0, 0x300525b9, true);
    for (var i = 0; i < enc.byteLength - 8; i += 8) {
        enc.setInt32(i, enc.getInt32(i, true) ^ 0x31353839, true);
        enc.setInt32(i + 4, enc.getInt32(i + 4, true) ^ 0x32333838, true);
    }
    return enc.buffer.slice(0, src.byteLength + 4);
}

function fileDecrypt(src) {
    var dst=new ArrayBuffer(src.byteLength+(src.byteLength%8?8:0));
    new Uint8Array(dst).set(new Uint8Array(src));
    var enc=new DataView(dst);
    for(let i=0;i<enc.byteLength-8;i+=8){
        enc.setInt32(i,enc.getInt32(i,true)^0x31353839,true);
        enc.setInt32(i+4,enc.getInt32(i+4,true)^0x32333838,true);
    }
    return enc.buffer.slice(4,src.byteLength);
}

function fileEncrypt(src) {
    var dst=new ArrayBuffer(src.byteLength+4+((src.byteLength+4)%8?8:0));
    new Uint8Array(dst).set(new Uint8Array(src),4);
    var enc=new DataView(dst);
    enc.setInt32(0, 0x300525b9, true);
    for(let i=0;i<enc.byteLength-8;i+=8){
        enc.setInt32(i,enc.getInt32(i,true)^0x31353839,true);
        enc.setInt32(i+4,enc.getInt32(i+4,true)^0x32333838,true);
    }
    return enc.buffer.slice(0,src.byteLength+4);
}

function isEncrypted(src) {
    var enc=new DataView(src);
    return enc.getUint32(0)==0x801D3001|enc.getUint32(0)==0x901D3001;
}
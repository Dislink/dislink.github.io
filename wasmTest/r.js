// 假设您在 Node.js 中
import SM2Module from "./record.js";

SM2Module().then(async function(Module) {
    console.log("Wasm Module Loaded.");
    Module._init();
    // -------------------------------------------------------------
    //  封装 C 函数 (cwrap)
    // -------------------------------------------------------------
    
    // char* encrypt(const char* plaintext_js, size_t* ciphertext_len_ptr) 
    const record = Module.cwrap('record', 'number', ['number', 'number', 'number', 'number']);
    const free = Module.cwrap('free', null, ['number']);
    const malloc = Module.cwrap('malloc', 'number', ['number']);
    const cipherLenPtr = malloc(4);
    document.getElementById("encrypt").onclick=()=>{
        let cipherPtr = 0;
        try {
            //尝试修改record中type为0，longitude为123.0012，latitude为40.0034, accuracy为10而不触发完整性异常
            //record函数签名：record(type:number, longitude:number, latitude:number, accuracy:number, cipherLenPtr:number);
            cipherPtr=record(110, 112.123456, 38.789012, 0.123456, cipherLenPtr);
            const ciphertextLength = Module.getValue(cipherLenPtr, 'i32');
            if(!cipherPtr){
                alert("加密失败！");
                console.log("encrypt failed!");
            }else{
                let cipherText=Array.from(new Uint8Array(Module.HEAPU8.buffer, cipherPtr, ciphertextLength)).map(b => b.toString(16).padStart(2, '0')).join('');
                document.getElementById("cipherText").innerText=cipherText;
                console.log("Ciphertext (Hex):", cipherText);
            }
        } catch (e) {
            alert("An error occurred during WASM execution!");
            console.error("An error occurred during WASM execution:", e);
        } finally {
            if (cipherPtr) free(cipherPtr);
            free(cipherLenPtr);
            console.log("\nMemory cleanup complete.");
        }
    }
}).catch(e => {
    alert("Error loading WASM module!");
    console.error("Error loading WASM module:", e);
});
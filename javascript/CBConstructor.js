class commandBlock{
    static modes={
        Impulse:0,
        Chain:1,
        Repeat:2
    }

    static directions={
        down:0,
        up:1,
        north:2,
        south:3,
        west:4,
        east:5
    }

    /**
     * 
     * @param {String} command - Command
     * @param {String} [customName=''] - CustomName
     * @param {Number} [mode=autoFill] - Mode
     * @param {Boolean} [conditionalMode=false] - Conditional
     * @param {Number} [tickDelay=0] - TickDelay
     * @param {Boolean} [auto=autoFill] - Auto
     * @param {Number} [facingDirection=autoFill] - Facing direction
     * 
     */
    constructor(command, customName='', mode=undefined, conditionalMode=false, tickDelay=0, auto=undefined, facingDirection=undefined){
        this.command=command;
        this.customName=customName;
        this.mode=mode;
        this.conditionalMode=Number(conditionalMode);
        this.tickDelay=tickDelay;
        this.auto=auto;
        this.facingDirection=facingDirection;
    }

}

class CBConstructor{
    /**
     * 
     * @param {commandBlock[]} init - Command blocks of the structure
     * @param {Boolean} [serialized=true] - Whether the given array is a serialized array
     * @param {Number[3]} [size] - The size of the structure
     */
    constructor(init, serialized=true, size=[]){
        this.commandBlocks=init;
        this.serialized=serialized;
        this.size=size;
        /*if(!serialized){
            for(let i in init){
                console.log([Math.floor(i/(size[1]*size[2])),Math.floor((i%(size[1]*size[2]))/size[2]),(i%(size[1]*size[2]))%size[2]])
                this.commandBlocks[size[1]*size[2]*(Math.floor((i%(size[1]*size[2]))/size[2])%2?size[0]-Math.floor(i/(size[1]*size[2]))-1:Math.floor(i/(size[1]*size[2])))+size[0]*Math.floor((i%(size[1]*size[2]))/size[2])+((size[0]*Math.floor((i%(size[1]*size[2]))/size[2])+Math.floor(i/(size[1]*size[2])))%2?size[0]-(i%(size[1]*size[2]))%size[2]-1:(i%(size[1]*size[2]))%size[2])]=init[i];
            }
        }else{
            this.commandBlocks=init;
        }*/
    }


    /**
     * Generate structure NBT
     * | blocks out of the given size will be ignored
     * @param {Number} [X=this.size[0]] - The x limit of the structure
     * @param {Number} [Y=this.size[1]] - The y limit of the structure
     * @param {Number} [Z=this.size[2]] - The z limit of the structure
     * @param {Boolean} [littleEndian=false] - Byte order
     * @returns {ArrayBuffer} NBT data
     */
    generateNBT(X=this.size[0],Y=this.size[1],Z=this.size[2],littleEndian=false){
        this.structure={"name":"","value":{"format_version":{"type":"int","value":1},"size":{"type":"list","value":{"type":"int","value":[X,Y,Z]}},"structure":{"type":"compound","value":{"block_indices":{"type":"list","value":{"type":"list","value":[{"type":"int","value":[]},{"type":"int","value":[]}]}},"entities":{"type":"list","value":{"type":"end","value":[]}},"palette":{"type":"compound","value":{"default":{"type":"compound","value":{"block_palette":{"type":"list","value":{"type":"compound","value":[{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:repeating_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}}]}},"block_position_data":{"type":"compound","value":{}}}}}}}},"structure_world_origin":{"type":"list","value":{"type":"int","value":[0,0,0]}}}};
        this.structure.value.structure.value.block_indices.value.value[0].value=new Array(X*Y*Z).fill(-1);
        this.structure.value.structure.value.block_indices.value.value[1].value=new Array(X*Y*Z).fill(-1);
        this.structure.value.structure.value.palette.value.default.value.block_palette.value.value[0].states.value.facing_direction.value=(!(Z-1)?(!(X-1)?1:5):3);
        let x=0,y=0,z=0;
        while(/*(y-1)*X*Z+(x-1)*Z+z<Object.keys(this.commandBlocks).pop()*/1){
            for(x=0;x<X/*&&(y-1)*X*Z+(x-1)*Z+z<Object.keys(this.commandBlocks).pop()*/;x++){
                for(z=0;z<Z/*&&y*X*Z+x*Z+z<Object.keys(this.commandBlocks).pop()*/;z++){
                    if(!this.commandBlocks[y*X*Z+x*Z+z]) continue;
					let CommandBlock=this.commandBlocks[y*X*Z+x*Z+z];
                    this.structure.value.structure.value.block_indices.value.value[0].value[this.serialized?Y*Z*(y%2?X-x-1:x)+Z*y+((X*y+x)%2?Z-z-1:z):x*Y*Z+y*Z+z]=(CommandBlock.mode===undefined?(x==0&y==0&z==0?0:1):CommandBlock.mode)*6+(CommandBlock.facingDirection===undefined?(z==Z-1?(x==X-1?1:(y%2?4:5)):((X*y+x)%2?2:3)):CommandBlock.facingDirection);
                    this.structure.value.structure.value.palette.value.default.value.block_position_data.value[this.serialized?Y*Z*(y%2?X-x-1:x)+Z*y+((X*y+x)%2?Z-z-1:z):x*Y*Z+y*Z+z]={"type":"compound","value":{"block_entity_data":{"type":"compound","value":{"Version":{"type": "int","value": 25},"id":{"type":"string","value":"CommandBlock"},"Command":{"type":"string","value":CommandBlock.command},"CustomName":{"type":"string","value":CommandBlock.customName},"TickDelay":{"type":"int","value":CommandBlock.tickDelay},"TrackOutput":{"type":"byte","value":1},"auto":{"type":"byte","value":CommandBlock.auto===undefined?((this.serialized&&(x!=0|y!=0|z!=0))||CommandBlock.mode==2?true:false):CommandBlock.auto},"conditionalMode": {"type": "byte","value": CommandBlock.conditionalMode}}}}};
                }
            }
            y++;
            if (y>Y-1) break;
        }
        this.data=nbt.writeUncompressed(this.structure,littleEndian);
        return this.data;
    }


    /**
     * Generate MCStructure(NBT in little endian)
     * | blocks out of the given size will be ignored
     * @param {Number} [X=this.size[0]] - The x limit of the structure
     * @param {Number} [Y=this.size[1]] - The y limit of the structure
     * @param {Number} [Z=this.size[2]] - The z limit of the structure
     * @param {Boolean} littleEndian - Byte order
     * @returns {ArrayBuffer} MCStructure data
     */
    generateMCStructure(X,Y,Z){
        return this.generateNBT(X,Y,Z,true);
    }


    /**
     * 
     * @param {Number} [X=this.size[0]] - The x limit of the structure
     * @param {Number} [Y=this.size[1]] - The y limit of the structure
     * @param {Number} [Z=this.size[2]] - The z limit of the structure
     * @returns {ArrayBuffer} BDX data
     */
    generateBDX(X=this.size[0],Y=this.size[1],Z=this.size[2]){
        this.dataArray=[66,68,88,0,68,105,115,108,105,110,107,95,83,102,111,114,122,97,0];
        let x=0,y=0,z=0;
        while((y-1)*X*Z+(x-1)*Z+z<Object.keys(this.commandBlocks).pop()){
            for(x=0;x<X&&(y-1)*X*Z+(x-1)*Z+z<Object.keys(this.commandBlocks).pop();x++){
                for(z=0;z<Z&&y*X*Z+x*Z+z<Object.keys(this.commandBlocks).pop();z++){
					let CommandBlock=this.commandBlocks[this.serialized?y*X*Z+x*Z+z:y*X*Z+(y%2?X-x-1:x)*Z+((X*y+x)%2?Z-z-1:z)];
                    if(CommandBlock) this.dataArray=this.dataArray.concat(0x24, 0, CommandBlock.facingDirection===undefined?(z==Z-1?(x==X-1?1:(y%2?4:5)):((X*y+x)%2?2:3)):CommandBlock.facingDirection, 0, 0, 0, CommandBlock.mode===undefined?(x==0&y==0&z==0?0:2):(CommandBlock.mode==0?CommandBlock.mode:(CommandBlock.mode==1?2:1)), Array.from(new TextEncoder().encode(CommandBlock.command)), 0, Array.from(new TextEncoder().encode(CommandBlock.customName)), 0, 0, (CommandBlock.tickDelay&0xff000000)>>>24, (CommandBlock.tickDelay&0xff0000)>>>16, (CommandBlock.tickDelay&0xff00)>>>8, CommandBlock.tickDelay&0xff, 1, 1, CommandBlock.conditionalMode, !CommandBlock.auto===undefined?((this.serialized&&(x!=0|y!=0|z!=0))||this.mode==2?true:false):CommandBlock.auto);
                    if (z!=Z-1) this.dataArray=this.dataArray.concat((X*y+x)%2?19:18);
                }
                this.dataArray=this.dataArray.concat(x==X-1?16:(y%2?15:14));
            }
            y++;
        }
		let Buffer;
		if (typeof Buffer === 'undefined') {
			Buffer=Uint8Array;
		}
        this.data=Buffer.from([66,68,64].concat(Array.from(new Brotli().compressArray(Buffer.from(this.dataArray=this.dataArray.concat(88,69)), 6)))).buffer;
        return this.data;
    }

    //这些是可以改的 每个对象都可以不一样 所以不用static
    modeDesc={
        0:'脉冲',
        1:'连锁',
        2:'循环',
		undefined:'-'
    }

    directionDesc={
        0:/*'down'*/'y-',
        1:/*'up'*/'y+',
        2:/*'north'*/'z-',
        3:/*'south'*/'z+',
        4:/*'west'*/'x-',
        5:/*'east'*/'x+',
    }

    conditionalModeDesc={
        0:'无条件',
        1:'有条件的'
    }

    autoBitDesc={
        0:'需要红石',
        1:'始终活动',
		undefined:'-'
    }
    /**
     * 
     * @returns {String} The command block description data
     */
    generateCBDesc(){
        if(this.serialized){
            this.data='#meta Serialized\n'
            for(let i of this.commandBlocks){
                this.data+=`${i.customName}:${this.modeDesc[i.mode]} ${this.conditionalModeDesc[Number(i.conditionalMode)]} ${this.autoBitDesc[i.auto]} [${i.tickDelay}] ${i.facingDirection===undefined?'':'{'+this.directionDesc[i.facingDirection]+'}'}\n/${i.command}\n\n`;
            }
        }else{
            /*this.data=`#meta size ${this.size[0]} ${this.size[1]} ${this.size[2]}\n`;
            this.data+='#defaultAxis z';
            for(let x=0;x<this.size[0];x++){
                for(let y=0;y<this.size[1];y++){
                    for(let z=0;z<this.size[2];z++){
                        if()
                    }
                }
            }*/
			throw new Error("暂时不支持非序列化生成cbd文件，建议手动写入");
        }
        return this.data;
    }
}

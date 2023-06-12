class commandBlock{
    modes={
        Impulse:0,
        Chain:1,
        Repeat:2
    }

    directions={
        down:0,
        up:1,
        north:2,
        south:3,
        west:4,
        east:5
    }

    /**
     * 
     * @param {string} command - Command
     * @param {string} [customName=''] - CustomName
     * @param {number} [mode=autoFill] - Mode
     * @param {boolean} [conditionalMode=false] - Conditional
     * @param {number} [tickDelay=0] - TickDelay
     * @param {boolean} [auto=false] - Auto
     * @param {number} [facingDirection=autoFill] - Facing direction
     * 
     */
    constructor(command, customName='', mode=undefined, conditionalMode=false, tickDelay=0, auto=false, facingDirection=undefined){
        this.command=command;
        this.customName=customName;
        this.mode=mode;
        this.conditionalMode=Number(conditionalMode);
        this.tickDelay=tickDelay;
        this.auto=Number(auto);
        this.facingDirection=facingDirection;
    }

}

class CBConstructor{
    /**
     * 
     * @param {commandBlock[]} init - Command blocks of the structure
     */
    constructor(init){
        this.commandBlocks=init;
    }


    /**
     * Generate structure NBT
     * | blocks out of the given size will be ignored
     * @param {number} X - The x limit of the structure
     * @param {number} Y - The y limit of the structure
     * @param {number} Z - The z limit of the structure
     * @param {boolean} [littleEndian=false] - Byte order
     * @returns {ArrayBuffer} NBT data
     */
    generateNBT(X,Y,Z,littleEndian=false){
        this.structure={"name":"","value":{"format_version":{"type":"int","value":1},"size":{"type":"list","value":{"type":"int","value":[X,Y,Z]}},"structure":{"type":"compound","value":{"block_indices":{"type":"list","value":{"type":"list","value":[{"type":"int","value":[]},{"type":"int","value":[]}]}},"entities":{"type":"list","value":{"type":"end","value":[]}},"palette":{"type":"compound","value":{"default":{"type":"compound","value":{"block_palette":{"type":"list","value":{"type":"compound","value":[{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:chain_command_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":0}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":1}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":2}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":3}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":4}}}},{"name":{"type":"string","value":"minecraft:repeatingcommand_block"},"states":{"type":"compound","value":{"conditional_bit":{"type":"byte","value":0},"facing_direction":{"type":"int","value":5}}}}]}},"block_position_data":{"type":"compound","value":{}}}}}}}},"structure_world_origin":{"type":"list","value":{"type":"int","value":[0,0,0]}}}};
        this.structure.value.structure.value.block_indices.value.value[0].value=new Array(X*Y*Z).fill(-1);
        this.structure.value.structure.value.block_indices.value.value[1].value=new Array(X*Y*Z).fill(-1);
        this.structure.value.structure.value.palette.value.default.value.block_palette.value.value[0].states.value.facing_direction.value=(!(Z-1)?(!(X-1)?1:5):3);
        let x=0,y=0,z=0;
        while((y-1)*X*Z+(x-1)*Z+z<this.commandBlocks.length){
            for(x=0;x<X&&(y-1)*X*Z+(x-1)*Z+z<this.commandBlocks.length;x++){
                for(z=0;z<Z&&y*X*Z+x*Z+z<this.commandBlocks.length;z++){
                    this.structure.value.structure.value.block_indices.value.value[0].value[Y*Z*(y%2?X-x-1:x)+Z*y+((X*y+x)%2?Z-z-1:z)]=(this.commandBlocks[y*X*Z+x*Z+z].mode===undefined?(x==0&y==0&z==0?0:1):this.commandBlocks[y*X*Z+x*Z+z].mode)*6+(this.commandBlocks[y*X*Z+x*Z+z].facingDirection===undefined?(z==Z-1?(x==X-1?1:(y%2?4:5)):((X*y+x)%2?2:3)):this.commandBlocks[y*X*Z+x*Z+z].facingDirection);
                    this.structure.value.structure.value.palette.value.default.value.block_position_data.value[Y*Z*(y%2?X-x-1:x)+Z*y+((X*y+x)%2?Z-z-1:z)]={"type":"compound","value":{"block_entity_data":{"type":"compound","value":{"id":{"type":"string","value":"CommandBlock"},"Command":{"type":"string","value":this.commandBlocks[y*X*Z+x*Z+z].command},"CustomName":{"type":"string","value":this.commandBlocks[y*X*Z+x*Z+z].customName},"TickDelay":{"type":"int","value":this.commandBlocks[y*X*Z+x*Z+z].tickDelay},"TrackOutput":{"type":"byte","value":1},"auto":{"type":"byte","value":this.commandBlocks[y*X*Z+x*Z+z].auto},"conditionalMode": {"type": "byte","value": this.commandBlocks[y*X*Z+x*Z+z].conditionalMode}}}}};
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
     * @param {number} X - The x limit of the structure
     * @param {number} Y - The y limit of the structure
     * @param {number} Z - The z limit of the structure
     * @param {boolean} littleEndian - Byte order
     * @returns {ArrayBuffer} MCStructure data
     */
    generateMCStructure(X,Y,Z){
        return this.generateNBT(X,Y,Z,true);
    }


    /**
     * 
     * @param {number} X - The x limit of the structure
     * @param {number} Z - The z limit of the structure
     * @returns {ArrayBuffer} BDX data
     */
    generateBDX(X,Z){
        this.dataArray=[66,68,88,0,68,105,115,108,105,110,107,95,83,102,111,114,122,97,0];
        let x=0,y=0,z=0;
        while((y-1)*X*Z+(x-1)*Z+z<this.commandBlocks.length){
            for(x=0;x<X&&(y-1)*X*Z+(x-1)*Z+z<this.commandBlocks.length;x++){
                for(z=0;z<Z&&y*X*Z+x*Z+z<this.commandBlocks.length;z++){
                    this.dataArray=this.dataArray.concat(0x24, 0, this.commandBlocks[y*X*Z+x*Z+z].facingDirection===undefined?(z==Z-1?(x==X-1?1:(y%2?4:5)):((X*y+x)%2?2:3)):this.commandBlocks[y*X*Z+x*Z+z].facingDirection, 0, 0, 0, this.commandBlocks[y*X*Z+x*Z+z].mode===undefined?(x==0&y==0&z==0?0:2):(this.commandBlocks[y*X*Z+x*Z+z].mode==0?this.commandBlocks[y*X*Z+x*Z+z].mode:(this.commandBlocks[y*X*Z+x*Z+z].mode==1?2:1)), Array.from(new TextEncoder().encode(this.commandBlocks[y*X*Z+x*Z+z].command)), 0, Array.from(new TextEncoder().encode(this.commandBlocks[y*X*Z+x*Z+z].customName)), 0, 0, (this.commandBlocks[y*X*Z+x*Z+z].tickDelay&0xff000000)>>>24, (this.commandBlocks[y*X*Z+x*Z+z].tickDelay&0xff0000)>>>16, (this.commandBlocks[y*X*Z+x*Z+z].tickDelay&0xff00)>>>8, this.commandBlocks[y*X*Z+x*Z+z].tickDelay&0xff, 1, 0, 0, !this.commandBlocks[y*X*Z+x*Z+z].auto);
                    if (z!=Z-1) this.dataArray=this.dataArray.concat((X*y+x)%2?19:18);
                }
                this.dataArray=this.dataArray.concat(x==X-1?16:(y%2?15:14));
            }
            y++;
        }
        this.data=Uint8Array.from([66,68,64].concat(Array.from(new Brotli().compressArray(Uint8Array.from(this.dataArray=this.dataArray.concat(88,69)), 6)))).buffer;
        return this.data;
    }


    modeDesc={
        0:'脉冲',
        1:'连锁',
        2:'循环'
    }

    directionDesc={
        0:'down',
        1:'up',
        2:'north',
        3:'south',
        4:'west',
        5:'east'
    }

    conditionalModeDesc={
        0:'无条件',
        1:'有条件的'
    }

    autoBitDesc={
        0:'需要红石',
        1:'始终活动'
    }
    /**
     * 
     * @returns {string} The command block description data
     */
    generateCBDesc(){
        this.data='#meta Serialized\n'
        +'';
        for(i in this.commandBlocks){
            this.data+=`${this.commandBlocks[i].customName}:${this.commandBlocks[i].mode===undefined?'-':this.modeDesc[this.commandBlocks[i].mode]} ${this.conditionalModeDesc[this.commandBlocks[i].conditionalMode]} ${this.autoBitDesc[this.commandBlocks[i].auto]} [${this.commandBlocks[i].tickDelay}] ${this.commandBlocks[i].facingDirection===undefined?'':'{'+this.directionDesc[this.commandBlocks[i].facingDirection]+'}'}\n${this.commandBlocks[i].command}\n\n`;
        }
        return this.data;
    }
}
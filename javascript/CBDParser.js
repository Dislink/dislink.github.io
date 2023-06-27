function parseCommandBlock(CBDesc, defaultCommandBlock){
    let properties=CBDesc.match(/(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|[0-5]|[xyz][\+\-])\})?\s*/i);
    defaultCommandBlock.customName=properties[1];
    if(/(?:脉冲)|(?:(?:im)?p(?:ulse)?)|0/i.test(properties[2])){
        defaultCommandBlock.mode=0;
    }else if(/(?:连锁)|链|(?:c(?:hain)?)|1/i.test(properties[2])){
        defaultCommandBlock.mode=1;
    }else if(/(?:循环)|(?:重复)|(?:r(?:epeat)?(?:ing)?)|2/.test(properties[2])){
        defaultCommandBlock.mode=2;
    }
    if(/(有条件的?|(?:c(?:onditional)?)|1)/.test(properties[3])){
        defaultCommandBlock.conditionalMode=true;
    }else if(/(无条件的?|(?:u(?:nconditional)?)|0)/.test(properties[3])){
        defaultCommandBlock.conditionalMode=false;
    }
    if(/(?:始终活动)|(?:保持开启)|(?:a(?:lways)?(?:\-active)?)|1/.test(properties[4])){
        defaultCommandBlock.auto=1;
    }else if(/(?:需要红石)|(?:n(?:eeds)?(?:\-redstone)?)|0/.test(properties[4])){
        defaultCommandBlock.auto=0;
    }
    if(properties[5]){
        defaultCommandBlock.tickDelay=parseInt(properties[5]);
    }
    if(properties[6]){
        switch(properties[6].toLowerCase()){
            case 'down':
            case 'y-':
            case '0':
                defaultCommandBlock.facingDirection=0;
                break;
            case 'up':
            case 'y+':
            case '1':
                defaultCommandBlock.facingDirection=1;
                break;
            case 'north':
            case 'z-':
            case '2':
                defaultCommandBlock.facingDirection=2;
                break;
            case 'south':
            case 'z+':
            case '3':
                defaultCommandBlock.facingDirection=3;
                break;
            case 'west':
            case 'x-':
            case '4':
                defaultCommandBlock.facingDirection=4;
                break;
            case 'east':
            case 'x+':
            case '5':
                defaultCommandBlock.facingDirection=5;
        }
    }
    return defaultCommandBlock;
}
function parseCBD(CBDesc){
    let serialized=false;
    let size=[1,1,1];
    let defaultAxis;
    let position=[0,0,0];
    let defaultCB=new commandBlock('', '', undefined, false, 0, false, undefined);
    let fulfilled=false;
    let cb=JSON.parse(JSON.stringify(defaultCB));
    let commandBlocks=[];
    for(let i in CBDesc.split(/(\n|\r)+/)){
        if (/^\s*#meta/.test(CBDesc.split(/(\n|\r)+/)[i])){
            if(/serialized\s*/i.test(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+(.+)/)[1])){
                serialized=true;
                continue;
            }
            if(/size\s+\d+\s+\d+\s+\d+\s*/i.test(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+(.+)/)[1])){
                size=[parseInt(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+size\s+(\d+)\s+(\d+)\s+(\d+)\s*/)[1]),parseInt(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+size\s+(\d+)\s+(\d+)\s+(\d+)\s*/)[2]),parseInt(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+size\s+(\d+)\s+(\d+)\s+(\d+)\s*/)[3])];
                continue;
            }
            throw new Error("Unknown or malformed #meta:"+CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#meta\s+(.+)/)[1]);
            continue;
        }
        if (/^\s*#defaultAxis\s+[xyz]/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            switch(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#defaultAxis\s+([xyz])/)[1].toLowerCase()){
                case 'X':
                    defaultAxis=0;
                    break;
                case 'Y':
                    defaultAxis=1;
                    break;
                case 'Z':
                    defaultAxis=2;
                    break;
            }
            continue;
        }
        if (/^\s*#default\s(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|[0-5]|[xyz][\+\-])\})?\s*/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            let commandBlockDesc=CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#default\s(.*)/i)[1].trim();
            defaultCB=parseCommandBlock(commandBlockDesc,defaultCB);
            cb=JSON.parse(JSON.stringify(defaultCB));
            continue;
        }
        if(/^\s*\/(.*)/.test(CBDesc.split(/(\n|\r)+/)[i])){
            cb.command=CBDesc.split(/(\n|\r)+/)[i].match(/^\s*\/(.*)/)[1];
            if(serialized){
                commandBlocks.push(cb);
            }else{
                if(position[0]>size[0]-1||position[1]>size[1]-1||position[2]>size[2]-1){
                    throw new Error(`Size out of range:[${position[0]},${position[1]},${position[2]}]>[${size[0]-1},${size[1]-1},${size[2]-1}]`);
                }
                commandBlocks[position[1]*size[0]*size[2]+position[0]*size[2]+position[2]]=cb;
                if(defaultAxis!==undefined) position[defaultAxis]++;
            }
            cb=JSON.parse(JSON.stringify(defaultCB));
            fulfilled=false;
            continue;
        }else if(/(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|[0-5]|[xyz][\+\-])\})?\s*/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            if(fulfilled){
                cb.command='';
                if(serialized){
                    commandBlocks.push(cb);
                }else{
                    if(position[0]>size[0]-1||position[1]>size[1]-1||position[2]>size[2]-1){
                        throw new Error(`Size out of range:[${position[0]},${position[1]},${position[2]}]>[${size[0]-1},${size[1]-1},${size[2]-1}]`);
                    }
                    commandBlocks[position[1]*size[0]*size[2]+position[0]*size[2]+position[2]]=cb;
                    if(defaultAxis!==undefined) position[defaultAxis]++;
                }
                cb=JSON.parse(JSON.stringify(defaultCB));
            }
            cb=parseCommandBlock(CBDesc.split(/(\n|\r)+/)[i].trim(),cb);
            fulfilled=true;
            continue;
        }
        if(/^\s*#(x|y|z)(\+|\-|=)(\d*|~)/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            let properties=CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#(x|y|z)(\+|\-|=)(\d*)/i);
            switch(properties[1].toUpperCase()){
                case 'X':
                    if(properties[2]=='+'){
                        position[0]=position[0]+parseInt(properties[3]);
                    }else if(properties[2]=='-'){
                        position[0]=position[0]-parseInt(properties[3]);
                    }else{
                        position[0]=parseInt(properties[3]);
                    }
                    break;
                case 'Y':
                    if(properties[2]=='+'){
                        position[1]=position[0]+parseInt(properties[3]);
                    }else if(properties[2]=='-'){
                        position[1]=position[0]-parseInt(properties[3]);
                    }else{
                        position[1]=parseInt(properties[3]);
                    }
                    break;
                case 'Z':
                    if(properties[2]=='+'){
                        position[2]=position[0]+parseInt(properties[3]);
                    }else if(properties[2]=='-'){
                        position[2]=position[0]-parseInt(properties[3]);
                    }else{
                        position[2]=parseInt(properties[3]);
                    }
                    break;
            }
        }
    }
    return [commandBlocks,serialized,size,defaultAxis];
}
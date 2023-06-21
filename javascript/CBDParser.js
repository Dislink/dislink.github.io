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
            switch(CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#defaultAxis\s+([xyz])/)[1]){
                case 'X':
                case 'x':
                    defaultAxis=0;
                    break;
                case 'Y':
                case 'y':
                    defaultAxis=1;
                    break;
                case 'Z':
                case 'z':
                    defaultAxis=2;
                    break;
            }
            continue;
        }
        if (/^\s*#default\s(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|0|1|2|3|4|5)\})?\s*/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            let properties=CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#default\s(.*):((?:脉冲?)|(?:连锁?)|(?:循环?)|(?:(?:im)?pulse)|(?:chain)|(?:repeat(?:ing)?)|\-|p|c|r|0|1|2)\s*((?:有|无)条件的?|(?:(?:un)?conditional)|u|c|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:always(?:\-active)?)|(?:needs(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|0|1|2|3|4|5)\})?\s*/i);
            defaultCB.customName=properties[1];
            if(/(?:脉冲)|(?:(?:im)?p(?:ulse)?)|0/i.test(properties[2])){
                defaultCB.mode=0;
            }else if(/(?:连锁)|链|(?:c(?:hain)?)|1/i.test(properties[2])){
                defaultCB.mode=1;
            }else if(/(?:循环)|(?:重复)|(?:r(?:epeat)?(?:ing)?)|2/.test(properties[2])){
                defaultCB.mode=2;
            }
            if(/(有条件的?|(?:c(?:onditional)?)|1)/.test(properties[3])){
                defaultCB.conditionalMode=true;
            }else{
                defaultCB.conditionalMode=false;
            }
            if(/(?:始终活动)|(?:保持开启)|(?:a(?:lways)?(?:\-active)?)/.test(properties[4])){
                defaultCB.auto=1;
            }else{
                defaultCB.auto=0;
            }
            if(properties[5]){
                defaultCB.tickDelay=parseInt(properties[5]);
            }
            if(properties[6]){
                switch(properties[6]){
                    case 'down':
                    case '0':
                        defaultCB.facingDirection=0;
                        break;
                    case 'up':
                    case '1':
                        defaultCB.facingDirection=1;
                        break;
                    case 'north':
                    case '2':
                        defaultCB.facingDirection=2;
                        break;
                    case 'south':
                    case '3':
                        defaultCB.facingDirection=3;
                        break;
                    case 'west':
                    case '4':
                        defaultCB.facingDirection=4;
                        break;
                    case 'east':
                    case '5':
                        defaultCB.facingDirection=5;
                }
            }
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
                    return;
                }
                commandBlocks[position[1]*size[0]*size[2]+position[0]*size[2]+position[2]]=cb;
                if(defaultAxis!==undefined) position[defaultAxis]++;
            }
            cb=JSON.parse(JSON.stringify(defaultCB));
            fulfilled=false;
            continue;
        }else if(/(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|0|1|2|3|4|5)\})?\s*/i.test(CBDesc.split(/(\n|\r)+/)[i])){
            if(fulfilled){
                cb.command='';
                if(serialized){
                    commandBlocks.push(cb);
                }else{
                    if(position[0]>size[0]-1||position[1]>size[1]-1||position[2]>size[2]-1){
                        throw new Error(`Size out of range:[${position[0]},${position[1]},${position[2]}]>[${size[0]-1},${size[1]-1},${size[2]-1}]`);
                        return;
                    }
                    commandBlocks[position[1]*size[0]*size[2]+position[0]*size[2]+position[2]]=cb;
                    if(defaultAxis!==undefined) position[defaultAxis]++;
                }
                cb=JSON.parse(JSON.stringify(defaultCB));
            }
            let properties=CBDesc.split(/(\n|\r)+/)[i].match(/(.*):((?:脉冲)|(?:连锁)|链|(?:循环)|(?:重复)|(?:(?:im)?p(?:ulse)?)|(?:c(?:hain)?)|(?:r(?:epeat)?(?:ing)?)|\-|0|1|2)\s*((?:有|无)条件的?|(?:(?:u(?:n)?)?c?(?:onditional)?)|0|1)\s*((?:始终活动)|(?:保持开启)|(?:需要红石)|(?:a(?:lways)?(?:\-active)?)|(?:n(?:eeds)?(?:\-redstone)?)|0|1)\s*(?:\[(\d+)\])?\s*(?:\{(up|down|north|south|east|west|0|1|2|3|4|5)\})?\s*/i);
            cb.customName=properties[1];
            if(/(?:脉冲)|(?:(?:im)?p(?:ulse)?)|0/i.test(properties[2])){
                cb.mode=0;
            }else if(/(?:连锁)|链|(?:c(?:hain)?)|1/i.test(properties[2])){
                cb.mode=1;
            }else if(/(?:循环)|(?:重复)|(?:r(?:epeat)?(?:ing)?)|2/.test(properties[2])){
                cb.mode=2;
            }
            if(/(有条件的?|(?:c(?:onditional)?)|1)/.test(properties[3])){
                cb.conditionalMode=true;
            }else{
                cb.conditionalMode=false;
            }
            if(/(?:始终活动)|(?:保持开启)|(?:a(?:lways)?(?:\-active)?)/.test(properties[4])){
                cb.auto=1;
            }else{
                cb.auto=0;
            }
            if(properties[5]){
                cb.tickDelay=parseInt(properties[5]);
            }
            if(properties[6]){
                switch(properties[6]){
                    case 'down':
                    case '0':
                        cb.facingDirection=0;
                        break;
                    case 'up':
                    case '1':
                        cb.facingDirection=1;
                        break;
                    case 'north':
                    case '2':
                        cb.facingDirection=2;
                        break;
                    case 'south':
                    case '3':
                        cb.facingDirection=3;
                        break;
                    case 'west':
                    case '4':
                        cb.facingDirection=4;
                        break;
                    case 'east':
                    case '5':
                        cb.facingDirection=5;
                }
            }
            fulfilled=true;
            continue;
        }
        if(/^\s*#(x|y|z)(\+|\-|=)(\d*|~)/.test(CBDesc.split(/(\n|\r)+/)[i])){
            let properties=CBDesc.split(/(\n|\r)+/)[i].match(/^\s*#(x|y|z)(\+|\-|=)(\d*)/);
            switch(properties[1]){
                case 'X':
                case 'x':
                    if(properties[2]=='+'){
                        position[0]=position[0]+parseInt(properties[3]);
                    }else if(properties[2]=='-'){
                        position[0]=position[0]-parseInt(properties[3]);
                    }else{
                        position[0]=parseInt(properties[3]);
                    }
                    break;
                case 'Y':
                case 'y':
                    if(properties[2]=='+'){
                        position[1]=position[0]+parseInt(properties[3]);
                    }else if(properties[2]=='-'){
                        position[1]=position[0]-parseInt(properties[3]);
                    }else{
                        position[1]=parseInt(properties[3]);
                    }
                    break;
                case 'Z':
                case 'z':
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
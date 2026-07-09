function transwrite(command,version=0){
    console.log(command)
    if(!/^\s*\/?\s*execute/.test(command)&&(!version&&(/^\s*\/?\s*((fill)|(setblock))/.test(command)))) return command;
    if(version&&(/^\s*\/?\s*fill/.test(command))){
        let fillArgs=command.match(/^\s*\/?\s*fill\s*((?:(?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3}\s*){2})([a-zA-Z0-9_:]+)\s+(\-?\d*)\s*(.*)/);
        if(!fillArgs) throw new Error(`Invalid fill body in ${command}`);
        if(/^replace/.test(fillArgs[4])){
            let replaceArgs=fillArgs[4].match(/^replace\s+([a-zA-Z0-9_:]+)\s+(\-?\d*)/)
            if(!replaceArgs) throw new Error(`Invalid fill...replace structure in ${command}`);
            return `/fill ${fillArgs[1].trim()} ${blockData2block(fillArgs[2],fillArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} replace ${blockData2block(replaceArgs[1],replaceArgs[2]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")}`;
        }
        return `/fill ${fillArgs[1].trim()} ${blockData2block(fillArgs[2],fillArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} ${fillArgs[4]||''}`;
    }
    if(version&&(/^\s*\/?\s*setblock/.test(command))){
        let setblockArgs=command.match(/^\s*\/?\s*setblock\s*((?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3})\s*([a-zA-Z0-9_:]+)\s+(\-?\d*)\s*(.*)/);
        if(!setblockArgs) throw new Error(`Invalid setblock body in ${command}`);
        return `/setblock ${setblockArgs[1]} ${blockData2block(setblockArgs[2],setblockArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} ${setblockArgs[4]}`;
    }
    let execArgs=command.match(/^\s*\/?\s*execute\s+((?:@[aesvrpi]\s*(?:\[.*?\])?)|(?:\".*?\")|(?:\w+))\s+((?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3})\s+(?:(?:detect\s+)((?:(?:(?:[~^]\-?[\d\.]*)|(?:\-?[\d\.]+))\s*?){3})\s+([a-zA-Z0-9_:]+)\s+(\-?\d+))?\s*(.*)/);
    if(!execArgs) throw new Error(`Invalid execute body in ${command}`);
    console.log(execArgs)
    return `/execute as ${execArgs[1]}${/~/.test(execArgs[2]+execArgs[3])?" at @s":''}${execArgs[2].replaceAll(" ",'')=="~~~"?'':" positioned "+execArgs[2].trim()} ${execArgs[3]?(" if block "+execArgs[3]+' '+(version?(blockData2block(execArgs[4],execArgs[5]=='-1'?0:execArgs[5]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,execArgs[5]=='-1'?"$1":"$1 $2")):(execArgs[4]+' '+execArgs[5]))):''} run ${transwrite(execArgs[6],version)}`.replaceAll(/\s{2,}/g,' ');
}


function transwrite(command,version=0){
    console.log(command)
    if(!/^\s*\/?\s*execute/.test(command)&&(!version&&(/^\s*\/?\s*((fill)|(setblock))/.test(command)))) return command;
    if(version&&(/^\s*\/?\s*fill/.test(command))){
        let fillArgs=command.match(/^\s*\/?\s*fill\s*((?:(?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3}\s*){2})([a-zA-Z0-9_:]+)\s+(\-?\d*)\s*(.*)/);
        if(!fillArgs) throw new Error(`Invalid fill body in ${command}`);
        if(/^replace/.test(fillArgs[4])){
            let replaceArgs=fillArgs[4].match(/^replace\s+([a-zA-Z0-9_:]+)\s+(\-?\d*)/)
            if(!replaceArgs) throw new Error(`Invalid fill...replace structure in ${command}`);
            return `/fill ${fillArgs[1].trim()} ${blockData2block(fillArgs[2],fillArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} replace ${blockData2block(replaceArgs[1],replaceArgs[2]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")}`;
        }
        return `/fill ${fillArgs[1].trim()} ${blockData2block(fillArgs[2],fillArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} ${fillArgs[4]||''}`;
    }
    if(version&&(/^\s*\/?\s*setblock/.test(command))){
        let setblockArgs=command.match(/^\s*\/?\s*setblock\s*((?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3})\s*([a-zA-Z0-9_:]+)\s+(\-?\d*)\s*(.*)/);
        if(!setblockArgs) throw new Error(`Invalid setblock body in ${command}`);
        return `/setblock ${setblockArgs[1]} ${blockData2block(setblockArgs[2],setblockArgs[3]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,"$1 $2")} ${setblockArgs[4]}`;
    }
    let execArgs=command.match(/^\s*\/?\s*execute\s+((?:@[aesvrpi]\s*(?:\[.*?\])?)|(?:\".*?\")|(?:\w+))\s+((?:(?:(?:[~^]\-?\d*)|(?:\-?\d+))\s*?){3})\s+(?:(?:detect\s+)((?:(?:(?:[~^]\-?[\d\.]*)|(?:\-?[\d\.]+))\s*?){3})\s+([a-zA-Z0-9_:]+)\s+(\-?\d+))?\s*(.*)/);
    if(!execArgs) throw new Error(`Invalid execute body in ${command}`);
    console.log(execArgs)
    return `/execute as ${execArgs[1]}${/~/.test(execArgs[2]+execArgs[3])?" at @s":''}${execArgs[2].replaceAll(" ",'')=="~~~"?'':" positioned "+execArgs[2].trim()} ${execArgs[3]?(" if block "+execArgs[3]+' '+(version?(blockData2block(execArgs[4],execArgs[5]=='-1'?0:execArgs[5]).replace(/^([A-Za-z0-9_]+)(\[.+\])?$/,execArgs[5]=='-1'?"$1":"$1 $2")):(execArgs[4]+' '+execArgs[5]))):''} run ${transwrite(execArgs[6],version)}`.replaceAll(/\s{2,}/g,' ');
}
